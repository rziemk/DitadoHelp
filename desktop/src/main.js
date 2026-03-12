const STORAGE_KEY = 'helpscribe.desktop.config.v2';
const APP_VERSION = '0.1.16';

const defaultConfig = {
  sttKey: '',
  llmKey: '',
  llmProvider: 'openai',
  sttModel: 'gpt-4o-mini-transcribe',
  llmModel: 'gpt-4.1-mini',
  translationLang: 'en',
  sameKey: true,
  useFreeFallback: true,
  uiLanguage: 'pt',
};

const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-4.1-mini',
    requiresKey: true,
  },
  gemini: {
    label: 'Gemini',
    defaultModel: 'gemini-2.5-flash',
    requiresKey: true,
  },
  grok: {
    label: 'Grok',
    defaultModel: 'grok-2-latest',
    requiresKey: true,
  },
};

const UI_STRINGS = {
  pt: {
    ready: 'Pronto',
    recording: 'Gravando...',
    processing: 'Processando...',
    requestingMic: 'Solicitando acesso ao microfone...',
    waiting: 'Aguardando próximo ditado',
    modeDictate: 'Modo: Ditar',
  },
  en: {
    ready: 'Ready',
    recording: 'Recording...',
    processing: 'Processing...',
    requestingMic: 'Requesting microphone access...',
    waiting: 'Waiting for next dictation',
    modeDictate: 'Mode: Dictate',
  },
  fr: {
    ready: 'Prêt',
    recording: 'Enregistrement...',
    processing: 'Traitement...',
    requestingMic: 'Demande d’accès au microphone...',
    waiting: 'En attente du prochain dictée',
    modeDictate: 'Mode: Dictée',
  },
  es: {
    ready: 'Listo',
    recording: 'Grabando...',
    processing: 'Procesando...',
    requestingMic: 'Solicitando acceso al micrófono...',
    waiting: 'Esperando próximo dictado',
    modeDictate: 'Modo: Dictado',
  },
  de: {
    ready: 'Bereit',
    recording: 'Aufnahme...',
    processing: 'Verarbeitung...',
    requestingMic: 'Mikrofonzugriff wird angefordert...',
    waiting: 'Warte auf nächstes Diktat',
    modeDictate: 'Modus: Diktat',
  },
};

const state = {
  config: loadConfig(),
  mode: 'dictate',
  isRecording: false,
  isProcessing: false,
  mediaRecorder: null,
  chunks: [],
  stream: null,
  audioCtx: null,
  analyser: null,
  sourceNode: null,
  history: [],
  selectedHistory: null,
  logs: [],
  abortController: null,
  recordingMimeType: '',
  recordingExt: 'webm',
  isStartingRecording: false,
};

const el = {
  readyChip: document.getElementById('readyChip'),
  appVersion: document.getElementById('appVersion'),
  configBtn: document.getElementById('configBtn'),
  configPopover: document.getElementById('configPopover'),
  saveConfig: document.getElementById('saveConfig'),
  saveFeedback: document.getElementById('saveFeedback'),
  toggleSttKey: document.getElementById('toggleSttKey'),
  sttKey: document.getElementById('sttKey'),
  sttModel: document.getElementById('sttModel'),
  llmKey: document.getElementById('llmKey'),
  llmModel: document.getElementById('llmModel'),
  llmProvider: document.getElementById('llmProvider'),
  translationLang: document.getElementById('translationLang'),
  translationLangTop: document.getElementById('translationLangTop'),
  sameKey: document.getElementById('sameKey'),
  useFreeFallback: document.getElementById('useFreeFallback'),
  testConnection: document.getElementById('testConnection'),
  uiLanguage: document.getElementById('uiLanguage'),
  btnDictate: document.getElementById('btnDictate'),
  btnRewrite: document.getElementById('btnRewrite'),
  btnRewriteLlm: document.getElementById('btnRewriteLlm'),
  btnTranslate: document.getElementById('btnTranslate'),
  btnCodex: document.getElementById('btnCodex'),
  recordingTag: document.getElementById('recordingTag'),
  stopBtn: document.getElementById('stopBtn'),
  resultText: document.getElementById('resultText'),
  metrics: document.getElementById('metrics'),
  copyResult: document.getElementById('copyResult'),
  copyStatus: document.getElementById('copyStatus'),
  textAction: document.getElementById('textAction'),
  applyTextAction: document.getElementById('applyTextAction'),
  tabs: Array.from(document.querySelectorAll('.tab')),
  historyTab: document.getElementById('historyTab'),
  statusTab: document.getElementById('statusTab'),
  historyList: document.getElementById('historyList'),
  historyUse: document.getElementById('historyUse'),
  historyCopy: document.getElementById('historyCopy'),
  statusLog: document.getElementById('statusLog'),
  noticeBar: document.getElementById('noticeBar'),
  assistMode: document.getElementById('assistMode'),
  assistState: document.getElementById('assistState'),
  assistHint: document.getElementById('assistHint'),
  wave: document.getElementById('wave'),
  chatPrompt: document.getElementById('chatPrompt'),
  chatAsk: document.getElementById('chatAsk'),
  chatClear: document.getElementById('chatClear'),
  chatAnswer: document.getElementById('chatAnswer'),
};

