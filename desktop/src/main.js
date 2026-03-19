import { documentDir, join } from '@tauri-apps/api/path';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

const STORAGE_KEY = 'scribeflowai.desktop.config.v2';
const LEGACY_STORAGE_KEYS = ['helpscribe.desktop.config.v2', 'helpscribe.desktop.config.v1'];
const APP_VERSION = '0.1.28';
const HISTORY_FILE_NAME = 'conversations.jsonl';
const HISTORY_SUBDIR = 'Scribeflowai';
const HISTORY_LIMIT = 200;

const defaultConfig = {
  sttKey: '',
  llmKey: '',
  llmProvider: 'openai',
  sttModel: 'gpt-4o-mini-transcribe',
  llmModel: 'gpt-4.1',
  translationLang: 'en',
  autoSyncCloud: true,
  sameKey: true,
  useFreeFallback: true,
  appendDictation: false,
  historyDir: '',
  apiBaseUrl: 'https://api.scribeflowai.com',
  authName: '',
  authEmail: '',
  authPhone: '',
  authLanguage: 'pt',
  authHasPassword: false,
  sessionToken: '',
  sessionExpiresAt: '',
  deviceId: '',
  uiLanguage: 'pt',
};

const MODEL_OPTION_CUSTOM = '__custom__';

