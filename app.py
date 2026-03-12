#!/usr/bin/env python3
import argparse
import json
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
import urllib.parse
import urllib.request
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
APP_NAME = "HelpScribe"
FREE_LLM_PROVIDER = os.getenv("HELPSCRIBE_FREE_LLM_PROVIDER", "gemini").strip().lower() or "gemini"
FREE_LLM_API_KEY = os.getenv("HELPSCRIBE_FREE_LLM_API_KEY", "").strip()
FREE_LLM_MODEL = os.getenv("HELPSCRIBE_FREE_LLM_MODEL", "").strip()

TEXT_PROVIDER_OPENAI = "openai"
TEXT_PROVIDER_GEMINI = "gemini"
TEXT_PROVIDER_GROK = "grok"
TEXT_PROVIDER_FREE = "free"

LANGUAGE_OPTIONS = {
    "pt": "Português",
    "en": "Inglês",
    "es": "Espanhol",
    "fr": "Francês",
    "de": "Alemão",
}

UI_LANGUAGE_OPTIONS = {
    "pt": "🇧🇷 PT",
    "en": "🇺🇸 EN",
    "fr": "🇫🇷 FR",
}

UI_STRINGS = {
    "pt": {
        "subtitle": "Ditado com colagem automática e pipeline de edição com LLM.",
        "ready": "● Pronto",
        "config": "Configurações",
        "config_btn": "⚙ Configurações",
        "stt_section": "▾ STT",
        "llm_section": "▾ LLM",
        "translation_section": "▾ Tradução",
        "stt_key": "STT API Key",
        "view_edit": "Ver/Editar",
        "llm_text_model": "LLM Text & Model",
        "translation_lang": "Idioma da tradução",
        "same_stt": "Use same STT key for LLM",
        "free_llm": "If no key, use pre-configured free LLM",
        "save_config": "Salvar Configurações",
        "dictate": "Gravar   F8",
        "rewrite": "Reescrever   F9",
        "translate": "Traduzir   F10",
        "prompt_codex": "Prompt Codex   F11",
        "translation_label": "Tradução:",
        "ui_label": "Interface:",
        "text_final": "Texto final",
        "text_final_sub": "Dite, revise e publique — sem fricção.",
        "history": "Histórico",
        "status_log": "Status Log",
        "assistant": "Assistente",
        "audio": "Áudio",
        "mode_dictate": "Modo: Ditar",
        "text_actions": "Ações no Texto",
        "stop": "Parar (Enter/Espaço)",
        "copy_result": "Copiar Resultado",
        "copy_status": "Copiar Status",
        "use_history": "Usar histórico",
        "rewrite_prompt": "Reescrever prompt",
        "retranslate": "Retraduzir",
        "rewrite_text": "Reescrever texto",
        "processing": "Processando...",
        "recording_now": "Gravando agora",
        "awaiting": "Aguardando próximo ditado",
        "hint_recording": "Fale normalmente. Enter/Espaco encerra e envia para transcricao.",
        "hint_idle": "Atalhos: F8/F9/F10/F11, Enter/Espaco para parar",
    },
    "en": {
        "subtitle": "Dictation with auto-paste and LLM editing pipeline.",
        "ready": "● Ready",
        "config": "Settings",
        "config_btn": "⚙ Settings",
        "stt_section": "▾ STT",
        "llm_section": "▾ LLM",
        "translation_section": "▾ Translation",
        "stt_key": "STT API Key",
        "view_edit": "View/Edit",
        "llm_text_model": "LLM Text & Model",
        "translation_lang": "Translation language",
        "same_stt": "Use same STT key for LLM",
        "free_llm": "If no key, use pre-configured free LLM",
        "save_config": "Save Settings",
        "dictate": "Dictate   F8",
        "rewrite": "Rewrite   F9",
        "translate": "Translate   F10",
        "prompt_codex": "Codex Prompt   F11",
        "translation_label": "Translate:",
        "ui_label": "Interface:",
        "text_final": "Final text",
        "text_final_sub": "Dictate, revise, and publish — frictionless.",
        "history": "History",
        "status_log": "Status Log",
        "assistant": "Assistant",
        "audio": "Audio",
        "mode_dictate": "Mode: Dictate",
        "text_actions": "Text Actions",
        "stop": "Stop (Enter/Space)",
        "copy_result": "Copy Result",
        "copy_status": "Copy Status",
        "use_history": "Use history",
        "rewrite_prompt": "Rewrite prompt",
        "retranslate": "Retranslate",
        "rewrite_text": "Rewrite text",
        "processing": "Processing...",
        "recording_now": "Recording now",
        "awaiting": "Waiting for next dictation",
        "hint_recording": "Speak naturally. Enter/Space stops and sends to transcription.",
        "hint_idle": "Hotkeys: F8/F9/F10/F11, Enter/Space to stop",
    },
    "fr": {
        "subtitle": "Dictée avec collage automatique et pipeline d'édition LLM.",
        "ready": "● Prêt",
        "config": "Paramètres",
        "config_btn": "⚙ Paramètres",
        "stt_section": "▾ STT",
        "llm_section": "▾ LLM",
        "translation_section": "▾ Traduction",
        "stt_key": "Clé API STT",
        "view_edit": "Voir/Éditer",
        "llm_text_model": "LLM Texte & Modèle",
        "translation_lang": "Langue de traduction",
        "same_stt": "Utiliser la même clé STT pour le LLM",
        "free_llm": "Sans clé, utiliser le LLM gratuit préconfiguré",
        "save_config": "Enregistrer",
        "dictate": "Dicter   F8",
        "rewrite": "Réécrire   F9",
        "translate": "Traduire   F10",
        "prompt_codex": "Prompt Codex   F11",
        "translation_label": "Traduction:",
        "ui_label": "Interface:",
        "text_final": "Texte final",
        "text_final_sub": "Dictez, révisez et publiez — sans friction.",
        "history": "Historique",
        "status_log": "Journal",
        "assistant": "Assistant",
        "audio": "Audio",
        "mode_dictate": "Mode: Dictée",
        "text_actions": "Actions texte",
        "stop": "Arrêter (Entrée/Espace)",
        "copy_result": "Copier le résultat",
        "copy_status": "Copier le statut",
        "use_history": "Utiliser l'historique",
        "rewrite_prompt": "Réécrire le prompt",
        "retranslate": "Retraduire",
        "rewrite_text": "Réécrire le texte",
        "processing": "Traitement...",
        "recording_now": "Enregistrement en cours",
        "awaiting": "En attente du prochain dictée",
        "hint_recording": "Parlez normalement. Entrée/Espace arrête et envoie la transcription.",
        "hint_idle": "Raccourcis: F8/F9/F10/F11, Entrée/Espace pour arrêter",
    },
}

PROVIDER_LABELS = {
    TEXT_PROVIDER_FREE: "Free (Sem Chave)",
    TEXT_PROVIDER_OPENAI: "OpenAI",
    TEXT_PROVIDER_GEMINI: "Gemini",
    TEXT_PROVIDER_GROK: "Grok",
}

ENV_KEYS = [
    "OPENAI_API_KEY",
    "TEXT_PROVIDER",
    "USE_FREE_LLM",
    "OPENAI_TEXT_API_KEY",
    "GEMINI_API_KEY",
    "GROK_API_KEY",
    "TEXT_MODEL",
]


@dataclass
class Job:
    audio_path: str
    action: str  # dictate | rewrite | translate_selected | translate_pt | prompt_codex


class ProcessingCanceled(Exception):
    pass