boot();

function boot() {
  el.appVersion.textContent = `v${APP_VERSION}`;
  el.configPopover.classList.add('hidden');
  syncConfigToUI();
  wireEvents();
  setProviderDefaults();
  applyUILanguage();
  renderHistory();
  updateMetrics();
  setActiveMode('dictate');
  refreshControls();
  log('[ui] HelpScribe Desktop pronto.');
  if (!currentSttKey()) {
    showNotice('Configure a STT API Key em Configurações para iniciar a gravação.');
    el.configPopover.classList.remove('hidden');
  }
}

function wireEvents() {
  el.configBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    el.configPopover.classList.toggle('hidden');
  });

  document.addEventListener('click', (ev) => {
    if (el.configPopover.classList.contains('hidden')) return;
    if (el.configPopover.contains(ev.target) || el.configBtn.contains(ev.target)) return;
    el.configPopover.classList.add('hidden');
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      el.configPopover.classList.add('hidden');
      if (state.isRecording || state.isProcessing) handleStop();
    }
    if (ev.key === 'F8') {
      ev.preventDefault();
      toggleRecord('dictate');
    }
    if (ev.key === 'F9') {
      ev.preventDefault();
      toggleRecord('rewrite');
    }
    if (ev.key === 'F10') {
      ev.preventDefault();
      toggleRecord('translate');
    }
    if (ev.key === 'F11') {
      ev.preventDefault();
      toggleRecord('codex');
    }
    if (ev.key === 'F12') {
      ev.preventDefault();
      toggleRecord('rewrite_llm');
    }
    if ((ev.key === 'Enter' || ev.code === 'Space') && (state.isRecording || state.isProcessing)) {
      ev.preventDefault();
      handleStop();
    }
  });

  el.saveConfig.addEventListener('click', async () => {
    try {
      await withButtonLoading(el.saveConfig, 'Salvando...', async () => {
        saveFromUI();
      });
      flashButtonState(el.saveConfig, 'Salvo', 'success');
    } catch (err) {
      flashButtonState(el.saveConfig, 'Falhou', 'error');
      log(`[error] Falha ao salvar configurações: ${err.message}`);
    }
  });
  el.toggleSttKey.addEventListener('click', () => {
    el.sttKey.type = el.sttKey.type === 'password' ? 'text' : 'password';
  });

  el.llmProvider.addEventListener('change', () => {
    setProviderDefaults();
    saveFromUI();
  });

  el.testConnection.addEventListener('click', async () => {
    try {
      await withButtonLoading(el.testConnection, 'Testando...', async () => {
        await validateKey();
      });
      flashButtonState(el.testConnection, 'Conectado', 'success');
      log('[config] Conexão STT OK.');
    } catch (err) {
      flashButtonState(el.testConnection, 'Falhou', 'error');
      log(`[error] ${err.message}`);
    }
  });

  el.uiLanguage.addEventListener('change', () => {
    saveFromUI();
    applyUILanguage();
  });

  el.translationLangTop.addEventListener('change', () => {
    el.translationLang.value = el.translationLangTop.value;
    state.config.translationLang = el.translationLang.value;
    persistConfig();
  });

  el.translationLang.addEventListener('change', () => {
    el.translationLangTop.value = el.translationLang.value;
    state.config.translationLang = el.translationLang.value;
    persistConfig();
  });

  el.btnDictate.addEventListener('click', () => toggleRecord('dictate'));
  el.btnRewrite.addEventListener('click', () => toggleRecord('rewrite'));
  el.btnRewriteLlm.addEventListener('click', () => toggleRecord('rewrite_llm'));
  el.btnTranslate.addEventListener('click', () => toggleRecord('translate'));
  el.btnCodex.addEventListener('click', () => toggleRecord('codex'));
  el.stopBtn.addEventListener('click', handleStop);

  el.copyResult.addEventListener('click', async () => {
    try {
      await withButtonLoading(el.copyResult, 'Copiando...', async () => {
        if (!el.resultText.value.trim()) return log('[copy] Sem resultado para copiar.');
        await navigator.clipboard.writeText(el.resultText.value);
        log('[copy] Resultado copiado.');
      });
      flashButtonState(el.copyResult, 'Copiado', 'success');
    } catch (err) {
      flashButtonState(el.copyResult, 'Falhou', 'error');
      log(`[error] Falha ao copiar resultado: ${err.message}`);
    }
  });

  el.copyStatus.addEventListener('click', async () => {
    try {
      await withButtonLoading(el.copyStatus, 'Copiando...', async () => {
        if (!el.statusLog.textContent.trim()) return log('[copy] Sem status para copiar.');
        await navigator.clipboard.writeText(el.statusLog.textContent);
        log('[copy] Status copiado.');
      });
      flashButtonState(el.copyStatus, 'Copiado', 'success');
    } catch (err) {
      flashButtonState(el.copyStatus, 'Falhou', 'error');
      log(`[error] Falha ao copiar status: ${err.message}`);
    }
  });

  el.applyTextAction.addEventListener('click', async () => {
    await withButtonLoading(el.applyTextAction, 'Processando...', async () => {
      const text = el.resultText.value.trim();
      if (!text) return log('[acao] Sem texto para transformar.');
      const mode = el.textAction.value;
      await runTextAction(text, mode);
    });
  });

  el.chatAsk.addEventListener('click', async () => {
    await withButtonLoading(el.chatAsk, 'Perguntando...', async () => {
      await runChatQuery();
    });
  });

  el.chatClear.addEventListener('click', () => {
    el.chatPrompt.value = '';
    el.chatAnswer.textContent = 'A resposta vai aparecer aqui.';
    log('[chat] Consulta limpa.');
  });

  el.resultText.addEventListener('input', updateMetrics);

  el.tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      el.tabs.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      el.historyTab.classList.toggle('active', tab === 'history');
      el.statusTab.classList.toggle('active', tab === 'status');
    });
  });

  el.historyUse.addEventListener('click', () => {
    if (state.selectedHistory == null) return log('[hist] Selecione um item.');
    const item = state.history[state.selectedHistory];
    if (!item) return;
    el.resultText.value = item.text;
    updateMetrics();
    log('[hist] Item inserido no texto final.');
  });

  el.historyCopy.addEventListener('click', async () => {
    if (state.selectedHistory == null) return log('[hist] Selecione um item.');
    const item = state.history[state.selectedHistory];
    if (!item) return;
    await navigator.clipboard.writeText(item.text);
    log('[hist] Item do histórico copiado.');
  });
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('helpscribe.desktop.config.v1');
    if (!raw) return { ...defaultConfig };
    return { ...defaultConfig, ...JSON.parse(raw) };
  } catch {
    return { ...defaultConfig };
  }
}

