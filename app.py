#!/usr/bin/env python3
import argparse
import math
import os
import platform
import queue
import re
import sys
import tempfile
import threading
import time
import tkinter as tk
from dataclasses import dataclass
from tkinter import messagebox, ttk
from typing import Callable, Optional

import numpy as np
import pyautogui
import pyperclip
import sounddevice as sd
import soundfile as sf
from openai import OpenAI

try:
    from pynput import keyboard
except Exception:  # pragma: no cover - runtime environment dependent
    keyboard = None


DEFAULT_STT_MODEL = "gpt-4o-mini-transcribe"
DEFAULT_TEXT_MODEL_OPENAI = "gpt-4.1-mini"
DEFAULT_TEXT_MODEL_GEMINI = "gemini-2.0-flash"
DEFAULT_TEXT_MODEL_GROK = "grok-2-latest"
ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")

TEXT_PROVIDER_OPENAI = "openai"
TEXT_PROVIDER_GEMINI = "gemini"
TEXT_PROVIDER_GROK = "grok"

PROVIDER_LABELS = {
    TEXT_PROVIDER_OPENAI: "OpenAI",
    TEXT_PROVIDER_GEMINI: "Gemini",
    TEXT_PROVIDER_GROK: "Grok",
}

ENV_KEYS = [
    "OPENAI_API_KEY",
    "TEXT_PROVIDER",
    "OPENAI_TEXT_API_KEY",
    "GEMINI_API_KEY",
    "GROK_API_KEY",
    "TEXT_MODEL",
]


@dataclass
class Job:
    audio_path: str
    action: str  # dictate | rewrite | translate_en | translate_pt | prompt_codex


class ProcessingCanceled(Exception):
    pass


@dataclass
class AppConfig:
    openai_api_key: str = ""
    text_provider: str = TEXT_PROVIDER_OPENAI
    openai_text_api_key: str = ""
    gemini_api_key: str = ""
    grok_api_key: str = ""
    text_model: str = ""