@dataclass
class AppConfig:
    openai_api_key: str = ""
    text_provider: str = TEXT_PROVIDER_FREE
    use_free_llm: bool = True
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
        text_provider=(data.get("TEXT_PROVIDER", TEXT_PROVIDER_FREE).strip().lower() or TEXT_PROVIDER_FREE),
        use_free_llm=data.get("USE_FREE_LLM", "1").strip().lower() in {"1", "true", "yes", "on"},
        openai_text_api_key=data.get("OPENAI_TEXT_API_KEY", "").strip(),
        gemini_api_key=data.get("GEMINI_API_KEY", "").strip(),
        grok_api_key=data.get("GROK_API_KEY", "").strip(),
        text_model=data.get("TEXT_MODEL", "").strip(),
    )


def save_config(config: AppConfig) -> None:
    values = {
        "OPENAI_API_KEY": config.openai_api_key.strip(),
        "TEXT_PROVIDER": config.text_provider.strip().lower(),
        "USE_FREE_LLM": "1" if config.use_free_llm else "0",
        "OPENAI_TEXT_API_KEY": config.openai_text_api_key.strip(),
        "GEMINI_API_KEY": config.gemini_api_key.strip(),
        "GROK_API_KEY": config.grok_api_key.strip(),
        "TEXT_MODEL": config.text_model.strip(),
    }
    with open(ENV_PATH, "w", encoding="utf-8") as f:
        for key in ENV_KEYS:
            f.write(f"{key}={values.get(key, '')}\n")


def default_model_for_provider(provider: str) -> str:
    if provider == TEXT_PROVIDER_FREE:
        return "free-basic"
    if provider == TEXT_PROVIDER_GEMINI:
        return DEFAULT_TEXT_MODEL_GEMINI
    if provider == TEXT_PROVIDER_GROK:
        return DEFAULT_TEXT_MODEL_GROK
    return DEFAULT_TEXT_MODEL_OPENAI


def client_for_provider(provider: str, api_key: str) -> Optional[OpenAI]:
    key = api_key.strip()
    if not key:
        return None
    if provider == TEXT_PROVIDER_GEMINI:
        return OpenAI(api_key=key, base_url="https://generativelanguage.googleapis.com/v1beta/openai/")
    if provider == TEXT_PROVIDER_GROK:
        return OpenAI(api_key=key, base_url="https://api.x.ai/v1/")
    return OpenAI(api_key=key)