function persistConfig() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
}

function syncConfigToUI() {
  el.sttKey.value = state.config.sttKey;
  el.sttModel.value = state.config.sttModel;
  el.llmKey.value = state.config.llmKey;
  el.llmModel.value = state.config.llmModel;
  el.llmProvider.value = state.config.llmProvider;
  el.translationLang.value = state.config.translationLang;
  el.translationLangTop.innerHTML = el.translationLang.innerHTML;
  el.translationLangTop.value = state.config.translationLang;
  el.sameKey.checked = state.config.sameKey;
  el.useFreeFallback.checked = state.config.useFreeFallback;
  el.uiLanguage.value = state.config.uiLanguage;
}

function setProviderDefaults() {
  const provider = el.llmProvider.value;
  if (!PROVIDERS[provider]) {
    el.llmProvider.value = 'openai';
  }
  const selected = PROVIDERS[el.llmProvider.value];
  if (!el.llmModel.value.trim() || Object.values(PROVIDERS).some((p) => p.defaultModel === el.llmModel.value.trim())) {
    el.llmModel.value = selected.defaultModel;
  }
}

function saveFromUI() {
  if (!el.sttModel.value.trim()) {
    throw new Error('Modelo STT não pode ficar vazio.');
  }
  if (!el.llmModel.value.trim()) {
    throw new Error('Modelo LLM não pode ficar vazio.');
  }

  state.config = {
    ...state.config,
    sttKey: el.sttKey.value.trim(),
    sttModel: el.sttModel.value.trim() || defaultConfig.sttModel,
    llmKey: el.llmKey.value.trim(),
    llmModel: el.llmModel.value.trim() || defaultConfig.llmModel,
    llmProvider: el.llmProvider.value,
    translationLang: el.translationLang.value,
    sameKey: el.sameKey.checked,
    useFreeFallback: el.useFreeFallback.checked,
    uiLanguage: el.uiLanguage.value,
  };

  persistConfig();
  el.translationLangTop.value = state.config.translationLang;
  if (state.config.sttKey) {
    hideNotice();
  } else {
    showNotice('Configure a STT API Key em Configurações para iniciar a gravação.');
  }
  el.saveFeedback.textContent = 'Salvo ✓';
  setTimeout(() => (el.saveFeedback.textContent = ''), 1600);
  log('[config] Configurações salvas.');
}