const MODEL_CATALOG = {
  openai: [
    { value: 'gpt-4.1', label: 'GPT-4.1', hint: 'Melhor qualidade geral' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini', hint: 'Mais rapido e mais barato' },
    { value: 'gpt-4.1-nano', label: 'GPT-4.1 nano', hint: 'Latencia minima' },
    { value: 'gpt-4o', label: 'GPT-4o', hint: 'Multimodal e equilibrado' },
    { value: 'gpt-4o-mini', label: 'GPT-4o mini', hint: 'Economico para uso geral' },
  ],
  gemini: [
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', hint: 'Maior capacidade de raciocinio' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', hint: 'Rapido e recomendado para a maioria' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', hint: 'Opcao estavel e veloz' },
    { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite', hint: 'Mais economico' },
  ],
  grok: [
    { value: 'grok-3', label: 'Grok 3', hint: 'Modelo principal' },
    { value: 'grok-3-fast', label: 'Grok 3 Fast', hint: 'Menor latencia' },
    { value: 'grok-2-latest', label: 'Grok 2 Latest', hint: 'Compatibilidade com setup existente' },
  ],
};

const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-4.1',
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
  historyFilePath: '',
  historyDirResolved: '',
  authUser: null,
  authDevice: null,
  heartbeatTimer: null,
  authPollTimer: null,
  authRequestId: '',
  hasPendingCloudSync: false,
};

const el = {
  readyChip: document.getElementById('readyChip'),
  userChip: document.getElementById('userChip'),
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
  llmModelCustom: document.getElementById('llmModelCustom'),
  llmModelHint: document.getElementById('llmModelHint'),
  llmProvider: document.getElementById('llmProvider'),
  translationLang: document.getElementById('translationLang'),
  translationLangTop: document.getElementById('translationLangTop'),
  historyDir: document.getElementById('historyDir'),
  chooseHistoryDir: document.getElementById('chooseHistoryDir'),
  importHistory: document.getElementById('importHistory'),
  apiBaseUrl: document.getElementById('apiBaseUrl'),
  authModeTitle: document.getElementById('authModeTitle'),
  authModeHint: document.getElementById('authModeHint'),
  authNameGroup: document.getElementById('authNameGroup'),
  authName: document.getElementById('authName'),
  authEmailGroup: document.getElementById('authEmailGroup'),
  authEmail: document.getElementById('authEmail'),
  authPasswordGroup: document.getElementById('authPasswordGroup'),
  authPassword: document.getElementById('authPassword'),
  authPasswordConfirmGroup: document.getElementById('authPasswordConfirmGroup'),
  authPasswordConfirm: document.getElementById('authPasswordConfirm'),
  authPhoneGroup: document.getElementById('authPhoneGroup'),
  authPhone: document.getElementById('authPhone'),
  authLanguageGroup: document.getElementById('authLanguageGroup'),
  authLanguage: document.getElementById('authLanguage'),
  authSignInActions: document.getElementById('authSignInActions'),
  authSignUpActions: document.getElementById('authSignUpActions'),
  authAccountActions: document.getElementById('authAccountActions'),
  loginWithPassword: document.getElementById('loginWithPassword'),
  setPassword: document.getElementById('setPassword'),
  requestMagicLink: document.getElementById('requestMagicLink'),
  resendMagicLink: document.getElementById('resendMagicLink'),
  syncNow: document.getElementById('syncNow'),
  logoutBtn: document.getElementById('logoutBtn'),
  authStatus: document.getElementById('authStatus'),
  configSections: Array.from(document.querySelectorAll('#configPopover details')),
  autoSyncCloud: document.getElementById('autoSyncCloud'),
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
  appendDictation: document.getElementById('appendDictation'),
  tabs: Array.from(document.querySelectorAll('.tab')),
  historyTab: document.getElementById('historyTab'),
  statusTab: document.getElementById('statusTab'),
  historyList: document.getElementById('historyList'),
  historyUse: document.getElementById('historyUse'),
  historyCopy: document.getElementById('historyCopy'),
  historyExport: document.getElementById('historyExport'),
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

const isTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

boot();

async function boot() {
  el.appVersion.textContent = `v${APP_VERSION}`;
  el.configPopover.classList.add('hidden');
  syncConfigToUI();
  wireEvents();
  setProviderDefaults();
  applyUILanguage();
  await initializeHistoryStorage();
  await restoreSession();
  await checkForUpdates();
  renderHistory();
  updateMetrics();
  setActiveMode('dictate');
  refreshControls();
  log('[ui] Scribeflowai Desktop pronto.');
  if (!currentSttKey()) {
    showNotice('Configure a STT API Key em Configurações para iniciar a gravação.');
    el.configPopover.classList.remove('hidden');
    setConfigSectionsCollapsed();
  }
}

function hasCloudSyncPending() {
  return isAuthenticated() && state.hasPendingCloudSync;
}

function markCloudSyncPending(reason = 'alteracoes locais') {
  if (!isAuthenticated()) return;
  state.hasPendingCloudSync = true;
  refreshAuthUI();
  if (!state.config.autoSyncCloud) {
    log(`[sync] ${reason} pendentes para sincronizar com a nuvem.`);
  }
}

function clearCloudSyncPending() {
  state.hasPendingCloudSync = false;
  refreshAuthUI();
}

function setConfigSectionsCollapsed() {
  el.configSections.forEach((section) => {
    const isAccountSection = section.querySelector('#apiBaseUrl');
    section.open = Boolean(isAccountSection);
  });
}

function openAccountAccess(focusTarget = 'email') {
  el.configPopover.classList.remove('hidden');
  setConfigSectionsCollapsed();
  if (focusTarget === 'password') {
    el.authPassword.focus();
    return;
  }
  el.authEmail.focus();
}

function wireEvents() {
  el.configBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const willOpen = el.configPopover.classList.contains('hidden');
    el.configPopover.classList.toggle('hidden');
    if (willOpen) {
      setConfigSectionsCollapsed();
    }
  });

  el.userChip.addEventListener('click', () => {
    openAccountAccess(isAuthenticated() || state.config.authHasPassword ? 'password' : 'email');
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
        if (isAuthenticated()) {
          if (state.config.autoSyncCloud) {
            await syncUserSettings('push');
          } else {
            markCloudSyncPending('configuracoes da conta');
          }
        }
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
    setProviderDefaults('', true);
    saveFromUI();
  });

  el.llmModel.addEventListener('change', () => {
    updateLLMModelHint();
    saveFromUI();
  });

  el.llmModelCustom.addEventListener('change', () => {
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

  el.appendDictation.addEventListener('change', () => {
    saveFromUI();
    log(el.appendDictation.checked
      ? '[config] Complemento por ditado ativado: o proximo audio sera somado ao texto atual.'
      : '[config] Complemento por ditado desativado.');
  });

  el.autoSyncCloud.addEventListener('change', async () => {
    saveFromUI();
    if (el.autoSyncCloud.checked) {
      log('[sync] Sincronizacao automatica ativada.');
      if (hasCloudSyncPending()) {
        await syncAllCloudData();
      }
      return;
    }
    log('[sync] Sincronizacao automatica desativada. O app vai avisar antes de sair com dados pendentes.');
  });

  el.chooseHistoryDir.addEventListener('click', async () => {
    await withButtonLoading(el.chooseHistoryDir, 'Abrindo...', async () => {
      await chooseHistoryDirectory();
    });
  });

  el.importHistory.addEventListener('click', async () => {
    await withButtonLoading(el.importHistory, 'Importando...', async () => {
      await importHistoryFile();
    });
  });

  el.requestMagicLink.addEventListener('click', async () => {
    await withButtonLoading(el.requestMagicLink, 'Enviando...', async () => {
      await requestMagicLink();
    });
  });

  el.loginWithPassword.addEventListener('click', async () => {
    await withButtonLoading(el.loginWithPassword, 'Entrando...', async () => {
      await loginWithPassword();
    });
  });

  el.setPassword.addEventListener('click', async () => {
    await withButtonLoading(el.setPassword, 'Salvando...', async () => {
      await savePassword();
    });
  });

  el.resendMagicLink.addEventListener('click', async () => {
    await withButtonLoading(el.resendMagicLink, 'Reenviando...', async () => {
      await requestMagicLink();
    });
  });

  el.syncNow.addEventListener('click', async () => {
    await withButtonLoading(el.syncNow, 'Sincronizando...', async () => {
      await syncAllCloudData();
    });
  });

  el.logoutBtn.addEventListener('click', async () => {
    if (await confirmSyncBeforeLeaving()) {
      logout();
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!hasCloudSyncPending() || state.config.autoSyncCloud) return;
    event.preventDefault();
    event.returnValue = 'Existem dados pendentes para sincronizar com a nuvem.';
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

  el.historyExport.addEventListener('click', async () => {
    await withButtonLoading(el.historyExport, 'Exportando...', async () => {
      await exportHistoryBackup();
    });
  });
}

function loadConfig() {
  try {
    const raw = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS].map((key) => localStorage.getItem(key)).find(Boolean);
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
  el.llmProvider.value = state.config.llmProvider;
  populateLLMModelOptions(state.config.llmProvider, state.config.llmModel);
  el.translationLang.value = state.config.translationLang;
  el.translationLangTop.innerHTML = el.translationLang.innerHTML;
  el.translationLangTop.value = state.config.translationLang;
  el.autoSyncCloud.checked = state.config.autoSyncCloud;
  el.sameKey.checked = state.config.sameKey;
  el.useFreeFallback.checked = state.config.useFreeFallback;
  el.appendDictation.checked = state.config.appendDictation;
  el.historyDir.value = state.config.historyDir || 'Documentos/Scribeflowai (padrao)';
  el.apiBaseUrl.value = state.config.apiBaseUrl || defaultConfig.apiBaseUrl;
  el.authName.value = state.config.authName || '';
  el.authEmail.value = state.config.authEmail || '';
  el.authPassword.value = '';
  el.authPasswordConfirm.value = '';
  el.authPhone.value = state.config.authPhone || '';
  el.authLanguage.value = state.config.authLanguage || 'pt';
  el.uiLanguage.value = state.config.uiLanguage;
  refreshAuthUI();
}

function populateLLMModelOptions(provider, selectedValue = '') {
  const safeProvider = PROVIDERS[provider] ? provider : 'openai';
  const models = MODEL_CATALOG[safeProvider] || [];
  const desired = selectedValue || PROVIDERS[safeProvider].defaultModel;
  const known = models.some((item) => item.value === desired);

  el.llmModel.innerHTML = '';
  models.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = `${item.label} (${item.hint})`;
    el.llmModel.appendChild(option);
  });

  const customOption = document.createElement('option');
  customOption.value = MODEL_OPTION_CUSTOM;
  customOption.textContent = 'Personalizado';
  el.llmModel.appendChild(customOption);

  if (known) {
    el.llmModel.value = desired;
    el.llmModelCustom.value = '';
    el.llmModelCustom.classList.add('hidden');
  } else {
    el.llmModel.value = MODEL_OPTION_CUSTOM;
    el.llmModelCustom.value = desired;
    el.llmModelCustom.classList.remove('hidden');
  }

  updateLLMModelHint();
}

function updateLLMModelHint() {
  const provider = el.llmProvider.value;
  const selected = (MODEL_CATALOG[provider] || []).find((item) => item.value === el.llmModel.value);
  if (el.llmModel.value === MODEL_OPTION_CUSTOM) {
    el.llmModelCustom.classList.remove('hidden');
    el.llmModelHint.textContent = 'Use modelo personalizado apenas se voce souber o identificador exato da API.';
    return;
  }
  el.llmModelCustom.classList.add('hidden');
  el.llmModelHint.textContent = selected
    ? `Sugestao para ${PROVIDERS[provider].label}: ${selected.label} - ${selected.hint}.`
    : 'Selecione um modelo sugerido para evitar nomes incorretos.';
}

function currentSelectedLLMModel() {
  if (el.llmModel.value === MODEL_OPTION_CUSTOM) {
    return el.llmModelCustom.value.trim();
  }
  return el.llmModel.value.trim();
}

function setProviderDefaults(preferredModel = '', forceDefault = false) {
  const provider = PROVIDERS[el.llmProvider.value] ? el.llmProvider.value : 'openai';
  if (provider !== el.llmProvider.value) {
    el.llmProvider.value = provider;
  }
  const selectedModel = preferredModel || currentSelectedLLMModel() || state.config.llmModel || PROVIDERS[provider].defaultModel;
  const finalModel = forceDefault ? PROVIDERS[provider].defaultModel : selectedModel;
  populateLLMModelOptions(provider, finalModel);
}

function saveFromUI() {
  if (!el.sttModel.value.trim()) {
    throw new Error('Modelo STT não pode ficar vazio.');
  }
  if (!currentSelectedLLMModel()) {
    throw new Error('Modelo LLM não pode ficar vazio.');
  }

  state.config = {
    ...state.config,
    sttKey: el.sttKey.value.trim(),
    sttModel: el.sttModel.value.trim() || defaultConfig.sttModel,
    llmKey: el.llmKey.value.trim(),
    llmModel: currentSelectedLLMModel() || defaultConfig.llmModel,
    llmProvider: el.llmProvider.value,
    translationLang: el.translationLang.value,
    autoSyncCloud: el.autoSyncCloud.checked,
    sameKey: el.sameKey.checked,
    useFreeFallback: el.useFreeFallback.checked,
    appendDictation: el.appendDictation.checked,
    historyDir: state.config.historyDir || '',
    apiBaseUrl: el.apiBaseUrl.value.trim() || defaultConfig.apiBaseUrl,
    authName: el.authName.value.trim(),
    authEmail: el.authEmail.value.trim(),
    authPhone: el.authPhone.value.trim(),
    authLanguage: el.authLanguage.value,
    authHasPassword: state.config.authHasPassword || false,
    sessionToken: state.config.sessionToken || '',
    sessionExpiresAt: state.config.sessionExpiresAt || '',
    deviceId: state.config.deviceId || '',
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

function currentEditorText() {
  return (el.resultText.value || '').trim();
}

function formatHistoryTimestamp(isoString) {
  const date = isoString ? new Date(isoString) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toLocaleString('pt-BR');
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildHistoryEntry({ action, finalText, sourceText = '', meta = {} }) {
  const createdAt = new Date().toISOString();
  const text = (finalText || '').trim();
  return {
    id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    sourceText: (sourceText || '').trim(),
    finalText: text,
    text,
    tokens: Math.max(1, Math.floor(text.length / 4)),
    at: formatHistoryTimestamp(createdAt),
    createdAt,
    meta,
  };
}

function normalizeHistoryEntry(entry) {
  const finalText = (entry?.finalText || entry?.text || '').trim();
  const createdAt = entry?.createdAt || new Date().toISOString();
  return {
    id: entry?.id || `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    action: entry?.action || 'dictate',
    sourceText: (entry?.sourceText || '').trim(),
    finalText,
    text: finalText,
    tokens: entry?.tokens || Math.max(1, Math.floor(finalText.length / 4)),
    at: formatHistoryTimestamp(createdAt),
    createdAt,
    meta: entry?.meta || {},
  };
}

function serializeHistoryEntries(entries) {
  return entries
    .slice()
    .reverse()
    .map((item) => JSON.stringify({
      id: item.id,
      action: item.action,
      createdAt: item.createdAt,
      sourceText: item.sourceText,
      finalText: item.finalText,
      meta: item.meta,
    }))
    .join('\n');
}

async function resolveHistoryPaths() {
  const baseDir = state.config.historyDir?.trim() || await join(await documentDir(), HISTORY_SUBDIR);
  const filePath = await join(baseDir, HISTORY_FILE_NAME);
  return { dirPath: baseDir, filePath };
}

async function ensureHistoryFile() {
  if (!isTauriRuntime) return null;
  const { dirPath, filePath } = await resolveHistoryPaths();
  await mkdir(dirPath, { recursive: true });
  if (!(await exists(filePath))) {
    await writeTextFile(filePath, '');
  }
  state.historyDirResolved = dirPath;
  state.historyFilePath = filePath;
  el.historyDir.value = dirPath;
  return { dirPath, filePath };
}

async function loadHistoryFromDisk() {
  const resolved = await ensureHistoryFile();
  if (!resolved) return;
  const raw = await readTextFile(resolved.filePath);
  const entries = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return normalizeHistoryEntry(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  state.history = entries.slice(0, HISTORY_LIMIT);
}

async function persistHistoryToDisk() {
  if (!isTauriRuntime) return;
  const resolved = await ensureHistoryFile();
  if (!resolved) return;
  const payload = serializeHistoryEntries(state.history);
  await writeTextFile(resolved.filePath, payload ? `${payload}\n` : '');
}

async function initializeHistoryStorage() {
  if (!isTauriRuntime) {
    log('[hist] Modo navegador: historico em arquivo desativado.');
    return;
  }
  try {
    await loadHistoryFromDisk();
    log(`[hist] Historico pronto em ${state.historyFilePath || state.historyDirResolved}.`);
  } catch (err) {
    log(`[error] Falha ao iniciar historico local: ${err.message}`);
  }
}

function apiBaseUrl() {
  return (el.apiBaseUrl?.value || state.config.apiBaseUrl || defaultConfig.apiBaseUrl).trim().replace(/\/+$/, '');
}

function isAuthenticated() {
  return !!(state.config.sessionToken && state.authUser);
}

function setAuthFormMode(mode) {
  el.authNameGroup.classList.toggle('hidden', mode !== 'signup');
  el.authPhoneGroup.classList.toggle('hidden', mode !== 'signup');
  el.authLanguageGroup.classList.toggle('hidden', mode !== 'signup');
  el.authPasswordConfirmGroup.classList.toggle('hidden', mode !== 'account');
  el.authSignInActions.classList.toggle('hidden', mode !== 'signin');
  el.authSignUpActions.classList.toggle('hidden', mode !== 'signup');
  el.authAccountActions.classList.toggle('hidden', mode !== 'account');
  el.authEmail.readOnly = mode === 'account';
  el.authPassword.placeholder = mode === 'account' ? 'Nova senha' : 'Sua senha';
  if (mode === 'signin') {
    el.authModeTitle.textContent = 'Entrar';
    el.authModeHint.textContent = 'Use seu email salvo e a senha para entrar.';
    return;
  }
  if (mode === 'account') {
    el.authModeTitle.textContent = 'Conta autenticada';
    el.authModeHint.textContent = 'Seu email ja foi validado. Aqui voce altera a senha e gerencia a sincronizacao.';
    return;
  }
  el.authModeTitle.textContent = 'Criar conta';
  el.authModeHint.textContent = 'Valide o email uma vez. Depois disso, voce entra so com senha.';
}

function refreshAuthUI() {
  const email = state.authUser?.email || '';
  const name = state.authUser?.display_name || '';
  const plan = state.authUser?.plan || '';
  const hasPassword = Boolean(state.authUser?.has_password ?? state.config.authHasPassword);
  const waitingForEmail = Boolean(state.authRequestId) && !email;
  el.userChip.classList.remove('authenticated', 'pending');
  if (email) {
    setAuthFormMode('account');
    el.userChip.textContent = 'Logado e autenticado';
    el.userChip.classList.add('authenticated');
    el.authStatus.textContent = `Conectado como ${name || email}${plan ? ` · plano ${plan}` : ''}. ${hasPassword ? 'Senha configurada.' : 'Defina uma senha para entrar sem email nas proximas vezes.'} ${state.config.autoSyncCloud ? 'Sincronizacao automatica ativa.' : (state.hasPendingCloudSync ? 'Existem alteracoes pendentes para sincronizar.' : 'Sincronizacao manual ativa.')}`;
  } else if (waitingForEmail) {
    setAuthFormMode('signup');
    el.userChip.textContent = 'Aguardando confirmacao';
    el.userChip.classList.add('pending');
    el.authStatus.textContent = `Link enviado para ${el.authEmail.value.trim() || 'seu email'}. Clique no email para validar a conta ou use "Reenviar e-mail".`;
  } else {
    setAuthFormMode(hasPassword ? 'signin' : 'signup');
    el.userChip.textContent = 'Clique para fazer login';
    el.authStatus.textContent = hasPassword
      ? 'Use email + senha para entrar. O email agora fica so como validacao inicial ou recuperacao.'
      : 'Use validar email na primeira vez. Depois de entrar, cadastre uma senha para nao depender de email.';
  }
  el.userChip.title = 'Abrir area de login';
  el.requestMagicLink.disabled = Boolean(email && hasPassword);
  el.requestMagicLink.textContent = waitingForEmail ? 'Reenviando validacao' : 'Validar email';
  el.loginWithPassword.disabled = Boolean(email);
  el.setPassword.disabled = !email;
  el.setPassword.textContent = hasPassword ? 'Alterar senha' : 'Salvar senha';
  el.resendMagicLink.classList.toggle('hidden', !waitingForEmail);
  el.logoutBtn.classList.toggle('hidden', !email);
  el.syncNow.disabled = !email;
}

async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('content-type', headers.get('content-type') || 'application/json');
  if (state.config.sessionToken) {
    headers.set('authorization', `Bearer ${state.config.sessionToken}`);
  }
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...options,
    headers,
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `Falha HTTP ${response.status}`);
  }
  return payload;
}

async function requestMagicLink() {
  if (isAuthenticated()) {
    log('[auth] A conta ja esta autenticada neste dispositivo.');
    refreshAuthUI();
    return;
  }
  const name = el.authName.value.trim();
  const email = el.authEmail.value.trim();
  const phone = el.authPhone.value.trim();
  const uiLanguage = el.authLanguage.value;
  if (!name) {
    log('[auth] Informe seu nome completo.');
    return;
  }
  if (!email) {
    log('[auth] Informe seu email.');
    return;
  }
  saveFromUI();
  const payload = await apiRequest('/auth/request-magic-link', {
    method: 'POST',
    body: JSON.stringify({
      display_name: name,
      email,
      phone,
      ui_language: uiLanguage,
      device_name: 'Scribeflowai Desktop',
    }),
  });
  state.authRequestId = payload.request_id || '';
  startAuthPolling();
  log(`[auth] Link enviado para ${email}. Abra o email para concluir o login.`);
  el.authStatus.textContent = `Link enviado para ${email}. Aguardando confirmacao...`;
  refreshAuthUI();
}

async function loginWithPassword() {
  if (isAuthenticated()) {
    log('[auth] A conta ja esta autenticada neste dispositivo.');
    return;
  }
  const email = el.authEmail.value.trim();
  const password = el.authPassword.value.trim();
  if (!email || !password) {
    log('[auth] Informe email e senha para entrar.');
    return;
  }
  saveFromUI();
  const payload = await apiRequest('/auth/login-password', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      device_name: 'Scribeflowai Desktop',
      platform: navigator.platform || 'desktop',
      app_version: APP_VERSION,
    }),
  });
  await completeLogin(payload);
  el.authPassword.value = '';
  el.authPasswordConfirm.value = '';
}

async function savePassword() {
  if (!isAuthenticated()) {
    log('[auth] Valide o email primeiro e faca login antes de definir a senha.');
    openAccountAccess('email');
    return;
  }
  const password = el.authPassword.value.trim();
  const confirmPassword = el.authPasswordConfirm.value.trim();
  if (!password || !confirmPassword) {
    log('[auth] Informe e confirme a nova senha.');
    return;
  }
  await apiRequest('/auth/set-password', {
    method: 'POST',
    body: JSON.stringify({
      password,
      confirm_password: confirmPassword,
    }),
  });
  if (state.authUser) {
    state.authUser.has_password = true;
  }
  state.config.authHasPassword = true;
  persistConfig();
  el.authPassword.value = '';
  el.authPasswordConfirm.value = '';
  refreshAuthUI();
  log('[auth] Senha salva. Agora voce pode entrar com email e senha nas proximas vezes.');
}

async function completeLogin(payload) {
  state.config.sessionToken = payload.session_token;
  state.config.sessionExpiresAt = payload.session_expires_at;
  persistConfig();
  const profile = await apiRequest('/me', { method: 'GET' });
  state.authUser = profile.user || payload.user || null;
  state.authDevice = profile.device || payload.device || null;
  state.config.deviceId = state.authDevice?.id || payload.device?.id || state.config.deviceId || '';
  state.config.authName = state.authUser?.display_name || state.config.authName || '';
  state.config.authEmail = state.authUser?.email || state.config.authEmail || '';
  state.config.authPhone = state.authUser?.phone || state.config.authPhone || '';
  state.config.authLanguage = state.authUser?.ui_language || state.config.authLanguage || 'pt';
  state.config.authHasPassword = Boolean(state.authUser?.has_password);
  el.authName.value = state.config.authName;
  el.authEmail.value = state.config.authEmail;
  el.authPhone.value = state.config.authPhone;
  el.authLanguage.value = state.config.authLanguage;
  if (state.config.authLanguage) {
    state.config.uiLanguage = state.config.authLanguage;
    el.uiLanguage.value = state.config.uiLanguage;
    applyUILanguage();
  }
  persistConfig();
  refreshAuthUI();
  stopAuthPolling();
  startHeartbeat();
  await syncUserSettings('pull');
  await syncConversations();
  log(`[auth] Sessao iniciada para ${state.authUser?.email || 'usuario'}.`);
}

function stopAuthPolling(clearRequestId = true) {
  if (state.authPollTimer) {
    clearInterval(state.authPollTimer);
    state.authPollTimer = null;
  }
  if (clearRequestId) {
    state.authRequestId = '';
  }
  refreshAuthUI();
}

function startAuthPolling() {
  stopAuthPolling(false);
  if (!state.authRequestId) return;
  state.authPollTimer = setInterval(() => {
    void pollAuthStatus();
  }, 3000);
  void pollAuthStatus();
}

async function pollAuthStatus() {
  if (!state.authRequestId) return;
  try {
    const payload = await apiRequest(`/auth/request-status?request_id=${encodeURIComponent(state.authRequestId)}`, {
      method: 'GET',
      headers: {},
    });
    if (payload.status === 'pending') {
      el.authStatus.textContent = 'Email enviado. Aguardando voce clicar no link...';
      return;
    }
    if (payload.status === 'expired') {
      stopAuthPolling();
      el.authStatus.textContent = 'Link expirado. Solicite um novo login.';
      log('[auth] Link expirado.');
      return;
    }
    if (payload.status === 'completed' && payload.session_token) {
      await completeLogin(payload);
    }
  } catch (error) {
    log(`[auth] Falha ao verificar status do login: ${error.message}`);
  }
}

async function restoreSession() {
  if (!state.config.sessionToken) {
    refreshAuthUI();
    return;
  }
  try {
    const payload = await apiRequest('/me', { method: 'GET' });
    state.authUser = payload.user || null;
    state.authDevice = payload.device || null;
    state.config.authHasPassword = Boolean(state.authUser?.has_password);
    persistConfig();
    clearCloudSyncPending();
    refreshAuthUI();
    startHeartbeat();
    await syncUserSettings('pull');
    await syncConversations();
    log('[auth] Sessao restaurada.');
  } catch (error) {
    log(`[auth] Sessao anterior invalida: ${error.message}`);
    logout(false);
  }
}

function logout(logEvent = true) {
  stopAuthPolling();
  state.config.sessionToken = '';
  state.config.sessionExpiresAt = '';
  state.config.deviceId = '';
  state.authUser = null;
  state.authDevice = null;
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
  persistConfig();
  refreshAuthUI();
  if (logEvent) {
    log('[auth] Sessao encerrada.');
  }
}

function startHeartbeat() {
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
  }
  state.heartbeatTimer = setInterval(() => {
    void sendHeartbeat();
  }, 60_000);
  void sendHeartbeat();
}

async function sendHeartbeat() {
  if (!isAuthenticated()) return;
  try {
    await apiRequest('/devices/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        app_version: APP_VERSION,
        platform: navigator.platform || 'desktop',
      }),
    });
  } catch (error) {
    log(`[auth] Heartbeat falhou: ${error.message}`);
  }
}

async function syncConversations() {
  if (!isAuthenticated()) {
    log('[sync] Faca login para sincronizar historico.');
    return;
  }
  try {
    await apiRequest('/sync/conversations', {
      method: 'POST',
      body: JSON.stringify({
        items: state.history.map((item) => ({
          id: item.id,
          action: item.action,
          source_text: item.sourceText,
          final_text: item.finalText,
          created_at: item.createdAt,
          updated_at: item.createdAt,
        })),
      }),
    });
    const payload = await apiRequest('/sync/conversations', { method: 'GET' });
    const incoming = Array.isArray(payload?.items) ? payload.items.map((item) => normalizeHistoryEntry({
      id: item.id,
      action: item.action,
      sourceText: item.source_text,
      finalText: item.final_text,
      createdAt: item.created_at || item.updated_at,
      meta: { deviceId: item.device_id, syncVersion: item.sync_version },
    })) : [];
    const byId = new Map(state.history.map((item) => [item.id, item]));
    incoming.forEach((item) => {
      byId.set(item.id, item);
    });
    state.history = [...byId.values()]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, HISTORY_LIMIT);
    renderHistory();
    await persistHistoryToDisk();
    clearCloudSyncPending();
    log('[sync] Historico sincronizado.');
  } catch (error) {
    log(`[sync] Falha na sincronizacao: ${error.message}`);
  }
}

function buildSettingsPayload() {
  return {
    settings: {
      llm_provider: state.config.llmProvider,
      stt_model: state.config.sttModel,
      llm_model: state.config.llmModel,
      translation_lang: state.config.translationLang,
      auto_sync_cloud: state.config.autoSyncCloud,
      same_key: state.config.sameKey,
      use_free_fallback: state.config.useFreeFallback,
      append_dictation: state.config.appendDictation,
      ui_language: state.config.uiLanguage,
    },
    secrets: {
      stt_key: state.config.sttKey || '',
      llm_key: state.config.llmKey || '',
    },
  };
}

function applyRemoteSettings(payload) {
  const settings = payload?.settings || null;
  const secrets = payload?.secrets || null;
  if (!settings && !secrets) return false;

  if (settings) {
    state.config.llmProvider = settings.llm_provider || state.config.llmProvider;
    state.config.sttModel = settings.stt_model || state.config.sttModel;
    state.config.llmModel = settings.llm_model || state.config.llmModel;
    state.config.translationLang = settings.translation_lang || state.config.translationLang;
    state.config.autoSyncCloud = typeof settings.auto_sync_cloud === 'boolean' ? settings.auto_sync_cloud : state.config.autoSyncCloud;
    state.config.sameKey = typeof settings.same_key === 'boolean' ? settings.same_key : state.config.sameKey;
    state.config.useFreeFallback = typeof settings.use_free_fallback === 'boolean' ? settings.use_free_fallback : state.config.useFreeFallback;
    state.config.appendDictation = typeof settings.append_dictation === 'boolean' ? settings.append_dictation : state.config.appendDictation;
    state.config.uiLanguage = settings.ui_language || state.config.uiLanguage;
  }

  if (secrets) {
    if (typeof secrets.stt_key === 'string') {
      state.config.sttKey = secrets.stt_key;
    }
    if (typeof secrets.llm_key === 'string') {
      state.config.llmKey = secrets.llm_key;
    }
  }

  persistConfig();
  syncConfigToUI();
  setProviderDefaults(state.config.llmModel);
  applyUILanguage();
  return true;
}

async function syncUserSettings(mode = 'pull') {
  if (!isAuthenticated()) return;
  if (mode === 'push') {
    await apiRequest('/me/settings', {
      method: 'PUT',
      body: JSON.stringify(buildSettingsPayload()),
    });
    clearCloudSyncPending();
    log('[sync] Configuracoes da conta sincronizadas com a nuvem.');
    return;
  }

  const payload = await apiRequest('/me/settings', { method: 'GET' });
  const hasRemoteSettings = !!payload?.settings || !!payload?.secrets?.stt_key || !!payload?.secrets?.llm_key;
  if (hasRemoteSettings) {
    applyRemoteSettings(payload);
    log('[sync] Configuracoes da conta restauradas da nuvem.');
    return;
  }

  await apiRequest('/me/settings', {
    method: 'PUT',
    body: JSON.stringify(buildSettingsPayload()),
  });
  clearCloudSyncPending();
  log('[sync] Configuracoes locais enviadas para a nuvem.');
}

async function syncAllCloudData() {
  if (!isAuthenticated()) {
    log('[sync] Faca login para sincronizar.');
    return;
  }
  await syncUserSettings('push');
  await syncConversations();
}

async function confirmSyncBeforeLeaving() {
  if (!hasCloudSyncPending() || state.config.autoSyncCloud) return true;
  const shouldSync = window.confirm('Existem alteracoes pendentes para sincronizar com a nuvem. Deseja sincronizar agora antes de sair?');
  if (!shouldSync) return true;
  try {
    await syncAllCloudData();
    return true;
  } catch (error) {
    log(`[sync] Falha ao sincronizar antes de sair: ${error.message}`);
    return window.confirm('A sincronizacao falhou. Deseja sair mesmo assim?');
  }
}

async function checkForUpdates() {
  try {
    const payload = await apiRequest('/updates/latest?channel=stable', { method: 'GET' });
    const update = payload?.update;
    if (!update?.latest_version) return;
    if (compareVersions(update.latest_version, APP_VERSION) <= 0) return;
    const label = update.download_url ? ` Baixe em ${update.download_url}` : '';
    showNotice(`Nova versao disponivel: ${update.latest_version}.${label}`, 'info');
    log(`[update] Nova versao disponivel: ${update.latest_version}.`);
  } catch (error) {
    log(`[update] Nao foi possivel verificar novas versoes: ${error.message}`);
  }
}

function compareVersions(a, b) {
  const aParts = String(a).split('.').map((item) => Number.parseInt(item, 10) || 0);
  const bParts = String(b).split('.').map((item) => Number.parseInt(item, 10) || 0);
  const length = Math.max(aParts.length, bParts.length);
  for (let index = 0; index < length; index += 1) {
    const left = aParts[index] || 0;
    const right = bParts[index] || 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }
  return 0;
}

async function chooseHistoryDirectory() {
  if (!isTauriRuntime) {
    log('[hist] Escolha de pasta disponivel apenas no app Tauri.');
    return;
  }
  const selected = await openDialog({
    title: 'Escolher pasta do historico',
    directory: true,
    multiple: false,
    defaultPath: state.historyDirResolved || state.config.historyDir || undefined,
  });
  if (!selected || Array.isArray(selected)) return;
  state.config.historyDir = selected;
  persistConfig();
  await initializeHistoryStorage();
  renderHistory();
  log(`[hist] Pasta do historico definida para ${selected}.`);
}

async function importHistoryFile() {
  if (!isTauriRuntime) {
    log('[hist] Importacao disponivel apenas no app Tauri.');
    return;
  }
  const selected = await openDialog({
    title: 'Importar historico',
    directory: false,
    multiple: false,
    filters: [{ name: 'Historico Scribeflowai', extensions: ['jsonl', 'txt'] }],
    defaultPath: state.historyDirResolved || state.config.historyDir || undefined,
  });
  if (!selected || Array.isArray(selected)) return;

  const raw = await readTextFile(selected);
  const imported = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return normalizeHistoryEntry(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const existingIds = new Set(state.history.map((item) => item.id));
  let inserted = 0;
  imported.forEach((item) => {
    if (!existingIds.has(item.id)) {
      state.history.push(item);
      existingIds.add(item.id);
      inserted += 1;
    }
  });
  state.history.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  state.history = state.history.slice(0, HISTORY_LIMIT);
  renderHistory();
  await persistHistoryToDisk();
  log(`[hist] ${inserted} registros importados de ${selected}.`);
}

async function exportHistoryBackup() {
  if (!isTauriRuntime) {
    log('[hist] Exportacao disponivel apenas no app Tauri.');
    return;
  }
  const defaultFile = await join(
    state.historyDirResolved || state.config.historyDir || await join(await documentDir(), HISTORY_SUBDIR),
    `scribeflowai-history-${new Date().toISOString().slice(0, 10)}.jsonl`,
  );
  const target = await saveDialog({
    title: 'Exportar backup do historico',
    defaultPath: defaultFile,
    filters: [{ name: 'Historico Scribeflowai', extensions: ['jsonl'] }],
  });
  if (!target) return;
  const payload = serializeHistoryEntries(state.history);
  await writeTextFile(target, payload ? `${payload}\n` : '');
  log(`[hist] Backup exportado para ${target}.`);
}

function buildRecordingBaseText(rawText) {
  const dictatedText = (rawText || '').trim();
  const existingText = currentEditorText();
  if (!state.config.appendDictation || !existingText) {
    return dictatedText;
  }
  return `${existingText}\n\n${dictatedText}`.trim();
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

    const hadExistingText = !!currentEditorText();
    const sourceText = buildRecordingBaseText(rawText);
    if (state.config.appendDictation && hadExistingText) {
      log('[rec] Complementando o texto atual com o novo ditado.');
    }

    let finalText = sourceText;
    if (state.mode === 'rewrite') finalText = rewriteSmartLocal(sourceText);
    if (state.mode === 'rewrite_llm') finalText = await rewriteText(sourceText, state.abortController.signal);
    if (state.mode === 'translate') finalText = await translateText(sourceText, state.config.translationLang, state.abortController.signal);
    if (state.mode === 'codex') finalText = await codexPrompt(sourceText, state.abortController.signal);

    if (!state.abortController.signal.aborted) {
      el.resultText.value = finalText;
      updateMetrics();
      addHistory(finalText, state.mode, rawText, { combinedWithEditor: state.config.appendDictation && hadExistingText });
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
    if (mode === 'rewrite_text') {
      log('[acao] Reescrevendo a versao atual editada no editor.');
    }
    if (mode === 'rewrite_prompt') {
      el.resultText.value = await codexPrompt(text, state.abortController.signal);
    } else if (mode === 'retranslate') {
      el.resultText.value = await translateText(text, state.config.translationLang, state.abortController.signal);
    } else {
      el.resultText.value = await rewriteText(text, state.abortController.signal);
    }

    updateMetrics();
    addHistory(el.resultText.value, mode, text);
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
    addHistory(`Q: ${question}\nA: ${answer}`, 'chat', question, { answer });
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
        'Você é um editor sênior de ditado em português (pt-BR).',
        'Tarefa: transformar a fala transcrita em um texto final claro, lógico, natural e pronto para uso.',
        '',
        'Regras obrigatórias:',
        '1) Preserve o significado e o contexto principal.',
        '2) Remova repetições, vícios de fala, hesitações e trechos incoerentes.',
        '3) Organize o raciocínio em uma sequência fluida de ideias.',
        '4) Se houver mudança de ideia no meio da fala, mantenha a versão final/intenção mais recente.',
        '5) Reestruture frases quebradas para melhor legibilidade, sem mudar a intenção.',
        '6) Corrija gramática, pontuação e concordância.',
        '7) Não invente fatos. Se algo ficar ambíguo, escolha a interpretação mais provável pelo contexto.',
        '8) Entregue somente o texto final (sem explicações, sem tópicos extras).',
        '9) Remova instruções meta dirigidas ao assistente/editor (ex.: "escreve X do jeito correto", "corrige esse termo", "troca tal palavra"), a menos que façam parte do conteúdo final pretendido.',
        '',
        'Tom de saída:',
        '- Direto, claro, natural e profissional.',
        '- Frases enxutas, evitando redundância.',
        '',
        'Importante:',
        '- Não descreva o que você fez.',
        '- Não inclua títulos, listas ou prefácios.',
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

function addHistory(finalText, action, sourceText = '', meta = {}) {
  const entry = buildHistoryEntry({ action, finalText, sourceText, meta });
  state.history.unshift(entry);
  state.history = state.history.slice(0, HISTORY_LIMIT);
  renderHistory();
  void persistHistoryToDisk();
  if (isAuthenticated()) {
    markCloudSyncPending('historico');
    if (state.config.autoSyncCloud) {
      void syncConversations();
    }
  }
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
      rewrite_text: 'Reescrever texto atual',
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