class DitadoApp:
    def __init__(
        self,
        stt_model: str,
        sample_rate: int,
        config: Optional[AppConfig] = None,
        on_status: Optional[Callable[[str], None]] = None,
        on_result: Optional[Callable[[str], None]] = None,
        on_transcription: Optional[Callable[[str], None]] = None,
        on_recording_change: Optional[Callable[[bool], None]] = None,
        on_audio_level: Optional[Callable[[float], None]] = None,
        on_processing_change: Optional[Callable[[bool, str], None]] = None,
    ):
        self.stt_model = stt_model
        self.sample_rate = sample_rate

        self.on_status = on_status
        self.on_result = on_result
        self.on_transcription = on_transcription
        self.on_recording_change = on_recording_change
        self.on_audio_level = on_audio_level
        self.on_processing_change = on_processing_change

        self.stt_client: Optional[OpenAI] = None
        self.text_client: Optional[OpenAI] = None

        self.text_provider = TEXT_PROVIDER_FREE
        self.text_model = default_model_for_provider(TEXT_PROVIDER_FREE)

        self.is_recording = False
        self.is_processing = False
        self.current_action = "dictate"
        self.target_language = "en"
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

        provider = config.text_provider.strip().lower() or TEXT_PROVIDER_FREE
        if provider not in {TEXT_PROVIDER_FREE, TEXT_PROVIDER_OPENAI, TEXT_PROVIDER_GEMINI, TEXT_PROVIDER_GROK}:
            provider = TEXT_PROVIDER_FREE
        selected_model = config.text_model.strip() or default_model_for_provider(provider)

        provider_keys = {
            TEXT_PROVIDER_FREE: "",
            TEXT_PROVIDER_OPENAI: config.openai_text_api_key.strip(),
            TEXT_PROVIDER_GEMINI: config.gemini_api_key.strip(),
            TEXT_PROVIDER_GROK: config.grok_api_key.strip(),
        }
        if provider == TEXT_PROVIDER_OPENAI and not provider_keys[TEXT_PROVIDER_OPENAI]:
            provider_keys[TEXT_PROVIDER_OPENAI] = stt_key

        # 1) Prioriza chave explicitamente configurada para o provedor escolhido.
        chosen_provider = provider
        chosen_key = provider_keys.get(provider, "")
        chosen_model = selected_model

        # Provedor free nao precisa chave.
        if chosen_provider == TEXT_PROVIDER_FREE:
            chosen_key = "internal-free-mode"

        # 2) Se nao houver chave e usuario permitiu, tenta LLM Free pre-configurada.
        if not chosen_key and config.use_free_llm and FREE_LLM_API_KEY:
            free_provider = FREE_LLM_PROVIDER
            if free_provider not in {TEXT_PROVIDER_OPENAI, TEXT_PROVIDER_GEMINI, TEXT_PROVIDER_GROK}:
                free_provider = TEXT_PROVIDER_GEMINI
            chosen_provider = free_provider
            chosen_key = FREE_LLM_API_KEY
            chosen_model = FREE_LLM_MODEL or default_model_for_provider(free_provider)
            self._status(f"[config] Usando LLM Free pre-configurada ({PROVIDER_LABELS[chosen_provider]}).")

        # 3) Fallback: usa OpenAI com chave STT para evitar erro de sem chave.
        if not chosen_key and stt_key:
            chosen_provider = TEXT_PROVIDER_OPENAI
            chosen_key = stt_key
            chosen_model = default_model_for_provider(TEXT_PROVIDER_OPENAI)
            self._status("[config] Sem chave de texto; usando OPENAI_API_KEY (STT) como fallback.")

        self.text_provider = chosen_provider
        self.text_model = chosen_model
        if chosen_provider == TEXT_PROVIDER_FREE:
            self.text_client = None
        else:
            self.text_client = client_for_provider(chosen_provider, chosen_key)

    def has_stt_key(self) -> bool:
        return self.stt_client is not None

    def set_target_language(self, lang_code: str):
        if lang_code in LANGUAGE_OPTIONS:
            self.target_language = lang_code

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
        if self.text_provider == TEXT_PROVIDER_FREE:
            return self._free_prompt_completion(prompt)

        if self.text_client is None:
            raise RuntimeError(
                f"Chave do provedor de texto ({self.text_provider}) nao configurada. "
                "Configure sua chave na tela ou defina HELPSCRIBE_FREE_LLM_API_KEY para o modo Free."
            )

        response = self.text_client.chat.completions.create(
            model=self.text_model,
            temperature=temperature,
            messages=[
                {"role": "system", "content": "Voce e um assistente de escrita e traducao tecnica."},
                {"role": "user", "content": prompt},
            ],
        )
        return (response.choices[0].message.content or "").strip()

    def _free_prompt_completion(self, prompt: str) -> str:
        # Fallback simples para modo sem chave: limpa texto e retorna estrutura.
        text = prompt.strip()
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            return ""
        return text

    def _free_rewrite(self, text: str) -> str:
        cleaned = re.sub(r"\s+", " ", text).strip()
        if not cleaned:
            return ""
        cleaned = cleaned[0].upper() + cleaned[1:] if len(cleaned) > 1 else cleaned.upper()
        if cleaned[-1] not in ".!?":
            cleaned += "."
        return cleaned

    def _free_translate(self, text: str, target: str) -> str:
        src = "pt" if target == "en" else "en"
        tgt = "en" if target == "en" else "pt"
        try:
            query = urllib.parse.urlencode({"q": text, "langpair": f"{src}|{tgt}"})
            url = f"https://api.mymemory.translated.net/get?{query}"
            with urllib.request.urlopen(url, timeout=8) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            translated = (
                payload.get("responseData", {}).get("translatedText", "").strip()
                if isinstance(payload, dict)
                else ""
            )
            if translated:
                return translated
        except Exception:
            pass
        return text

    def _rewrite_with_llm(self, text: str) -> str:
        if self.text_provider == TEXT_PROVIDER_FREE:
            return self._free_rewrite(text)
        prompt = (
            "Reescreva o texto abaixo em portugues claro e objetivo, mantendo o sentido. "
            "Corrija pontuacao e ortografia.\n\n"
            f"Texto:\n{text}"
        )
        return self._text_complete(prompt, temperature=0.2)

    def _translate(self, text: str, target: str) -> str:
        if self.text_provider == TEXT_PROVIDER_FREE:
            return self._free_translate(text, target)
        target_label = {
            "en": "ingles",
            "pt": "portugues",
            "es": "espanhol",
            "fr": "frances",
            "de": "alemao",
        }.get(target, target)
        prompt = f"Traduza o texto abaixo para {target_label}. Responda apenas com a traducao.\n\n{text}"
        return self._text_complete(prompt, temperature=0.0)

    def _build_codex_prompt(self, text: str) -> str:
        if self.text_provider == TEXT_PROVIDER_FREE:
            base = self._free_rewrite(text)
            return (
                "Objetivo:\n" + base + "\n\n"
                "Contexto:\nDescreva o ambiente e restricoes tecnicas.\n\n"
                "Requisitos:\nListe requisitos funcionais e nao funcionais.\n\n"
                "Criterios de aceite:\nDefina como validar o resultado.\n\n"
                "Passos sugeridos:\n1. Planejar\n2. Implementar\n3. Testar\n4. Entregar"
            )
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
            ("translate_selected", r"(traduza para ingles|traduz para ingles)$"),
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
                if self.on_transcription:
                    self.on_transcription(text)

                voice_action, cleaned_text = self._extract_voice_action(text)
                action = job.action
                if action == "dictate" and voice_action != "dictate":
                    action = voice_action
                    text = cleaned_text
                    self._status(f"[cmd] Comando de voz detectado: {voice_action}")
                self._check_canceled()

                if action == "rewrite":
                    text = self._rewrite_with_llm(text)
                elif action == "translate_selected":
                    text = self._translate(text, self.target_language)
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

    def transform_text(self, original_text: str, mode: str, on_done: Callable[[Optional[str], Optional[str]], None]):
        text = (original_text or "").strip()
        if not text:
            on_done(None, "Nao ha texto transcrito para transformar.")
            return

        self.cancel_requested = False
        self._set_processing_state(True, "Processando transformacao...")

        def _run():
            try:
                self._check_canceled()

                if mode == "rewrite_prompt":
                    result = self._build_codex_prompt(text)
                elif mode == "retranslate":
                    # Retraduz: se parece portugues, vai para ingles; senao para portugues.
                    has_pt_marker = bool(re.search(r"\b(que|para|com|uma|de|não|voce|você)\b", text.lower()))
                    target = "en" if has_pt_marker else "pt"
                    result = self._translate(text, target)
                elif mode == "rewrite_text":
                    result = self._rewrite_with_llm(text)
                else:
                    result = text

                self._check_canceled()
                on_done(result, None)
            except ProcessingCanceled:
                on_done(None, "Transformacao interrompida.")
            except Exception as exc:
                on_done(None, str(exc))
            finally:
                self._set_processing_state(False, "")

        threading.Thread(target=_run, daemon=True).start()


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
                self.app.toggle_recording("translate_selected")
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
    BG = "#f3f6fb"
    CARD = "#edf2fa"
    CARD_ALT = "#ffffff"
    TEXT = "#0f172a"
    MUTED = "#64748b"
    ACCENT = "#2563eb"
    SUCCESS = "#15803d"

    def __init__(self, app: DitadoApp, hotkeys: HotkeyController, config: AppConfig):
        self.app = app
        self.hotkeys = hotkeys
        self.current_transcribed_text = ""
        self.history_items: list[dict[str, str]] = []
        self.record_buttons: dict[str, ttk.Button] = {}
        self.ui_language = "pt"

        self.root = tk.Tk()
        self.root.title(APP_NAME)
        self.root.geometry("1180x800")
        self.root.minsize(920, 640)
        self.root.configure(bg=self.BG)
        self._set_app_icon()

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

    def _set_app_icon(self):
        # On macOS launched from python, the Dock icon can default to the Python rocket.
        # Force an app-specific icon at runtime.
        if platform.system() != "Darwin":
            return
        try:
            from AppKit import (
                NSApplication,
                NSAttributedString,
                NSBezierPath,
                NSColor,
                NSFont,
                NSFontAttributeName,
                NSForegroundColorAttributeName,
                NSImage,
                NSMakeRect,
            )

            size = 256
            image = NSImage.alloc().initWithSize_((size, size))
            image.lockFocus()

            bg = NSColor.colorWithCalibratedRed_green_blue_alpha_(0.10, 0.16, 0.28, 1.0)
            fg = NSColor.colorWithCalibratedRed_green_blue_alpha_(1.0, 1.0, 1.0, 1.0)

            rounded = NSBezierPath.bezierPathWithRoundedRect_xRadius_yRadius_(
                NSMakeRect(8, 8, size - 16, size - 16), 54, 54
            )
            bg.setFill()
            rounded.fill()

            attrs = {
                NSFontAttributeName: NSFont.boldSystemFontOfSize_(112),
                NSForegroundColorAttributeName: fg,
            }
            text = NSAttributedString.alloc().initWithString_attributes_("HS", attrs)
            text.drawAtPoint_((50, 64))

            image.unlockFocus()
            NSApplication.sharedApplication().setApplicationIconImage_(image)
        except Exception:
            # Keep app running even if icon setup fails on this machine.
            return

    def _configure_styles(self):
        style = ttk.Style()
        style.theme_use("clam")

        style.configure("App.TFrame", background=self.BG)
        style.configure("Card.TFrame", background=self.CARD, relief="flat", borderwidth=0)
        style.configure("CardAlt.TFrame", background=self.CARD_ALT, relief="flat", borderwidth=0)

        style.configure("Header.TLabel", background=self.BG, foreground=self.TEXT, font=("Avenir Next", 23, "bold"))
        style.configure("Sub.TLabel", background=self.BG, foreground=self.MUTED, font=("Avenir Next", 11))
        style.configure("Field.TLabel", background=self.CARD, foreground="#1e293b", font=("Avenir Next", 11, "bold"))
        style.configure("PanelTitle.TLabel", background=self.CARD_ALT, foreground=self.TEXT, font=("Avenir Next", 12, "bold"))
        style.configure("Chip.TLabel", background="#ecfdf3", foreground="#15803d", font=("Avenir Next", 10, "bold"))

        style.configure(
            "Primary.TButton",
            background=self.ACCENT,
            foreground="#ffffff",
            font=("Avenir Next", 11, "bold"),
            borderwidth=0,
            focusthickness=3,
            focuscolor=self.ACCENT,
            padding=(14, 9),
        )
        style.map("Primary.TButton", background=[("active", "#1d4ed8"), ("pressed", "#1e40af")])
        style.configure(
            "Danger.TButton",
            background="#e5484d",
            foreground="#ffffff",
            font=("Avenir Next", 11, "bold"),
            borderwidth=0,
            focusthickness=3,
            focuscolor="#e5484d",
            padding=(14, 9),
        )
        style.map("Danger.TButton", background=[("active", "#d63f45"), ("pressed", "#c73a40")])

        style.configure(
            "Ghost.TButton",
            background="#f8fbff",
            foreground="#334155",
            font=("Avenir Next", 10, "bold"),
            borderwidth=0,
            padding=(11, 8),
        )
        style.map("Ghost.TButton", background=[("active", "#edf4ff"), ("pressed", "#e2ecff")])
        style.configure(
            "Secondary.TButton",
            background="#ffffff",
            foreground="#1e293b",
            font=("Avenir Next", 10, "bold"),
            borderwidth=1,
            relief="solid",
            padding=(11, 8),
        )
        style.map("Secondary.TButton", background=[("active", "#f4f9ff"), ("pressed", "#e8f1ff")])

        style.configure("TEntry", fieldbackground="#ffffff", foreground=self.TEXT, insertcolor=self.TEXT, borderwidth=0)
        style.configure("TCombobox", fieldbackground="#ffffff", foreground=self.TEXT, borderwidth=0)
        style.configure("TCheckbutton", background=self.CARD, foreground=self.TEXT, font=("Avenir Next", 10))
        style.configure("Soft.TEntry", fieldbackground="#ffffff", foreground=self.TEXT, insertcolor=self.TEXT, borderwidth=0, relief="flat", padding=9)
        style.configure("Soft.TCombobox", fieldbackground="#ffffff", foreground=self.TEXT, borderwidth=0, relief="flat")
        style.configure("Treeview", background="#ffffff", fieldbackground="#ffffff", foreground=self.TEXT, rowheight=28, borderwidth=0)
        style.configure("Treeview.Heading", background="#f7f9fd", foreground="#475569", font=("Avenir Next", 10, "bold"))

    def _build_layout(self, config: AppConfig):
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(1, weight=1)

        top = ttk.Frame(self.root, style="App.TFrame", padding=(14, 12, 14, 8))
        top.grid(row=0, column=0, sticky="ew")
        top.columnconfigure(1, weight=1)

        logo = tk.Canvas(top, width=34, height=34, bg=self.BG, highlightthickness=0)
        logo.grid(row=0, column=0, rowspan=2, sticky="w", padx=(0, 8))
        logo.create_oval(2, 2, 32, 32, fill="#0f172a", outline="")
        logo.create_oval(12, 9, 22, 19, fill="#ffffff", outline="")
        logo.create_rectangle(16, 19, 18, 25, fill="#ffffff", outline="")
        logo.create_arc(8, 17, 26, 29, start=200, extent=140, style="arc", outline="#ffffff", width=2)

        ttk.Label(top, text=APP_NAME, style="Header.TLabel").grid(row=0, column=1, sticky="w")
        self.config_button = ttk.Button(top, text="⚙ Configurações", style="Ghost.TButton", command=self._toggle_sidebar)
        self.config_button.grid(row=0, column=2, sticky="e", padx=(0, 8))
        self.ready_chip = ttk.Label(top, text="● Pronto", style="Chip.TLabel")
        self.ready_chip.grid(row=0, column=3, sticky="e")
        self.subtitle_label = ttk.Label(top, text="", style="Sub.TLabel")
        self.subtitle_label.grid(row=1, column=1, sticky="w")

        main = ttk.Frame(self.root, style="App.TFrame", padding=(14, 0, 14, 12))
        main.grid(row=1, column=0, sticky="nsew")
        main.columnconfigure(0, weight=1)
        main.rowconfigure(0, weight=1)

        self.sidebar_expanded = False

        # Sidebar (esquerda)
        self.sidebar = ttk.Frame(self.root, style="Card.TFrame", padding=12)
        self.sidebar.columnconfigure(0, weight=1)
        self.sidebar.place_forget()

        self.sidebar_title_label = ttk.Label(self.sidebar, text="", style="PanelTitle.TLabel")
        self.sidebar_title_label.grid(row=0, column=0, sticky="w", pady=(0, 8))

        self.stt_section_btn = ttk.Button(self.sidebar, text="▾ STT", style="Ghost.TButton", command=lambda: self._toggle_config_section("stt"))
        self.stt_section_btn.grid(row=1, column=0, sticky="ew", pady=(0, 4))
        stt_box = ttk.Frame(self.sidebar, style="CardAlt.TFrame", padding=10)
        stt_box.grid(row=2, column=0, sticky="ew", pady=(0, 8))
        stt_box.columnconfigure(0, weight=1)
        self.stt_box = stt_box
        self.stt_key_label = ttk.Label(stt_box, text="", style="Field.TLabel")
        self.stt_key_label.grid(row=0, column=0, sticky="w")
        self.stt_key_var = tk.StringVar(value=config.openai_api_key)
        ttk.Entry(stt_box, textvariable=self.stt_key_var, show="*", style="Soft.TEntry").grid(row=1, column=0, sticky="ew", pady=(6, 6))
        self.view_edit_button = ttk.Button(stt_box, text="", style="Ghost.TButton", command=lambda: None)
        self.view_edit_button.grid(row=2, column=0, sticky="ew")
        self.test_connection_button = ttk.Button(stt_box, text="Testar conexão", style="Ghost.TButton", command=self._set_key_state)
        self.test_connection_button.grid(row=3, column=0, sticky="ew", pady=(6, 0))

        self.llm_section_btn = ttk.Button(self.sidebar, text="▾ LLM", style="Ghost.TButton", command=lambda: self._toggle_config_section("llm"))
        self.llm_section_btn.grid(row=3, column=0, sticky="ew", pady=(0, 4))
        llm_box = ttk.Frame(self.sidebar, style="CardAlt.TFrame", padding=10)
        llm_box.grid(row=4, column=0, sticky="ew", pady=(0, 8))
        llm_box.columnconfigure(0, weight=1)
        self.llm_box = llm_box
        self.llm_label = ttk.Label(llm_box, text="", style="Field.TLabel")
        self.llm_label.grid(row=0, column=0, sticky="w")
        self.provider_var = tk.StringVar(value=config.text_provider)
        provider_combo = ttk.Combobox(
            llm_box,
            textvariable=self.provider_var,
            values=[TEXT_PROVIDER_FREE, TEXT_PROVIDER_OPENAI, TEXT_PROVIDER_GEMINI, TEXT_PROVIDER_GROK],
            state="readonly",
            style="Soft.TCombobox",
        )
        provider_combo.grid(row=1, column=0, sticky="ew", pady=(6, 6))
        provider_combo.bind("<<ComboboxSelected>>", self._on_provider_change)
        self.text_key_var = tk.StringVar()
        self.text_key_entry = ttk.Entry(llm_box, textvariable=self.text_key_var, show="*", style="Soft.TEntry")
        self.text_key_entry.grid(row=2, column=0, sticky="ew", pady=(0, 6))
        self.text_model_var = tk.StringVar(value=config.text_model or default_model_for_provider(config.text_provider))
        ttk.Entry(llm_box, textvariable=self.text_model_var, style="Soft.TEntry").grid(row=3, column=0, sticky="ew")

        self.translation_section_btn = ttk.Button(self.sidebar, text="▾ Tradução", style="Ghost.TButton", command=lambda: self._toggle_config_section("translation"))
        self.translation_section_btn.grid(row=5, column=0, sticky="ew", pady=(0, 4))
        translation_box = ttk.Frame(self.sidebar, style="CardAlt.TFrame", padding=10)
        translation_box.grid(row=6, column=0, sticky="ew", pady=(0, 8))
        translation_box.columnconfigure(0, weight=1)
        self.translation_box = translation_box

        self.translation_lang_label = ttk.Label(translation_box, text="", style="Field.TLabel")
        self.translation_lang_label.grid(row=0, column=0, sticky="w", pady=(0, 2))
        self.translation_lang_var = tk.StringVar(value=LANGUAGE_OPTIONS.get(self.app.target_language, "Inglês"))
        self.lang_combo = ttk.Combobox(
            translation_box,
            textvariable=self.translation_lang_var,
            values=list(LANGUAGE_OPTIONS.values()),
            state="readonly",
            style="Soft.TCombobox",
        )
        self.lang_combo.grid(row=1, column=0, sticky="ew")
        self.lang_combo.bind("<<ComboboxSelected>>", self._on_language_change)
        self._on_language_change()

        self.use_stt_for_openai_var = tk.BooleanVar(value=True)
        self.use_stt_key_check = ttk.Checkbutton(
            self.sidebar,
            text="",
            variable=self.use_stt_for_openai_var,
            command=self._on_use_stt_key_toggle,
        )
        self.use_stt_key_check.grid(row=7, column=0, sticky="w", pady=(8, 2), padx=(2, 0))

        self.use_free_llm_var = tk.BooleanVar(value=config.use_free_llm)
        self.use_free_llm_check = ttk.Checkbutton(
            self.sidebar,
            text="",
            variable=self.use_free_llm_var,
        )
        self.use_free_llm_check.grid(row=8, column=0, sticky="w", pady=(0, 10), padx=(2, 0))

        self.save_button = ttk.Button(self.sidebar, text="", style="Primary.TButton", command=self._save_all_config)
        self.save_button.grid(
            row=9, column=0, sticky="ew", pady=(6, 0)
        )
        self.config_sections_visible = {"stt": True, "llm": True, "translation": True}

        self.keys_by_provider = {
            TEXT_PROVIDER_FREE: "",
            TEXT_PROVIDER_OPENAI: config.openai_text_api_key,
            TEXT_PROVIDER_GEMINI: config.gemini_api_key,
            TEXT_PROVIDER_GROK: config.grok_api_key,
        }
        self.use_stt_for_openai_var.set(not bool(self.keys_by_provider[TEXT_PROVIDER_OPENAI]))
        self._sync_text_key_field_from_provider()

        # Conteúdo principal (direita)
        content = ttk.Frame(main, style="App.TFrame")
        content.grid(row=0, column=0, sticky="nsew")
        content.columnconfigure(0, weight=1)
        content.rowconfigure(2, weight=1)

        actions = ttk.Frame(content, style="Card.TFrame", padding=8)
        actions.grid(row=0, column=0, sticky="ew", pady=(0, 10))
        self.record_buttons["dictate"] = ttk.Button(
            actions, text="", style="Danger.TButton", command=lambda: self.app.toggle_recording("dictate")
        )
        self.record_buttons["dictate"].pack(side="left", padx=4)
        self.record_buttons["rewrite"] = ttk.Button(
            actions, text="", style="Secondary.TButton", command=lambda: self.app.toggle_recording("rewrite")
        )
        self.record_buttons["rewrite"].pack(side="left", padx=4)
        self.record_buttons["translate_selected"] = ttk.Button(
            actions, text="", style="Secondary.TButton", command=lambda: self.app.toggle_recording("translate_selected")
        )
        self.record_buttons["translate_selected"].pack(side="left", padx=4)
        self.record_buttons["prompt_codex"] = ttk.Button(
            actions, text="", style="Secondary.TButton", command=lambda: self.app.toggle_recording("prompt_codex")
        )
        self.record_buttons["prompt_codex"].pack(side="left", padx=4)

        self.ui_lang_var = tk.StringVar(value=UI_LANGUAGE_OPTIONS.get("pt", "🇧🇷 PT"))
        self.ui_lang_combo = ttk.Combobox(
            actions,
            textvariable=self.ui_lang_var,
            values=list(UI_LANGUAGE_OPTIONS.values()),
            state="readonly",
            width=9,
            style="Soft.TCombobox",
        )
        self.ui_lang_combo.pack(side="right", padx=(0, 4))
        self.ui_lang_combo.bind("<<ComboboxSelected>>", self._on_ui_language_change)
        self.ui_lang_label = ttk.Label(actions, text="", style="Sub.TLabel")
        self.ui_lang_label.pack(side="right", padx=(10, 4))

        self.main_lang_combo = ttk.Combobox(
            actions,
            textvariable=self.translation_lang_var,
            values=list(LANGUAGE_OPTIONS.values()),
            state="readonly",
            width=11,
            style="Soft.TCombobox",
        )
        self.main_lang_combo.pack(side="right", padx=(0, 4))
        self.main_lang_combo.bind("<<ComboboxSelected>>", self._on_language_change)
        self.translation_label_top = ttk.Label(actions, text="", style="Sub.TLabel")
        self.translation_label_top.pack(side="right", padx=(10, 4))

        self.processing_frame = ttk.Frame(content, style="App.TFrame")
        self.processing_frame.grid(row=1, column=0, sticky="ew", pady=(0, 8))
        self.processing_frame.columnconfigure(1, weight=1)
        self.processing_label_var = tk.StringVar(value="")
        self.processing_label = ttk.Label(self.processing_frame, textvariable=self.processing_label_var, style="Sub.TLabel")
        self.processing_label.grid(row=0, column=0, sticky="w")
        self.processing_bar = ttk.Progressbar(self.processing_frame, mode="indeterminate")
        self.processing_bar.grid(row=0, column=1, sticky="ew", padx=(10, 0))
        self.processing_frame.grid_remove()

        workspace = ttk.Frame(content, style="CardAlt.TFrame", padding=(10, 10, 10, 8))
        workspace.grid(row=2, column=0, sticky="nsew")
        workspace.columnconfigure(0, weight=1)
        # Texto final domina; area inferior sempre visivel com historico/log + assistente.
        workspace.rowconfigure(1, weight=6, minsize=220)
        workspace.rowconfigure(3, weight=3, minsize=210)

        self.text_final_title = ttk.Label(workspace, text="", style="PanelTitle.TLabel")
        self.text_final_title.grid(row=0, column=0, sticky="w")
        self.text_final_sub = ttk.Label(workspace, text="", style="Sub.TLabel")
        self.text_final_sub.grid(row=0, column=0, sticky="w", padx=(90, 0))
        self.output_metrics_var = tk.StringVar(value="Palavras: 0 | Tokens (est.): 0")
        tk.Label(workspace, textvariable=self.output_metrics_var, bg=self.CARD_ALT, fg=self.MUTED, font=("Avenir Next", 10)).grid(row=0, column=0, sticky="e")

        self.output_text = tk.Text(
            workspace,
            height=13,
            wrap="word",
            bg="#ffffff",
            fg="#0f172a",
            insertbackground=self.TEXT,
            relief="flat",
            borderwidth=0,
            highlightthickness=1,
            highlightbackground="#e2e8f0",
            highlightcolor="#bfdbfe",
            padx=12,
            pady=12,
        )
        self.output_text.grid(row=1, column=0, sticky="nsew", pady=(6, 6))
        self.output_text.bind("<<Modified>>", self._on_output_modified)

        bottom_actions = ttk.Frame(workspace, style="CardAlt.TFrame")
        bottom_actions.grid(row=2, column=0, sticky="ew")
        self.transform_menu_btn = ttk.Menubutton(bottom_actions, text="", style="Ghost.TButton")
        self.transform_menu = tk.Menu(self.transform_menu_btn, tearoff=0)
        self.transform_menu.add_command(label="", command=lambda: self._apply_text_action("rewrite_prompt"))
        self.transform_menu.add_command(label="", command=lambda: self._apply_text_action("retranslate"))
        self.transform_menu.add_command(label="", command=lambda: self._apply_text_action("rewrite_text"))
        self.transform_menu_btn["menu"] = self.transform_menu
        self.transform_menu_btn.pack(side="left", padx=(0, 6))
        self.transform_menu_btn.state(["disabled"])
        self.stop_button = ttk.Button(bottom_actions, text="", style="Danger.TButton", command=self._handle_stop)
        self.stop_button.pack(side="left")
        self.copy_status_btn = ttk.Button(bottom_actions, text="", style="Ghost.TButton", command=self._copy_status_text)
        self.copy_status_btn.pack(side="right", padx=(6, 0))
        self.copy_result_btn = ttk.Button(bottom_actions, text="", style="Ghost.TButton", command=self._copy_output_text)
        self.copy_result_btn.pack(side="right")

        lower = ttk.Frame(workspace, style="CardAlt.TFrame")
        lower.grid(row=3, column=0, sticky="nsew", pady=(4, 0))
        lower.columnconfigure(0, weight=3)
        lower.columnconfigure(1, weight=2)
        lower.rowconfigure(0, weight=1)

        tabs_card = ttk.Frame(lower, style="Card.TFrame", padding=8)
        tabs_card.grid(row=0, column=0, sticky="nsew", padx=(0, 6))
        tabs_card.columnconfigure(0, weight=1)
        tabs_card.rowconfigure(0, weight=1)

        self.bottom_tabs = ttk.Notebook(tabs_card)
        self.bottom_tabs.grid(row=0, column=0, sticky="nsew")

        history_panel = ttk.Frame(self.bottom_tabs, style="CardAlt.TFrame", padding=6)
        history_panel.columnconfigure(0, weight=1)
        history_panel.rowconfigure(1, weight=1)
        self.history_title = ttk.Label(history_panel, text="", style="PanelTitle.TLabel")
        self.history_title.grid(row=0, column=0, sticky="w", pady=(0, 4))
        self.history_tree = ttk.Treeview(
            history_panel,
            columns=("action", "time", "summary", "tokens"),
            show="headings",
            height=6,
        )
        self.history_tree.heading("action", text="Ação")
        self.history_tree.heading("time", text="Quando")
        self.history_tree.heading("summary", text="Resumo")
        self.history_tree.heading("tokens", text="Tokens")
        self.history_tree.column("action", width=90, stretch=False, anchor="w")
        self.history_tree.column("time", width=84, stretch=False, anchor="w")
        self.history_tree.column("summary", width=340, anchor="w")
        self.history_tree.column("tokens", width=70, stretch=False, anchor="center")
        self.history_tree.grid(row=1, column=0, sticky="nsew")
        self.history_tree.bind("<Double-Button-1>", self._use_selected_history)
        history_actions = ttk.Frame(history_panel, style="CardAlt.TFrame")
        history_actions.grid(row=2, column=0, sticky="e", pady=(4, 0))
        self.use_history_btn = ttk.Button(history_actions, text="", style="Ghost.TButton", command=self._use_selected_history)
        self.use_history_btn.pack(side="left", padx=(0, 6))
        self.copy_history_btn = ttk.Button(history_actions, text="Copiar", style="Ghost.TButton", command=self._copy_selected_history)
        self.copy_history_btn.pack(side="left")

        status_panel = ttk.Frame(self.bottom_tabs, style="CardAlt.TFrame", padding=6)
        status_panel.columnconfigure(0, weight=1)
        status_panel.rowconfigure(1, weight=1)
        self.status_title = ttk.Label(status_panel, text="", style="PanelTitle.TLabel")
        self.status_title.grid(row=0, column=0, sticky="w")
        self.log_text = tk.Text(
            status_panel,
            height=6,
            wrap="word",
            bg="#ffffff",
            fg="#0f172a",
            insertbackground=self.TEXT,
            relief="flat",
            borderwidth=0,
            highlightthickness=1,
            highlightbackground="#e2e8f0",
            highlightcolor="#bfdbfe",
            padx=10,
            pady=8,
        )
        self.log_text.grid(row=1, column=0, sticky="nsew", pady=(4, 0))
        self.bottom_tabs.add(history_panel, text="Histórico")
        self.bottom_tabs.add(status_panel, text="Status Log")

        right_stack = ttk.Frame(lower, style="CardAlt.TFrame")
        right_stack.grid(row=0, column=1, sticky="nsew")
        right_stack.columnconfigure(0, weight=1)
        right_stack.columnconfigure(1, weight=1)
        right_stack.rowconfigure(0, weight=1)

        assistant_card = ttk.Frame(right_stack, style="Card.TFrame", padding=8)
        assistant_card.grid(row=0, column=0, sticky="nsew", padx=(0, 4))
        assistant_card.columnconfigure(0, weight=1)
        assistant_info = ttk.Frame(assistant_card, style="Card.TFrame")
        assistant_info.grid(row=0, column=0, sticky="nsew")
        assistant_info.columnconfigure(0, weight=1)
        self.assistant_title = ttk.Label(assistant_info, text="", style="PanelTitle.TLabel")
        self.assistant_title.grid(row=0, column=0, sticky="w")
        self.mode_label = ttk.Label(assistant_info, text="", style="Sub.TLabel")
        self.mode_label.grid(row=1, column=0, sticky="w")

        self.recording_state_var = tk.StringVar(value="Pronto")
        self.recording_hint_var = tk.StringVar(value="")
        self.state_label = tk.Label(assistant_info, textvariable=self.recording_state_var, bg=self.CARD, fg=self.SUCCESS, font=("Avenir Next", 13, "bold"))
        self.state_label.grid(row=2, column=0, sticky="w", pady=(6, 0))
        self.hint_label = tk.Label(assistant_info, textvariable=self.recording_hint_var, bg=self.CARD, fg=self.MUTED, font=("Avenir Next", 9))
        self.hint_label.grid(row=3, column=0, sticky="w")

        audio_card = ttk.Frame(right_stack, style="Card.TFrame", padding=8)
        audio_card.grid(row=0, column=1, sticky="nsew", padx=(4, 0))
        audio_card.columnconfigure(0, weight=1)
        self.audio_title = ttk.Label(audio_card, text="Áudio", style="PanelTitle.TLabel")
        self.audio_title.grid(row=0, column=0, sticky="w")
        self.meter_canvas = tk.Canvas(
            audio_card,
            height=120,
            bg="#f8fbff",
            highlightthickness=0,
            bd=0,
        )
        self.meter_canvas.grid(row=1, column=0, sticky="nsew", pady=(6, 0))
        self.meter_canvas.bind("<Configure>", lambda _e: self._draw_meter(force=True))

        self.root.bind("<F8>", lambda event: self.app.toggle_recording("dictate"))
        self.root.bind("<F9>", lambda event: self.app.toggle_recording("rewrite"))
        self.root.bind("<F10>", lambda event: self.app.toggle_recording("translate_selected"))
        self.root.bind("<F11>", lambda event: self.app.toggle_recording("prompt_codex"))
        self.root.bind("<Return>", lambda event: self._stop_if_recording())
        self.root.bind("<space>", lambda event: self._stop_if_recording())
        self.root.bind("<Escape>", lambda _event: self._hide_sidebar())
        self.root.bind_all("<Button-1>", self._on_global_click, add="+")

        self._append_log("[ui] Visual atualizado com indicador dinamico de gravacao.")
        self._apply_locale()
        self._update_record_buttons(None)
        self._update_output_metrics()
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
        mid = height // 2
        points = []
        amp = 6 + signal * 28

        for x in range(0, width, 3):
            progress = x / max(width, 1)
            envelope = math.exp(-((progress - 0.5) ** 2) / 0.08)
            y = mid + math.sin((x / 18.0) + self.level_phase) * amp * envelope
            points.extend([x, y])

        if len(points) >= 4:
            canvas.create_line(points, fill="#3f7f98", width=2, smooth=True, splinesteps=20, tags="meter")
            canvas.create_line(points, fill="#7bb7ca", width=6, smooth=True, splinesteps=20, stipple="gray50", tags="meter")

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

    def _apply_text_action(self, mode: str):
        text = self.current_transcribed_text.strip()
        if not text:
            self._append_log("[acao] Grave e transcreva um texto antes de usar as opcoes de reescrita.")
            return

        self.transform_menu_btn.state(["disabled"])
        self.app.transform_text(text, mode, self._on_text_action_done)

    def _on_text_action_done(self, result: Optional[str], error: Optional[str]):
        def _update():
            self.transform_menu_btn.state(["!disabled"])
            if error:
                self._append_log(f"[acao] {error}")
                return

            if result is None:
                self._append_log("[acao] Sem resultado da transformacao.")
                return

            self.current_transcribed_text = result
            self.output_text.delete("1.0", "end")
            self.output_text.insert("1.0", result)
            self._update_output_metrics()
            self._append_log("[acao] Texto atualizado com a opcao escolhida.")

        self.root.after(0, _update)

    def _on_provider_change(self, _event=None):
        self._sync_text_key_field_from_provider(update_model=True)

    def _on_language_change(self, _event=None):
        selected_label = self.translation_lang_var.get()
        for code, label in LANGUAGE_OPTIONS.items():
            if label == selected_label:
                self.app.set_target_language(code)
                if hasattr(self, "log_text"):
                    self._append_log(f"[config] Idioma de tradução: {label}.")
                break

    def _on_use_stt_key_toggle(self):
        self._sync_text_key_field_from_provider()

    def _sync_text_key_field_from_provider(self, update_model: bool = False):
        provider = self.provider_var.get().strip().lower() or TEXT_PROVIDER_FREE
        current = self.keys_by_provider.get(provider, "")

        if provider == TEXT_PROVIDER_FREE:
            self.text_key_var.set("")
            self.text_key_entry.configure(state="disabled")
            self.use_stt_key_check.configure(state="disabled")
            self.use_free_llm_var.set(True)
        elif provider == TEXT_PROVIDER_OPENAI and self.use_stt_for_openai_var.get():
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
        provider = self.provider_var.get().strip().lower() or TEXT_PROVIDER_FREE
        if provider not in self.keys_by_provider:
            provider = TEXT_PROVIDER_FREE

        if provider == TEXT_PROVIDER_FREE:
            self.keys_by_provider[provider] = ""
        elif provider == TEXT_PROVIDER_OPENAI and self.use_stt_for_openai_var.get():
            self.keys_by_provider[provider] = ""
        else:
            self.keys_by_provider[provider] = self.text_key_var.get().strip()

        config = AppConfig(
            openai_api_key=self.stt_key_var.get().strip(),
            text_provider=provider,
            use_free_llm=self.use_free_llm_var.get(),
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
        if not hasattr(self, "log_text"):
            return
        self.log_text.insert("end", msg + "\n")
        self.log_text.see("end")

    def _t(self, key: str) -> str:
        lang = self.ui_language if self.ui_language in UI_STRINGS else "pt"
        return UI_STRINGS.get(lang, UI_STRINGS["pt"]).get(key, UI_STRINGS["pt"].get(key, key))

    def _refresh_transform_menu_labels(self):
        self.transform_menu.entryconfig(0, label=self._t("rewrite_prompt"))
        self.transform_menu.entryconfig(1, label=self._t("retranslate"))
        self.transform_menu.entryconfig(2, label=self._t("rewrite_text"))

    def _apply_locale(self):
        self.subtitle_label.configure(text=self._t("subtitle"))
        self.ready_chip.configure(text=self._t("ready"))
        self.config_button.configure(text=self._t("config_btn"))
        self.sidebar_title_label.configure(text=self._t("config"))
        stt_prefix = "▾" if self.config_sections_visible.get("stt", True) else "▸"
        llm_prefix = "▾" if self.config_sections_visible.get("llm", True) else "▸"
        tr_prefix = "▾" if self.config_sections_visible.get("translation", True) else "▸"
        self.stt_section_btn.configure(text=f"{stt_prefix} {self._t('stt_section').replace('▾', '').replace('▸', '').strip()}")
        self.llm_section_btn.configure(text=f"{llm_prefix} {self._t('llm_section').replace('▾', '').replace('▸', '').strip()}")
        self.translation_section_btn.configure(text=f"{tr_prefix} {self._t('translation_section').replace('▾', '').replace('▸', '').strip()}")
        self.stt_key_label.configure(text=self._t("stt_key"))
        self.view_edit_button.configure(text=self._t("view_edit"))
        self.llm_label.configure(text=self._t("llm_text_model"))
        self.translation_lang_label.configure(text=self._t("translation_lang"))
        self.use_stt_key_check.configure(text=self._t("same_stt"))
        self.use_free_llm_check.configure(text=self._t("free_llm"))
        self.save_button.configure(text=self._t("save_config"))
        self.translation_label_top.configure(text=self._t("translation_label"))
        self.ui_lang_label.configure(text=self._t("ui_label"))
        self.text_final_title.configure(text=self._t("text_final"))
        self.text_final_sub.configure(text=self._t("text_final_sub"))
        self.history_title.configure(text=self._t("history"))
        self.status_title.configure(text=self._t("status_log"))
        self.assistant_title.configure(text=self._t("assistant"))
        self.audio_title.configure(text=self._t("audio"))
        self.mode_label.configure(text=self._t("mode_dictate"))
        self.transform_menu_btn.configure(text=self._t("text_actions"))
        self.stop_button.configure(text=self._t("stop"))
        self.copy_result_btn.configure(text=self._t("copy_result"))
        self.copy_status_btn.configure(text=self._t("copy_status"))
        self.use_history_btn.configure(text=self._t("use_history"))
        if hasattr(self, "copy_history_btn"):
            self.copy_history_btn.configure(text=self._t("copy_result"))
        self.processing_label_var.set(self._t("processing"))
        self.bottom_tabs.tab(0, text=self._t("history"))
        self.bottom_tabs.tab(1, text=self._t("status_log"))
        self._refresh_transform_menu_labels()

        if self.is_recording:
            self.recording_state_var.set(self._t("recording_now"))
            self.recording_hint_var.set(self._t("hint_recording"))
        else:
            self.recording_state_var.set(self._t("awaiting"))
            self.recording_hint_var.set(self._t("hint_idle"))

        self._update_record_buttons(self.app.current_action if self.is_recording else None)

    def _on_ui_language_change(self, _event=None):
        selected = self.ui_lang_var.get()
        for code, label in UI_LANGUAGE_OPTIONS.items():
            if label == selected:
                self.ui_language = code
                break
        self._apply_locale()
        self._append_log(f"[ui] Interface: {self.ui_lang_var.get()}.")

    def _toggle_sidebar(self):
        if self.sidebar_expanded:
            self._hide_sidebar()
            return

        self.root.update_idletasks()
        root_x = self.root.winfo_rootx()
        root_y = self.root.winfo_rooty()
        btn_x = self.config_button.winfo_rootx() - root_x
        btn_y = self.config_button.winfo_rooty() - root_y
        btn_w = self.config_button.winfo_width()
        self.sidebar.place(x=max(8, btn_x + btn_w - 360), y=btn_y + self.config_button.winfo_height() + 8, width=360)
        self.config_button.configure(style="Primary.TButton")
        self.sidebar_expanded = True

    def _hide_sidebar(self):
        if not self.sidebar_expanded:
            return
        self.sidebar.place_forget()
        self.config_button.configure(style="Ghost.TButton")
        self.sidebar_expanded = False

    def _widget_is_inside(self, widget: Optional[tk.Widget], parent: tk.Widget) -> bool:
        cur = widget
        while cur is not None:
            if cur == parent:
                return True
            cur = getattr(cur, "master", None)
        return False

    def _on_global_click(self, event):
        if not self.sidebar_expanded:
            return
        widget = event.widget
        if self._widget_is_inside(widget, self.sidebar) or self._widget_is_inside(widget, self.config_button):
            return
        self._hide_sidebar()

    def _toggle_config_section(self, section: str):
        frame_map = {
            "stt": self.stt_box,
            "llm": self.llm_box,
            "translation": self.translation_box,
        }
        btn_map = {
            "stt": self.stt_section_btn,
            "llm": self.llm_section_btn,
            "translation": self.translation_section_btn,
        }
        frame = frame_map.get(section)
        btn = btn_map.get(section)
        if frame is None or btn is None:
            return

        visible = self.config_sections_visible.get(section, True)
        if visible:
            frame.grid_remove()
            self.config_sections_visible[section] = False
            base = btn.cget("text").replace("▾", "").replace("▸", "").strip()
            btn.configure(text=f"▸ {base}")
            return

        frame.grid()
        self.config_sections_visible[section] = True
        base = btn.cget("text").replace("▾", "").replace("▸", "").strip()
        btn.configure(text=f"▾ {base}")

    def _update_record_buttons(self, active_action: Optional[str]):
        if not self.record_buttons:
            return
        button_texts = {
            "dictate": self._t("dictate"),
            "rewrite": self._t("rewrite"),
            "translate_selected": self._t("translate"),
            "prompt_codex": self._t("prompt_codex"),
        }
        for action, button in self.record_buttons.items():
            button.configure(text=button_texts.get(action, action))
            if action == active_action:
                button.configure(style="Primary.TButton")
            else:
                if action == "dictate":
                    button.configure(style="Danger.TButton")
                else:
                    button.configure(style="Secondary.TButton")

    def _add_history_entry(self, text: str, action: str = "dictate"):
        cleaned = text.strip()
        if not cleaned:
            return
        if self.history_items and self.history_items[0].get("text", "") == cleaned:
            return
        action_icons = {
            "dictate": "🎙",
            "rewrite": "✍",
            "translate_selected": "🌐",
            "prompt_codex": "⚡",
        }
        self.history_items.insert(
            0,
            {
                "text": cleaned,
                "action": action,
                "icon": action_icons.get(action, "•"),
                "time": time.strftime("%H:%M:%S"),
                "tokens": str(max(0, int(len(cleaned) / 4))),
            },
        )
        self.history_items = self.history_items[:25]

        if hasattr(self, "history_tree"):
            for item_id in self.history_tree.get_children():
                self.history_tree.delete(item_id)
            for idx, item in enumerate(self.history_items, start=1):
                preview = item.get("text", "").replace("\n", " ").strip()
                if len(preview) > 72:
                    preview = preview[:72] + "..."
                action_label = item.get("action", "dictate")
                action_map = {
                    "dictate": "Gravar",
                    "rewrite": "Reescrever",
                    "translate_selected": "Traduzir",
                    "prompt_codex": "Codex",
                }
                stamp = item.get("time", "")
                token_est = item.get("tokens", "0")
                self.history_tree.insert(
                    "",
                    "end",
                    iid=str(idx - 1),
                    values=(action_map.get(action_label, action_label), stamp, preview, token_est),
                )

    def _use_selected_history(self, _event=None):
        if not hasattr(self, "history_tree"):
            return
        selected = self.history_tree.selection()
        if not selected:
            self._append_log("[hist] Selecione um item do histórico.")
            return
        idx = int(selected[0])
        if idx >= len(self.history_items):
            return
        text = self.history_items[idx].get("text", "")
        self.current_transcribed_text = text
        self.output_text.delete("1.0", "end")
        self.output_text.insert("1.0", text)
        self._update_output_metrics()
        self.transform_menu_btn.state(["!disabled"])
        self._append_log("[hist] Histórico aplicado ao Texto final.")

    def _copy_selected_history(self):
        if not hasattr(self, "history_tree"):
            return
        selected = self.history_tree.selection()
        if not selected:
            self._append_log("[hist] Selecione um item do histórico para copiar.")
            return
        idx = int(selected[0])
        if idx >= len(self.history_items):
            return
        text = self.history_items[idx].get("text", "")
        if not text:
            return
        pyperclip.copy(text)
        self._append_log("[hist] Item do histórico copiado.")

    def _get_output_text(self) -> str:
        return self.output_text.get("1.0", "end").strip()

    def _count_words_tokens(self, text: str) -> tuple[int, int]:
        words = len(re.findall(r"\b\w+\b", text, flags=re.UNICODE))
        token_est = max(words, int(len(text) / 4)) if text else 0
        return words, token_est

    def _update_output_metrics(self):
        text = self._get_output_text()
        words, tokens = self._count_words_tokens(text)
        self.output_metrics_var.set(f"Palavras: {words} | Tokens (est.): {tokens}")

    def _on_output_modified(self, _event=None):
        if self.output_text.edit_modified():
            self._update_output_metrics()
            self.output_text.edit_modified(False)

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
            self._update_output_metrics()
            self._add_history_entry(text, action=self.app.current_action)
            self.processing_frame.grid_remove()
            self.processing_bar.stop()
            self.stop_button.configure(text=self._t("stop"))

        self.root.after(0, _update)

    def on_transcription(self, text: str):
        def _update():
            self.current_transcribed_text = text
            self.transform_menu_btn.state(["!disabled"])
            self._append_log("[acao] Texto transcrito pronto para reescrita/retraducao.")

        self.root.after(0, _update)

    def on_recording_change(self, recording: bool):
        self.is_recording = recording

        def _update():
            if recording:
                self._update_record_buttons(self.app.current_action)
                self.recording_state_var.set(self._t("recording_now"))
                self.state_label.configure(fg="#0369a1")
                self.recording_hint_var.set(self._t("hint_recording"))
            else:
                self._update_record_buttons(None)
                self.recording_state_var.set(self._t("awaiting"))
                self.state_label.configure(fg=self.SUCCESS)
                self.recording_hint_var.set(self._t("hint_idle"))

        self.root.after(0, _update)

    def on_audio_level(self, level: float):
        self.level_target = max(0.0, min(1.0, level))

    def on_processing_change(self, processing: bool, message: str):
        def _update():
            if processing:
                self.processing_label_var.set(message or self._t("processing"))
                self.processing_frame.grid()
                self.processing_bar.start(10)
                self.stop_button.configure(text=self._t("stop"))
            else:
                self.processing_frame.grid_remove()
                self.processing_bar.stop()
                self.stop_button.configure(text=self._t("stop"))

        self.root.after(0, _update)

    def _on_close(self):
        self.hotkeys.stop()
        self.root.unbind_all("<Button-1>")
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
    app.on_transcription = ui.on_transcription
    app.on_recording_change = ui.on_recording_change
    app.on_audio_level = ui.on_audio_level
    app.on_processing_change = ui.on_processing_change

    ui.run()


if __name__ == "__main__":
    main()