function currentSttKey() {
  return el.sttKey.value.trim() || state.config.sttKey || '';
}

function applyUILanguage() {
  const strings = UI_STRINGS[state.config.uiLanguage] || UI_STRINGS.pt;
  el.readyChip.textContent = strings.ready;
  if (!state.isRecording && !state.isProcessing) {
    el.assistState.textContent = strings.waiting;
    el.assistMode.textContent = strings.modeDictate;
  }
}

function getLLMKey() {
  if (state.config.sameKey) return currentSttKey();
  return el.llmKey.value.trim() || state.config.llmKey || currentSttKey();
}

async function validateKey() {
  const sttKey = currentSttKey();
  if (!sttKey) throw new Error('Defina STT API Key.');
  const resp = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${sttKey}` },
  });
  if (!resp.ok) throw new Error('Chave inválida ou sem permissão.');
}

async function toggleRecord(mode) {
  if (state.isProcessing) {
    log('[proc] Aguarde fim do processamento ou clique em Parar.');
    return;
  }

  if (state.isRecording) {
    await stopRecording();
    return;
  }

  await startRecording(mode);
}

async function startRecording(mode) {
  const sttKey = currentSttKey();
  if (!sttKey) {
    showNotice('Gravação bloqueada: configure a STT API Key em Configurações.', 'error');
    log('[error] Configure STT API Key em Configurações.');
    el.configPopover.classList.remove('hidden');
    el.sttKey.focus();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    log('[error] Este ambiente não suporta captura de áudio (getUserMedia).');
    return;
  }

  try {
    state.mode = mode;
    state.isStartingRecording = true;
    setActiveMode(mode);
    refreshControls();
    const strings = UI_STRINGS[state.config.uiLanguage] || UI_STRINGS.pt;
    el.assistState.textContent = strings.requestingMic;
    el.assistMode.textContent = modeLabel(mode);

    state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.chunks = [];
    const preferredMimeTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/mpeg',
      'audio/ogg;codecs=opus',
    ];
    const selectedMime = preferredMimeTypes.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    const recorderOptions = selectedMime ? { mimeType: selectedMime } : undefined;
    state.recordingMimeType = selectedMime || 'audio/webm';
    state.recordingExt = mimeToExt(state.recordingMimeType);
    state.mediaRecorder = new MediaRecorder(state.stream, recorderOptions);
    state.mediaRecorder.ondataavailable = (ev) => ev.data.size && state.chunks.push(ev.data);
    state.mediaRecorder.onstop = handleRecordingStopped;
    state.mediaRecorder.start(250);
    state.isRecording = true;
    state.isStartingRecording = false;
    hideNotice();
    el.assistState.textContent = strings.recording;
    el.assistMode.textContent = modeLabel(mode);
    setActiveMode(mode);
    refreshControls();
    setupWaveform(state.stream);
    log(`[rec] Gravando (${mode}) com ${state.recordingMimeType}.`);
  } catch (err) {
    const strings = UI_STRINGS[state.config.uiLanguage] || UI_STRINGS.pt;
    state.mode = 'dictate';
    state.isRecording = false;
    state.isStartingRecording = false;
    setActiveMode('dictate');
    refreshControls();
    el.assistState.textContent = strings.waiting;
    el.assistMode.textContent = strings.modeDictate;

    const micDenied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
    if (micDenied) {
      log('[error] Acesso ao microfone negado. Verifique permissões do app no macOS (Privacidade > Microfone).');
      return;
    }
    log(`[error] Falha ao iniciar gravação: ${err.message}`);
  }
}

async function stopRecording() {
  if (!state.isRecording || !state.mediaRecorder) return;
  if (state.mediaRecorder.state === 'recording') {
    try {
      state.mediaRecorder.requestData();
    } catch {
      // Some implementations may throw if requestData is unsupported.
    }
  }
  state.mediaRecorder.stop();
  state.isRecording = false;
  refreshControls();
  stopWaveform();
}

async function handleRecordingStopped() {
  const strings = UI_STRINGS[state.config.uiLanguage] || UI_STRINGS.pt;
  state.isProcessing = true;
  state.abortController = new AbortController();
  el.assistState.textContent = strings.processing;
  refreshControls();

  try {
    const blobType = state.recordingMimeType || state.chunks[0]?.type || 'audio/webm';
    const blob = new Blob(state.chunks, { type: blobType });
    log(`[rec] Captura finalizada: ${state.chunks.length} chunks, ${(blob.size / 1024).toFixed(1)} KB (${blobType}).`);
    if (!blob.size) throw new Error('Sem áudio capturado.');

    const rawText = await transcribe(blob, state.abortController.signal);
    if (!rawText) throw new Error('Transcrição vazia. Fale mais próximo do microfone e tente novamente.');
    log(`[stt] ${rawText.slice(0, 140)}${rawText.length > 140 ? '...' : ''}`);

    let finalText = rawText;
    if (state.mode === 'rewrite') finalText = rewriteSmartLocal(rawText);
    if (state.mode === 'rewrite_llm') finalText = await rewriteText(rawText, state.abortController.signal);
    if (state.mode === 'translate') finalText = await translateText(rawText, state.config.translationLang, state.abortController.signal);
    if (state.mode === 'codex') finalText = await codexPrompt(rawText, state.abortController.signal);

    if (!state.abortController.signal.aborted) {
      el.resultText.value = finalText;
      updateMetrics();
      addHistory(finalText, state.mode);
      log('[rec] Resultado pronto.');
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      log('[proc] Processamento cancelado.');
    } else {
      log(`[error] ${err.message}`);
    }
  } finally {
    state.isProcessing = false;
    state.abortController = null;
    state.mode = 'dictate';
    setActiveMode('dictate');
    el.assistState.textContent = strings.waiting;
    el.assistMode.textContent = strings.modeDictate;
    refreshControls();

    if (state.stream) {
      state.stream.getTracks().forEach((track) => track.stop());
      state.stream = null;
    }
    state.recordingMimeType = '';
    state.recordingExt = 'webm';
  }
}

async function transcribe(blob, signal) {
  const sttKey = currentSttKey();
  if (!sttKey) throw new Error('Defina STT API Key.');
  const fd = new FormData();
  fd.append('model', state.config.sttModel || defaultConfig.sttModel);
  const ext = state.recordingExt || mimeToExt(blob.type || '') || 'webm';
  fd.append('file', blob, `audio.${ext}`);
  fd.append('response_format', 'text');
  fd.append('language', 'pt');

  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sttKey}` },
    body: fd,
    signal,
  });

  if (!resp.ok) {
    const err = await safeJson(resp);
    throw new Error(err?.error?.message || `Falha STT (${resp.status})`);
  }

  return (await resp.text()).trim();
}