def _read_env_file() -> dict[str, str]:
    data: dict[str, str] = {}
    if not os.path.exists(ENV_PATH):
        return data

    with open(ENV_PATH, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            data[key.strip()] = value.strip().strip('"').strip("'")
    return data


def load_config() -> AppConfig:
    data = _read_env_file()
    return AppConfig(
        openai_api_key=data.get("OPENAI_API_KEY", os.getenv("OPENAI_API_KEY", "").strip()),
        text_provider=(data.get("TEXT_PROVIDER", TEXT_PROVIDER_OPENAI).strip().lower() or TEXT_PROVIDER_OPENAI),
        openai_text_api_key=data.get("OPENAI_TEXT_API_KEY", "").strip(),
        gemini_api_key=data.get("GEMINI_API_KEY", "").strip(),
        grok_api_key=data.get("GROK_API_KEY", "").strip(),
        text_model=data.get("TEXT_MODEL", "").strip(),
    )


def save_config(config: AppConfig) -> None:
    values = {
        "OPENAI_API_KEY": config.openai_api_key.strip(),
        "TEXT_PROVIDER": config.text_provider.strip().lower(),
        "OPENAI_TEXT_API_KEY": config.openai_text_api_key.strip(),
        "GEMINI_API_KEY": config.gemini_api_key.strip(),
        "GROK_API_KEY": config.grok_api_key.strip(),
        "TEXT_MODEL": config.text_model.strip(),
    }
    with open(ENV_PATH, "w", encoding="utf-8") as f:
        for key in ENV_KEYS:
            f.write(f"{key}={values.get(key, '')}\n")


def default_model_for_provider(provider: str) -> str:
    if provider == TEXT_PROVIDER_GEMINI:
        return DEFAULT_TEXT_MODEL_GEMINI
    if provider == TEXT_PROVIDER_GROK:
        return DEFAULT_TEXT_MODEL_GROK
    return DEFAULT_TEXT_MODEL_OPENAI


class DitadoApp:
    def __init__(
        self,
        stt_model: str,
        sample_rate: int,
        config: Optional[AppConfig] = None,
        on_status: Optional[Callable[[str], None]] = None,
        on_result: Optional[Callable[[str], None]] = None,
        on_recording_change: Optional[Callable[[bool], None]] = None,
        on_audio_level: Optional[Callable[[float], None]] = None,
        on_processing_change: Optional[Callable[[bool, str], None]] = None,
    ):
        self.stt_model = stt_model
        self.sample_rate = sample_rate

        self.on_status = on_status
        self.on_result = on_result
        self.on_recording_change = on_recording_change
        self.on_audio_level = on_audio_level
        self.on_processing_change = on_processing_change

        self.stt_client: Optional[OpenAI] = None
        self.text_client: Optional[OpenAI] = None

        self.text_provider = TEXT_PROVIDER_OPENAI
        self.text_model = default_model_for_provider(TEXT_PROVIDER_OPENAI)

        self.is_recording = False
        self.is_processing = False
        self.current_action = "dictate"
        self.audio_frames: list[np.ndarray] = []
        self.stream: Optional[sd.InputStream] = None
        self.cancel_requested = False

        self.job_queue: queue.Queue[Job] = queue.Queue()
        self.worker = threading.Thread(target=self._worker_loop, daemon=True)
        self.worker.start()

        pyautogui.FAILSAFE = False

        if config:
            self.apply_config(config)

    def _status(self, msg: str):
        print(msg)
        if self.on_status:
            self.on_status(msg)

    def _set_recording_state(self, recording: bool):
        self.is_recording = recording
        if self.on_recording_change:
            self.on_recording_change(recording)
        if not recording and self.on_audio_level:
            self.on_audio_level(0.0)

    def _set_processing_state(self, processing: bool, message: str = ""):
        self.is_processing = processing
        if self.on_processing_change:
            self.on_processing_change(processing, message)

    def _check_canceled(self):
        if self.cancel_requested:
            raise ProcessingCanceled()

    def cancel_processing(self):
        self.cancel_requested = True
        self._status("[proc] Cancelamento solicitado.")

    def apply_config(self, config: AppConfig):
        stt_key = config.openai_api_key.strip()
        self.stt_client = OpenAI(api_key=stt_key) if stt_key else None

        provider = config.text_provider.strip().lower() or TEXT_PROVIDER_OPENAI
        if provider not in {TEXT_PROVIDER_OPENAI, TEXT_PROVIDER_GEMINI, TEXT_PROVIDER_GROK}:
            provider = TEXT_PROVIDER_OPENAI
        self.text_provider = provider

        if provider == TEXT_PROVIDER_OPENAI:
            text_key = config.openai_text_api_key.strip() or stt_key
            self.text_client = OpenAI(api_key=text_key) if text_key else None
        elif provider == TEXT_PROVIDER_GEMINI:
            text_key = config.gemini_api_key.strip()
            self.text_client = (
                OpenAI(api_key=text_key, base_url="https://generativelanguage.googleapis.com/v1beta/openai/")
                if text_key
                else None
            )
        else:
            text_key = config.grok_api_key.strip()
            self.text_client = OpenAI(api_key=text_key, base_url="https://api.x.ai/v1/") if text_key else None

        self.text_model = config.text_model.strip() or default_model_for_provider(provider)

    def has_stt_key(self) -> bool:
        return self.stt_client is not None

    def _audio_callback(self, indata, frames, time_info, status):
        if status:
            self._status(f"[audio] warning: {status}")

        sample = indata.copy()
        self.audio_frames.append(sample)

        if self.on_audio_level:
            rms = float(np.sqrt(np.mean(sample ** 2)))
            normalized = min(1.0, rms * 14.0)
            self.on_audio_level(normalized)

    def start_recording(self, action: str):
        if not self.has_stt_key():
            self._status("[error] Configure a OPENAI_API_KEY (STT) antes de gravar.")
            return

        if self.is_recording:
            self._status("[state] Ja esta gravando.")
            return

        self.current_action = action
        self.audio_frames = []
        self.stream = sd.InputStream(
            samplerate=self.sample_rate,
            channels=1,
            dtype="float32",
            callback=self._audio_callback,
        )
        self.stream.start()
        self._set_recording_state(True)
        self._status(f"[rec] Gravando ({action}). Enter/Espaco ou mesma tecla para parar.")

    def stop_recording(self):
        if not self.is_recording:
            self._status("[state] Nao esta gravando.")
            return

        self._set_recording_state(False)
        if self.stream is not None:
            self.stream.stop()
            self.stream.close()
        self.stream = None

        if not self.audio_frames:
            self._status("[rec] Sem audio capturado.")
            return

        audio = np.concatenate(self.audio_frames, axis=0)
        fd, path = tempfile.mkstemp(prefix="ditado_", suffix=".wav")
        os.close(fd)
        sf.write(path, audio, self.sample_rate)

        self.job_queue.put(Job(audio_path=path, action=self.current_action))
        self.cancel_requested = False
        self._set_processing_state(True, "Processando ditado...")
        self._status("[rec] Gravacao finalizada. Processando...")

    def toggle_recording(self, action: str):
        if self.is_recording:
            self.stop_recording()
        else:
            self.start_recording(action)

    def _transcribe(self, audio_path: str) -> str:
        if self.stt_client is None:
            raise RuntimeError("OPENAI_API_KEY (STT) nao configurada.")

        with open(audio_path, "rb") as audio_file:
            result = self.stt_client.audio.transcriptions.create(
                model=self.stt_model,
                file=audio_file,
                language="pt",
                response_format="text",
            )
        return result.strip()

    def _text_complete(self, prompt: str, temperature: float) -> str:
        if self.text_client is None:
            raise RuntimeError(f"Chave do provedor de texto ({self.text_provider}) nao configurada.")

        response = self.text_client.chat.completions.create(
            model=self.text_model,
            temperature=temperature,
            messages=[
                {"role": "system", "content": "Voce e um assistente de escrita e traducao tecnica."},
                {"role": "user", "content": prompt},
            ],
        )
        return (response.choices[0].message.content or "").strip()

    def _rewrite_with_llm(self, text: str) -> str:
        prompt = (
            "Reescreva o texto abaixo em portugues claro e objetivo, mantendo o sentido. "
            "Corrija pontuacao e ortografia.\n\n"
            f"Texto:\n{text}"
        )
        return self._text_complete(prompt, temperature=0.2)

    def _translate(self, text: str, target: str) -> str:
        target_label = "ingles" if target == "en" else "portugues"
        prompt = f"Traduza o texto abaixo para {target_label}. Responda apenas com a traducao.\n\n{text}"
        return self._text_complete(prompt, temperature=0.0)

    def _build_codex_prompt(self, text: str) -> str:
        prompt = (
            "Transforme o ditado abaixo em um prompt no estilo Codex. "
            "Estruture em: Objetivo, Contexto, Requisitos, Criterios de aceite, Passos sugeridos.\n\n"
            f"Ditado:\n{text}"
        )
        return self._text_complete(prompt, temperature=0.1)

    def _extract_voice_action(self, text: str) -> tuple[str, str]:
        normalized = text.lower()
        patterns = [
            ("rewrite", r"(passa no gpt|trata(r)? isso no gpt|reescreva com gpt)$"),
            ("translate_en", r"(traduza para ingles|traduz para ingles)$"),
            ("translate_pt", r"(traduza para portugues|traduz para portugues)$"),
            ("prompt_codex", r"(prompt codex|gera(r)? prompt codex|transforma(r)? em prompt codex)$"),
        ]
        for action, pattern in patterns:
            match = re.search(pattern, normalized)
            if match:
                cleaned = text[: match.start()].strip(" ,.;:-")
                return action, cleaned
        return "dictate", text

    def _paste_text(self, text: str):
        pyperclip.copy(text)
        time.sleep(0.05)
        if os.name == "nt":
            pyautogui.hotkey("ctrl", "v")
        else:
            pyautogui.hotkey("command", "v")

    def _worker_loop(self):
        while True:
            job = self.job_queue.get()
            try:
                if self.cancel_requested:
                    raise ProcessingCanceled()

                text = self._transcribe(job.audio_path)
                self._check_canceled()
                self._status(f"[stt] {text}")

                voice_action, cleaned_text = self._extract_voice_action(text)
                action = job.action
                if action == "dictate" and voice_action != "dictate":
                    action = voice_action
                    text = cleaned_text
                    self._status(f"[cmd] Comando de voz detectado: {voice_action}")
                self._check_canceled()

                if action == "rewrite":
                    text = self._rewrite_with_llm(text)
                elif action == "translate_en":
                    text = self._translate(text, "en")
                elif action == "translate_pt":
                    text = self._translate(text, "pt")
                elif action == "prompt_codex":
                    text = self._build_codex_prompt(text)
                self._check_canceled()

                self._paste_text(text)
                self._status("[paste] Texto copiado e colado no app ativo.")
                if self.on_result:
                    self.on_result(text)
            except ProcessingCanceled:
                self._status("[proc] Processamento interrompido.")
            except Exception as exc:
                self._status(f"[error] {exc}")
            finally:
                try:
                    os.remove(job.audio_path)
                except OSError:
                    pass
                self._set_processing_state(False, "")
                self.job_queue.task_done()


class HotkeyController:
    def __init__(self, app: DitadoApp):
        self.app = app
        self.listener: Optional["keyboard.Listener"] = None
        self.enabled = self._can_enable_global_hotkeys()

    def _can_enable_global_hotkeys(self) -> bool:
        if keyboard is None:
            self.app._status("[hotkey] pynput indisponivel. Hotkeys globais desativados.")
            return False

        if platform.system() == "Darwin" and sys.version_info >= (3, 14):
            self.app._status(
                "[hotkey] Python 3.14+ no macOS pode causar crash com hotkeys globais. "
                "Use botoes/atalhos com foco na janela ou Python 3.12 para global."
            )
            return False
        return True

    def on_press(self, key):
        try:
            if key == keyboard.Key.f8:
                self.app.toggle_recording("dictate")
            elif key == keyboard.Key.f9:
                self.app.toggle_recording("rewrite")
            elif key == keyboard.Key.f10:
                self.app.toggle_recording("translate_en")
            elif key == keyboard.Key.f11:
                self.app.toggle_recording("prompt_codex")
            elif self.app.is_recording and key in (keyboard.Key.enter, keyboard.Key.space):
                self.app.stop_recording()
        except Exception as exc:
            self.app._status(f"[hotkey] {exc}")

    def start(self):
        if not self.enabled:
            return
        if self.listener is not None:
            return
        self.listener = keyboard.Listener(on_press=self.on_press)
        self.listener.start()
        self.app._status("[hotkey] Ativos: F8/F9/F10/F11 e Enter/Espaco para parar gravacao.")

    def stop(self):
        if self.listener is not None:
            self.listener.stop()
            self.listener = None


class DitadoUI:
    BG = "#f3f2ef"
    CARD = "#ffffff"
    CARD_ALT = "#fbfaf7"
    TEXT = "#171717"
    MUTED = "#6b7280"
    ACCENT = "#111827"
    SUCCESS = "#0f766e"

    def __init__(self, app: DitadoApp, hotkeys: HotkeyController, config: AppConfig):
        self.app = app
        self.hotkeys = hotkeys

        self.root = tk.Tk()
        self.root.title("Ditado Help")
        self.root.geometry("1120x760")
        self.root.minsize(920, 640)
        self.root.configure(bg=self.BG)

        self.level_target = 0.0
        self.level_display = 0.0
        self.level_phase = 0.0
        self.is_recording = False
        self.bar_count = 28
        self.meter_after_id = None

        self._configure_styles()
        self._build_layout(config)
        self._start_meter_loop()

        self.hotkeys.start()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _configure_styles(self):
        style = ttk.Style()
        style.theme_use("clam")

        style.configure("App.TFrame", background=self.BG)
        style.configure("Card.TFrame", background=self.CARD)
        style.configure("CardAlt.TFrame", background=self.CARD_ALT)

        style.configure("Header.TLabel", background=self.BG, foreground=self.TEXT, font=("Avenir Next", 22, "bold"))
        style.configure("Sub.TLabel", background=self.BG, foreground=self.MUTED, font=("Avenir Next", 11))
        style.configure("Field.TLabel", background=self.CARD, foreground=self.TEXT, font=("Avenir Next", 11, "bold"))
        style.configure("PanelTitle.TLabel", background=self.CARD_ALT, foreground=self.TEXT, font=("Avenir Next", 12, "bold"))

        style.configure(
            "Primary.TButton",
            background=self.ACCENT,
            foreground="#ffffff",
            font=("Avenir Next", 11, "bold"),
            borderwidth=0,
            focusthickness=3,
            focuscolor=self.ACCENT,
            padding=(12, 8),
        )
        style.map("Primary.TButton", background=[("active", "#1f2937"), ("pressed", "#374151")])

        style.configure(
            "Ghost.TButton",
            background="#ece9e3",
            foreground="#1f2937",
            font=("Avenir Next", 10, "bold"),
            borderwidth=0,
            padding=(10, 7),
        )
        style.map("Ghost.TButton", background=[("active", "#e4e0d9"), ("pressed", "#d8d3cb")])

        style.configure("TEntry", fieldbackground="#ffffff", foreground=self.TEXT, insertcolor=self.TEXT)
        style.configure("TCombobox", fieldbackground="#ffffff", foreground=self.TEXT)
        style.configure("TCheckbutton", background=self.CARD, foreground=self.TEXT, font=("Avenir Next", 10))
        style.configure("Soft.TEntry", fieldbackground="#ffffff", foreground=self.TEXT, insertcolor=self.TEXT, borderwidth=0, relief="flat", padding=8)
        style.configure("Soft.TCombobox", fieldbackground="#ffffff", foreground=self.TEXT, borderwidth=0, relief="flat")

    def _build_layout(self, config: AppConfig):
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(2, weight=1)

        top = ttk.Frame(self.root, style="App.TFrame", padding=(24, 20, 24, 10))
        top.grid(row=0, column=0, sticky="ew")
        top.columnconfigure(0, weight=1)

        ttk.Label(top, text="Ditado Help", style="Header.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(
            top,
            text="Ditado com colagem automatica e pipeline de reescrita/traducao com LLM.",
            style="Sub.TLabel",
        ).grid(row=1, column=0, sticky="w", pady=(4, 0))

        config_card = ttk.Frame(self.root, style="Card.TFrame", padding=16)
        config_card.grid(row=1, column=0, sticky="ew", padx=24, pady=(0, 12))
        config_card.columnconfigure(1, weight=1)

        ttk.Label(config_card, text="OPENAI_API_KEY (STT)", style="Field.TLabel").grid(row=0, column=0, sticky="w")
        self.stt_key_var = tk.StringVar(value=config.openai_api_key)
        ttk.Entry(config_card, textvariable=self.stt_key_var, show="*", style="Soft.TEntry").grid(row=0, column=1, sticky="ew", padx=(12, 12))

        ttk.Label(config_card, text="LLM Texto", style="Field.TLabel").grid(row=1, column=0, sticky="w", pady=(10, 0))
        self.provider_var = tk.StringVar(value=config.text_provider)
        provider_combo = ttk.Combobox(
            config_card,
            textvariable=self.provider_var,
            values=[TEXT_PROVIDER_OPENAI, TEXT_PROVIDER_GEMINI, TEXT_PROVIDER_GROK],
            state="readonly",
            width=14,
            style="Soft.TCombobox",
        )
        provider_combo.grid(row=1, column=1, sticky="w", padx=(12, 0), pady=(10, 0))
        provider_combo.bind("<<ComboboxSelected>>", self._on_provider_change)

        ttk.Label(config_card, text="Chave LLM Texto", style="Field.TLabel").grid(row=2, column=0, sticky="w", pady=(10, 0))
        self.text_key_var = tk.StringVar()
        self.text_key_entry = ttk.Entry(config_card, textvariable=self.text_key_var, show="*", style="Soft.TEntry")
        self.text_key_entry.grid(row=2, column=1, sticky="ew", padx=(12, 12), pady=(10, 0))

        self.use_stt_for_openai_var = tk.BooleanVar(value=True)
        self.use_stt_key_check = ttk.Checkbutton(
            config_card,
            text="No OpenAI, usar a mesma chave do STT",
            variable=self.use_stt_for_openai_var,
            command=self._on_use_stt_key_toggle,
        )
        self.use_stt_key_check.grid(row=2, column=2, sticky="w", pady=(10, 0))

        ttk.Label(config_card, text="Modelo LLM", style="Field.TLabel").grid(row=3, column=0, sticky="w", pady=(10, 0))
        self.text_model_var = tk.StringVar(value=config.text_model or default_model_for_provider(config.text_provider))
        ttk.Entry(config_card, textvariable=self.text_model_var, style="Soft.TEntry").grid(row=3, column=1, sticky="ew", padx=(12, 12), pady=(10, 0))

        ttk.Button(config_card, text="Salvar Configuracao", style="Primary.TButton", command=self._save_all_config).grid(
            row=0, column=2, rowspan=2, sticky="ne", padx=(4, 0)
        )

        self.keys_by_provider = {
            TEXT_PROVIDER_OPENAI: config.openai_text_api_key,
            TEXT_PROVIDER_GEMINI: config.gemini_api_key,
            TEXT_PROVIDER_GROK: config.grok_api_key,
        }
        self.use_stt_for_openai_var.set(not bool(self.keys_by_provider[TEXT_PROVIDER_OPENAI]))
        self._sync_text_key_field_from_provider()

        body = ttk.Frame(self.root, style="App.TFrame", padding=(24, 0, 24, 24))
        body.grid(row=2, column=0, sticky="nsew")
        body.columnconfigure(0, weight=1)
        body.rowconfigure(3, weight=1)
        body.rowconfigure(4, weight=1)

        controls = ttk.Frame(body, style="Card.TFrame", padding=14)
        controls.grid(row=0, column=0, sticky="ew", pady=(0, 12))

        ttk.Button(controls, text="Dictar (F8)", style="Primary.TButton", command=lambda: self.app.toggle_recording("dictate")).pack(side="left", padx=4)
        ttk.Button(controls, text="Reescrever (F9)", style="Ghost.TButton", command=lambda: self.app.toggle_recording("rewrite")).pack(side="left", padx=4)
        ttk.Button(controls, text="Traduzir EN (F10)", style="Ghost.TButton", command=lambda: self.app.toggle_recording("translate_en")).pack(side="left", padx=4)
        ttk.Button(controls, text="Prompt Codex (F11)", style="Ghost.TButton", command=lambda: self.app.toggle_recording("prompt_codex")).pack(side="left", padx=4)
        self.stop_button = ttk.Button(controls, text="Parar (Enter/Espaco)", style="Ghost.TButton", command=self._handle_stop)
        self.stop_button.pack(side="left", padx=4)
        ttk.Button(controls, text="Copiar Resultado", style="Ghost.TButton", command=self._copy_output_text).pack(side="right", padx=4)
        ttk.Button(controls, text="Copiar Status", style="Ghost.TButton", command=self._copy_status_text).pack(side="right", padx=4)

        self.processing_frame = ttk.Frame(body, style="App.TFrame")
        self.processing_frame.grid(row=1, column=0, sticky="ew", pady=(0, 8))
        self.processing_frame.columnconfigure(1, weight=1)
        self.processing_label_var = tk.StringVar(value="Processando...")
        self.processing_label = ttk.Label(self.processing_frame, textvariable=self.processing_label_var, style="Sub.TLabel")
        self.processing_label.grid(row=0, column=0, sticky="w")
        self.processing_bar = ttk.Progressbar(self.processing_frame, mode="indeterminate")
        self.processing_bar.grid(row=0, column=1, sticky="ew", padx=(10, 0))
        self.processing_frame.grid_remove()

        indicator_card = ttk.Frame(body, style="CardAlt.TFrame", padding=14)
        indicator_card.grid(row=2, column=0, sticky="ew", pady=(0, 12))
        indicator_card.columnconfigure(0, weight=1)

        self.recording_state_var = tk.StringVar(value="Pronto para gravar")
        self.recording_hint_var = tk.StringVar(value="Atalhos: F8/F9/F10/F11, Enter/Espaco para parar")

        ttk.Label(indicator_card, text="Indicador de Gravacao", style="PanelTitle.TLabel").grid(row=0, column=0, sticky="w")
        self.state_label = tk.Label(
            indicator_card,
            textvariable=self.recording_state_var,
            bg=self.CARD_ALT,
            fg=self.SUCCESS,
            font=("Avenir Next", 11, "bold"),
        )
        self.state_label.grid(row=1, column=0, sticky="w", pady=(4, 0))

        self.meter_canvas = tk.Canvas(
            indicator_card,
            height=72,
            bg="#f1f5f9",
            highlightthickness=1,
            highlightbackground="#e2e8f0",
            bd=0,
        )
        self.meter_canvas.grid(row=2, column=0, sticky="ew", pady=(10, 6))
        self.meter_canvas.bind("<Configure>", lambda _e: self._draw_meter(force=True))

        self.hint_label = tk.Label(
            indicator_card,
            textvariable=self.recording_hint_var,
            bg=self.CARD_ALT,
            fg=self.MUTED,
            font=("Avenir Next", 10),
        )
        self.hint_label.grid(row=3, column=0, sticky="w")

        output_panel = ttk.Frame(body, style="CardAlt.TFrame", padding=12)
        output_panel.grid(row=3, column=0, sticky="nsew", pady=(0, 12))
        output_panel.columnconfigure(0, weight=1)
        output_panel.rowconfigure(1, weight=1)
        ttk.Label(output_panel, text="Ultimo Texto Inserido", style="PanelTitle.TLabel").grid(row=0, column=0, sticky="w")
        self.output_text = tk.Text(
            output_panel,
            height=10,
            wrap="word",
            bg="#ffffff",
            fg="#0f172a",
            insertbackground=self.TEXT,
            relief="flat",
            padx=10,
            pady=10,
        )
        self.output_text.grid(row=1, column=0, sticky="nsew", pady=(8, 0))

        status_panel = ttk.Frame(body, style="CardAlt.TFrame", padding=12)
        status_panel.grid(row=4, column=0, sticky="nsew")
        status_panel.columnconfigure(0, weight=1)
        status_panel.rowconfigure(1, weight=1)
        ttk.Label(status_panel, text="Status", style="PanelTitle.TLabel").grid(row=0, column=0, sticky="w")
        self.log_text = tk.Text(
            status_panel,
            height=9,
            wrap="word",
            bg="#ffffff",
            fg="#0f172a",
            insertbackground=self.TEXT,
            relief="flat",
            padx=10,
            pady=10,
        )
        self.log_text.grid(row=1, column=0, sticky="nsew", pady=(8, 0))

        self.root.bind("<F8>", lambda event: self.app.toggle_recording("dictate"))
        self.root.bind("<F9>", lambda event: self.app.toggle_recording("rewrite"))
        self.root.bind("<F10>", lambda event: self.app.toggle_recording("translate_en"))
        self.root.bind("<F11>", lambda event: self.app.toggle_recording("prompt_codex"))
        self.root.bind("<Return>", lambda event: self._stop_if_recording())
        self.root.bind("<space>", lambda event: self._stop_if_recording())

        self._append_log("[ui] Visual atualizado com indicador dinamico de gravacao.")
        self._set_key_state()

    def _start_meter_loop(self):
        self._draw_meter()
        self.meter_after_id = self.root.after(33, self._start_meter_loop)

    def _draw_meter(self, force: bool = False):
        canvas = self.meter_canvas
        width = max(1, canvas.winfo_width())
        height = max(1, canvas.winfo_height())

        target = self.level_target
        if self.is_recording:
            self.level_display += (target - self.level_display) * 0.35
        else:
            self.level_display *= 0.84

        self.level_phase += 0.18
        base_wave = 0.0 if self.is_recording else 0.04
        signal = min(1.0, max(0.0, self.level_display + base_wave))

        canvas.delete("meter")

        gutter = 2
        bar_w = max(4, (width - (self.bar_count + 1) * gutter) // self.bar_count)
        usable_h = height - 16
        center = height - 8

        for i in range(self.bar_count):
            x0 = gutter + i * (bar_w + gutter)
            x1 = x0 + bar_w

            wobble = 0.18 * math.sin(self.level_phase + i * 0.55)
            energy = max(0.02, min(1.0, signal + wobble))
            h = max(4, int(usable_h * energy))
            y0 = center - h
            y1 = center

            if energy > 0.72:
                color = "#0ea5e9"
            elif energy > 0.45:
                color = "#38bdf8"
            elif energy > 0.2:
                color = "#93c5fd"
            else:
                color = "#cbd5e1"

            canvas.create_rectangle(x0, y0, x1, y1, fill=color, width=0, tags="meter")

    def _stop_if_recording(self):
        if self.app.is_recording:
            self.app.stop_recording()

    def _handle_stop(self):
        if self.app.is_recording:
            self.app.stop_recording()
            return
        if self.app.is_processing:
            self.app.cancel_processing()
            return
        self._append_log("[proc] Nada para parar no momento.")

    def _on_provider_change(self, _event=None):
        self._sync_text_key_field_from_provider(update_model=True)

    def _on_use_stt_key_toggle(self):
        self._sync_text_key_field_from_provider()

    def _sync_text_key_field_from_provider(self, update_model: bool = False):
        provider = self.provider_var.get().strip().lower() or TEXT_PROVIDER_OPENAI
        current = self.keys_by_provider.get(provider, "")

        if provider == TEXT_PROVIDER_OPENAI and self.use_stt_for_openai_var.get():
            self.text_key_var.set("")
            self.text_key_entry.configure(state="disabled")
            self.use_stt_key_check.configure(state="normal")
        elif provider == TEXT_PROVIDER_OPENAI:
            self.text_key_var.set(current)
            self.text_key_entry.configure(state="normal")
            self.use_stt_key_check.configure(state="normal")
        else:
            self.text_key_var.set(current)
            self.text_key_entry.configure(state="normal")
            self.use_stt_key_check.configure(state="disabled")

        if update_model:
            self.text_model_var.set(default_model_for_provider(provider))

    def _save_all_config(self):
        provider = self.provider_var.get().strip().lower() or TEXT_PROVIDER_OPENAI
        if provider not in self.keys_by_provider:
            provider = TEXT_PROVIDER_OPENAI

        if provider == TEXT_PROVIDER_OPENAI and self.use_stt_for_openai_var.get():
            self.keys_by_provider[provider] = ""
        else:
            self.keys_by_provider[provider] = self.text_key_var.get().strip()

        config = AppConfig(
            openai_api_key=self.stt_key_var.get().strip(),
            text_provider=provider,
            openai_text_api_key=self.keys_by_provider[TEXT_PROVIDER_OPENAI],
            gemini_api_key=self.keys_by_provider[TEXT_PROVIDER_GEMINI],
            grok_api_key=self.keys_by_provider[TEXT_PROVIDER_GROK],
            text_model=self.text_model_var.get().strip() or default_model_for_provider(provider),
        )

        if not config.openai_api_key:
            messagebox.showwarning("Config", "Informe OPENAI_API_KEY para o speech-to-text.")
            return

        save_config(config)
        self.app.apply_config(config)
        self._set_key_state()
        self._append_log(f"[config] Salvo. STT=OpenAI, Texto={PROVIDER_LABELS[provider]} ({config.text_model}).")

    def _set_key_state(self):
        if self.stt_key_var.get().strip():
            self._append_log("[config] Chave STT encontrada.")
        else:
            self._append_log("[config] Cadastre OPENAI_API_KEY para STT e salve.")

    def _append_log(self, msg: str):
        self.log_text.insert("end", msg + "\n")
        self.log_text.see("end")

    def _get_output_text(self) -> str:
        return self.output_text.get("1.0", "end").strip()

    def _copy_output_text(self):
        text = self._get_output_text()
        if not text:
            self._append_log("[copy] Ainda nao ha texto para copiar.")
            return
        pyperclip.copy(text)
        self._append_log("[copy] Resultado copiado para clipboard.")

    def _copy_status_text(self):
        text = self.log_text.get("1.0", "end").strip()
        if not text:
            self._append_log("[copy] Ainda nao ha status para copiar.")
            return
        pyperclip.copy(text)
        self._append_log("[copy] Status copiado para clipboard.")

    def on_status(self, msg: str):
        self.root.after(0, self._append_log, msg)

    def on_result(self, text: str):
        def _update():
            self.output_text.delete("1.0", "end")
            self.output_text.insert("1.0", text)
            self.processing_frame.grid_remove()
            self.processing_bar.stop()
            self.stop_button.configure(text="Parar (Enter/Espaco)")

        self.root.after(0, _update)

    def on_recording_change(self, recording: bool):
        self.is_recording = recording

        def _update():
            if recording:
                self.recording_state_var.set("Gravando agora")
                self.state_label.configure(fg="#0369a1")
                self.recording_hint_var.set("Fale normalmente. Enter/Espaco encerra e envia para transcricao.")
            else:
                self.recording_state_var.set("Aguardando proximo ditado")
                self.state_label.configure(fg=self.SUCCESS)
                self.recording_hint_var.set("Atalhos: F8/F9/F10/F11, Enter/Espaco para parar")

        self.root.after(0, _update)

    def on_audio_level(self, level: float):
        self.level_target = max(0.0, min(1.0, level))

    def on_processing_change(self, processing: bool, message: str):
        def _update():
            if processing:
                self.processing_label_var.set(message or "Processando...")
                self.processing_frame.grid()
                self.processing_bar.start(10)
                self.stop_button.configure(text="Parar Processamento")
            else:
                self.processing_frame.grid_remove()
                self.processing_bar.stop()
                self.stop_button.configure(text="Parar (Enter/Espaco)")

        self.root.after(0, _update)

    def _on_close(self):
        self.hotkeys.stop()
        if self.meter_after_id is not None:
            self.root.after_cancel(self.meter_after_id)
        self.root.destroy()

    def run(self):
        self.root.mainloop()


def parse_args():
    parser = argparse.ArgumentParser(description="Ditado global com interface")
    parser.add_argument("--stt-model", default=DEFAULT_STT_MODEL)
    parser.add_argument("--sample-rate", type=int, default=16000)
    return parser.parse_args()


def main():
    args = parse_args()
    config = load_config()

    app = DitadoApp(
        stt_model=args.stt_model,
        sample_rate=args.sample_rate,
        config=config,
    )
    hotkeys = HotkeyController(app)
    ui = DitadoUI(app, hotkeys, config)

    app.on_status = ui.on_status
    app.on_result = ui.on_result
    app.on_recording_change = ui.on_recording_change
    app.on_audio_level = ui.on_audio_level
    app.on_processing_change = ui.on_processing_change

    ui.run()


if __name__ == "__main__":
    main()