function mimeToExt(mime) {
  if (!mime) return 'webm';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

async function runTextAction(text, mode) {
  if (state.isRecording) {
    log('[acao] Pare a gravação antes de aplicar transformação.');
    return;
  }

  const strings = UI_STRINGS[state.config.uiLanguage] || UI_STRINGS.pt;
  state.isProcessing = true;
  state.abortController = new AbortController();
  el.assistState.textContent = strings.processing;
  refreshControls();

  try {
    if (mode === 'rewrite_prompt') {
      el.resultText.value = await codexPrompt(text, state.abortController.signal);
    } else if (mode === 'retranslate') {
      el.resultText.value = await translateText(text, state.config.translationLang, state.abortController.signal);
    } else {
      el.resultText.value = await rewriteText(text, state.abortController.signal);
    }

    updateMetrics();
    addHistory(el.resultText.value, mode);
    log('[acao] Transformação aplicada.');
  } catch (err) {
    if (err?.name === 'AbortError') {
      log('[proc] Processamento cancelado.');
    } else {
      log(`[error] ${err.message}`);
    }
  } finally {
    state.isProcessing = false;
    state.abortController = null;
    el.assistState.textContent = strings.waiting;
    refreshControls();
  }
}

async function runChatQuery() {
  const question = el.chatPrompt.value.trim();
  if (!question) {
    log('[chat] Digite uma pergunta para consultar a LLM.');
    return;
  }
  if (state.isRecording) {
    log('[chat] Pare a gravação antes de consultar a LLM.');
    return;
  }

  const strings = UI_STRINGS[state.config.uiLanguage] || UI_STRINGS.pt;
  state.isProcessing = true;
  state.abortController = new AbortController();
  el.assistState.textContent = strings.processing;
  refreshControls();

  try {
    const answer = await llmComplete(
      `Responda de forma clara e objetiva. Pergunta do usuário:\n\n${question}`,
      state.abortController.signal,
    );
    if (!answer) throw new Error('Resposta vazia da LLM.');
    el.chatAnswer.textContent = answer;
    addHistory(`Q: ${question}\nA: ${answer}`, 'chat');
    log('[chat] Resposta gerada.');
  } catch (err) {
    if (err?.name === 'AbortError') {
      log('[chat] Consulta cancelada.');
    } else {
      el.chatAnswer.textContent = `Erro: ${err.message}`;
      log(`[error] ${err.message}`);
    }
  } finally {
    state.isProcessing = false;
    state.abortController = null;
    el.assistState.textContent = strings.waiting;
    refreshControls();
  }
}

function modeLabel(mode) {
  const labels = {
    dictate: 'Modo: Ditar',
    rewrite: 'Modo: Reescrever',
    rewrite_llm: 'Modo: Reescrever com LLM',
    translate: 'Modo: Traduzir',
    codex: 'Modo: Escreve Prompt',
  };
  return labels[mode] || labels.dictate;
}

async function llmComplete(prompt, signal) {
  const provider = state.config.llmProvider;
  const model = state.config.llmModel || PROVIDERS[provider]?.defaultModel || defaultConfig.llmModel;
  const apiKey = getLLMKey();

  if (!apiKey) {
    throw new Error('Defina LLM API Key ou habilite fallback.');
  }

  if (provider === 'openai') {
    return await callOpenAI(apiKey, model, prompt, signal);
  }

  if (provider === 'grok') {
    return await callGrok(apiKey, model, prompt, signal);
  }

  if (provider === 'gemini') {
    return await callGemini(apiKey, model, prompt, signal);
  }

  throw new Error(`Provedor não suportado: ${provider}`);
}

async function callOpenAI(apiKey, model, prompt, signal) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Você é um assistente de escrita técnica objetivo e claro.' },
        { role: 'user', content: prompt },
      ],
    }),
    signal,
  });

  if (!resp.ok) {
    const err = await safeJson(resp);
    throw new Error(err?.error?.message || `Falha OpenAI (${resp.status})`);
  }

  const data = await resp.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

async function callGrok(apiKey, model, prompt, signal) {
  const resp = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You are a concise writing assistant.' },
        { role: 'user', content: prompt },
      ],
    }),
    signal,
  });

  if (!resp.ok) {
    const err = await safeJson(resp);
    throw new Error(err?.error?.message || `Falha Grok (${resp.status})`);
  }

  const data = await resp.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

async function callGemini(apiKey, model, prompt, signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 },
    }),
    signal,
  });

  if (!resp.ok) {
    const err = await safeJson(resp);
    throw new Error(err?.error?.message || `Falha Gemini (${resp.status})`);
  }

  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

function languageName(code) {
  return {
    pt: 'português',
    en: 'inglês',
    es: 'espanhol',
    fr: 'francês',
    de: 'alemão',
  }[code] || 'inglês';
}

async function rewriteText(text, signal) {
  try {
    return await llmComplete(
      [
        'Você é um editor de ditado em português (pt-BR).',
        'Tarefa: transformar a fala transcrita em um texto final claro, objetivo e pronto para uso.',
        '',
        'Regras obrigatórias:',
        '1) Preserve o significado e o contexto principal.',
        '2) Remova repetições, vícios de fala, hesitações e trechos incoerentes.',
        '3) Se houver mudança de ideia no meio da fala, mantenha a versão final/intenção mais recente.',
        '4) Remova instruções meta dirigidas ao assistente/editor (ex.: "escreve X do jeito correto", "corrige esse termo", "troca tal palavra"), a menos que façam parte do conteúdo final pretendido.',
        '5) Corrija gramática, pontuação e concordância.',
        '6) Não invente fatos. Se algo ficar ambíguo, escolha a interpretação mais provável pelo contexto.',
        '7) Entregue somente o texto final (sem explicações, sem tópicos extras).',
        '',
        'Tom de saída:',
        '- Direto, claro, natural e profissional.',
        '- Frases enxutas, evitando redundância.',
        '',
        'Texto transcrito:',
        text,
      ].join('\n'),
      signal,
    );
  } catch (err) {
    if (!state.config.useFreeFallback) throw err;
    log('[llm] Sem chave válida. Usando fallback local de reescrita.');
    return text.replace(/\s+/g, ' ').trim();
  }
}

function rewriteSmartLocal(text) {
  const normalized = text
    .replace(/\s+/g, ' ')
    .replace(/\s([,.;!?])/g, '$1')
    .replace(/([,.;!?])([^\s])/g, '$1 $2')
    .trim();
  if (!normalized) return normalized;

  // Revisao local (sem LLM): limpa vicios comuns de fala e organiza sentencas.
  const withoutFillers = normalized
    .replace(/\b(ah+|eh+|uh+|hum+|hmm+|tipo|ne)\b/gi, '')
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s([,.;!?])/g, '$1')
    .trim();

  const sentences = withoutFillers
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));

  const rebuilt = (sentences.length ? sentences.join(' ') : withoutFillers)
    .replace(/([.!?]){2,}/g, '$1')
    .trim();

  return /[.!?]$/.test(rebuilt) ? rebuilt : `${rebuilt}.`;
}

async function translateText(text, langCode, signal) {
  const target = languageName(langCode);
  try {
    return await llmComplete(`Traduza para ${target}, mantendo contexto e tom:\n\n${text}`, signal);
  } catch (err) {
    if (!state.config.useFreeFallback) throw err;
    log('[llm] Sem chave válida. Usando fallback local para tradução.');
    return `[Tradução para ${target} indisponível sem chave LLM]\n\n${text}`;
  }
}

async function codexPrompt(text, signal) {
  try {
    return await llmComplete(
      `Transforme o ditado abaixo em um prompt técnico no estilo Codex, com seções Objetivo, Contexto, Requisitos, Critérios de aceite e Passos sugeridos:\n\n${text}`,
      signal,
    );
  } catch (err) {
    if (!state.config.useFreeFallback) throw err;
    log('[llm] Sem chave válida. Usando template local de prompt.');
    return [
      'Objetivo:',
      text,
      '',
      'Contexto:',
      'Descreva o ambiente e restrições técnicas.',
      '',
      'Requisitos:',
      'Liste requisitos funcionais e não funcionais.',
      '',
      'Critérios de aceite:',
      'Defina como validar o resultado.',
      '',
      'Passos sugeridos:',
      '1. Planejar',
      '2. Implementar',
      '3. Testar',
      '4. Entregar',
    ].join('\n');
  }
}

function setActiveMode(mode) {
  const all = [
    ['dictate', el.btnDictate],
    ['rewrite', el.btnRewrite],
    ['rewrite_llm', el.btnRewriteLlm],
    ['translate', el.btnTranslate],
    ['codex', el.btnCodex],
  ];

  all.forEach(([key, btn]) => {
    btn.classList.remove('primary');
    btn.classList.add('secondary');
    if (mode === key && (state.isRecording || state.isProcessing || state.isStartingRecording)) {
      btn.classList.add('primary');
    }
  });
}

function refreshControls() {
  const busy = state.isRecording || state.isProcessing || state.isStartingRecording;
  el.btnDictate.disabled = state.isProcessing || state.isStartingRecording;
  el.btnRewrite.disabled = state.isProcessing || state.isStartingRecording;
  el.btnRewriteLlm.disabled = state.isProcessing || state.isStartingRecording;
  el.btnTranslate.disabled = state.isProcessing || state.isStartingRecording;
  el.btnCodex.disabled = state.isProcessing || state.isStartingRecording;
  el.applyTextAction.disabled = busy;
  el.chatAsk.disabled = busy;
  el.stopBtn.disabled = !busy;
  if (el.recordingTag) {
    const showRecording = state.isRecording || state.isStartingRecording;
    el.recordingTag.classList.toggle('hidden', !showRecording);
  }
}

async function withButtonLoading(button, loadingText, action) {
  if (!button) return await action();
  if (button.dataset.loading === '1') return;
  const originalHtml = button.innerHTML;
  const originalDisabled = button.disabled;
  button.dataset.loading = '1';
  button.disabled = true;
  button.classList.add('loading');
  button.textContent = loadingText;
  try {
    return await action();
  } finally {
    button.dataset.loading = '0';
    button.disabled = originalDisabled;
    button.classList.remove('loading');
    button.innerHTML = originalHtml;
  }
}

function flashButtonState(button, text, kind) {
  if (!button) return;
  const originalHtml = button.innerHTML;
  button.classList.remove('state-success', 'state-error');
  button.classList.add(kind === 'success' ? 'state-success' : 'state-error');
  button.textContent = text;
  setTimeout(() => {
    button.classList.remove('state-success', 'state-error');
    button.innerHTML = originalHtml;
  }, 1800);
}

function addHistory(text, action) {
  const now = new Date();
  const tokens = Math.max(1, Math.floor(text.length / 4));
  state.history.unshift({
    action,
    text,
    tokens,
    at: now.toLocaleTimeString('pt-BR'),
  });
  state.history = state.history.slice(0, 50);
  renderHistory();
}

function renderHistory() {
  el.historyList.innerHTML = '';

  state.history.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'history-item';
    row.dataset.idx = String(idx);

    const titleMap = {
      dictate: 'Gravar',
      rewrite: 'Reescrever',
      rewrite_llm: 'Reescrever com LLM',
      translate: 'Traduzir',
      codex: 'Escreve Prompt',
      chat: 'Consulta LLM',
      rewrite_prompt: 'Reescrever prompt',
      retranslate: 'Retraduzir',
      rewrite_text: 'Reescrever texto',
    };

    row.innerHTML = `
      <div class="history-main">
        <div class="history-title">${titleMap[item.action] || item.action} • ${item.at}</div>
        <div class="history-meta">${escapeHtml(item.text.slice(0, 90))}${item.text.length > 90 ? '...' : ''} • ${item.tokens} tokens</div>
      </div>
      <div>
        <button class="btn ghost small" data-action="use">Inserir</button>
        <button class="btn ghost small" data-action="copy">Copiar</button>
      </div>
    `;

    row.addEventListener('click', (ev) => {
      state.selectedHistory = idx;
      document.querySelectorAll('.history-item').forEach((n) => n.classList.remove('selected'));
      row.classList.add('selected');

      const action = ev.target?.dataset?.action;
      if (action === 'use') {
        el.resultText.value = item.text;
        updateMetrics();
        log('[hist] Item inserido no texto final.');
      }
      if (action === 'copy') {
        navigator.clipboard.writeText(item.text);
        log('[hist] Item do histórico copiado.');
      }
    });

    el.historyList.appendChild(row);
  });
}

function handleStop() {
  if (state.isRecording) {
    stopRecording();
    return;
  }

  if (state.isProcessing && state.abortController) {
    state.abortController.abort();
    log('[proc] Cancelamento solicitado.');
  }
}

function updateMetrics() {
  const text = el.resultText.value || '';
  const words = (text.match(/\b\w+\b/g) || []).length;
  const tokens = Math.max(0, Math.floor(text.length / 4));
  el.metrics.textContent = `Palavras: ${words} | Tokens (est.): ${tokens}`;
}

function showNotice(message, type = 'error') {
  if (!el.noticeBar) return;
  el.noticeBar.textContent = message;
  el.noticeBar.classList.remove('hidden', 'info');
  if (type === 'info') el.noticeBar.classList.add('info');
}

function hideNotice() {
  if (!el.noticeBar) return;
  el.noticeBar.classList.add('hidden');
  el.noticeBar.textContent = '';
  el.noticeBar.classList.remove('info');
}

function log(message) {
  state.logs.push(message);
  if (state.logs.length > 200) state.logs.shift();
  el.statusLog.textContent = state.logs.join('\n');
}

function setupWaveform(stream) {
  try {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    state.audioCtx = ctx;
    state.analyser = analyser;
    state.sourceNode = source;
    drawWave();
  } catch (err) {
    log(`[audio] ${err.message}`);
  }
}

function stopWaveform() {
  if (state.audioCtx) {
    state.audioCtx.close();
    state.audioCtx = null;
  }
  state.analyser = null;
  state.sourceNode = null;
  clearWave();
}

function clearWave() {
  const canvas = el.wave;
  const ctx = canvas.getContext('2d');
  const width = (canvas.width = canvas.clientWidth);
  const height = (canvas.height = canvas.clientHeight);
  ctx.clearRect(0, 0, width, height);
}

function drawWave() {
  if (!state.analyser) return;

  const canvas = el.wave;
  const ctx = canvas.getContext('2d');
  const width = (canvas.width = canvas.clientWidth);
  const height = (canvas.height = canvas.clientHeight);
  const data = new Uint8Array(state.analyser.frequencyBinCount);

  state.analyser.getByteFrequencyData(data);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f7f9ff';
  ctx.fillRect(0, 0, width, height);

  const barWidth = Math.max(2, (width / data.length) * 1.2);
  let x = 0;
  for (let i = 0; i < data.length; i += 2) {
    const v = data[i] / 255;
    const barHeight = Math.max(2, v * (height - 16));
    ctx.fillStyle = i % 4 === 0 ? '#6f9ae9' : '#c2d4fa';
    ctx.fillRect(x, (height - barHeight) / 2, barWidth, barHeight);
    x += barWidth + 1;
    if (x > width) break;
  }

  if (state.isRecording) requestAnimationFrame(drawWave);
}

async function safeJson(resp) {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
