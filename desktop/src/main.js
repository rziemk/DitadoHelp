import { documentDir, join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { exists, mkdir, readDir, readFile, readTextFile, writeFile, writeTextFile } from '@tauri-apps/plugin-fs';

const STORAGE_KEY = 'scribeflowai.desktop.config.v2';
const LEGACY_STORAGE_KEYS = ['helpscribe.desktop.config.v2', 'helpscribe.desktop.config.v1'];
const APP_VERSION = '0.1.58';
const CALL_COMPARISON_GROUPS_KEY = 'scribeflowai.callComparisonGroups.v1';
const CALL_COMPARISON_SCRIPTS_KEY = 'scribeflowai.callComparisonScripts.v1';
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
  autoSummaryFromAudio: true,
  autoImportCallsEnabled: false,
  autoImportCallsDir: '',
  autoImportCallsSeen: [],
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
  autoImportTimer: null,
  autoImportSeen: new Set(),
  localCallRecorder: null,
  localCallStream: null,
  localCallChunks: [],
  localCallMimeType: '',
  localCallExt: 'webm',
  isLocalCallRecording: false,
  callAnalyses: [],
  selectedCallAnalysis: null,
  callComparisonScripts: [],
  selectedCallScriptId: '',
  callComparisonGroups: [],
  selectedCallGroupId: '',
  selectedCallAnalysisIds: new Set(),
  isCloudSyncingCallComparisons: false,
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
  btnFileTranscriptMode: document.getElementById('btnFileTranscriptMode'),
  btnAutoCallsMode: document.getElementById('btnAutoCallsMode'),
  btnCallAnalysisMode: document.getElementById('btnCallAnalysisMode'),
  btnBackToMain: document.getElementById('btnBackToMain'),
  btnCodex: document.getElementById('btnCodex'),
  recordingTag: document.getElementById('recordingTag'),
  stopBtn: document.getElementById('stopBtn'),
  editorCard: document.querySelector('.editor-card'),
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
  workflowPanel: document.getElementById('workflowPanel'),
  fileTranscriptPanel: document.getElementById('fileTranscriptPanel'),
  autoCallsPanel: document.getElementById('autoCallsPanel'),
  callAnalysisPanel: document.getElementById('callAnalysisPanel'),
  callSubtabs: Array.from(document.querySelectorAll('.call-subtab')),
  callManageView: document.getElementById('callManageView'),
  callAnalyzeView: document.getElementById('callAnalyzeView'),
  callResultsView: document.getElementById('callResultsView'),
  dockGrid: document.querySelector('.dock-grid'),
  loadAudioFileBtn: document.getElementById('loadAudioFileBtn'),
  toggleTranscriptHistoryBtn: document.getElementById('toggleTranscriptHistoryBtn'),
  fileTranscriptHistoryPanel: document.getElementById('fileTranscriptHistoryPanel'),
  fileTranscriptHistoryList: document.getElementById('fileTranscriptHistoryList'),
  selectedAudioFile: document.getElementById('selectedAudioFile'),
  audioTranscriptOutput: document.getElementById('audioTranscriptOutput'),
  autoSummaryFromAudio: document.getElementById('autoSummaryFromAudio'),
  audioSummaryOutput: document.getElementById('audioSummaryOutput'),
  chooseAutoImportDirBtn: document.getElementById('chooseAutoImportDirBtn'),
  scanAutoImportNowBtn: document.getElementById('scanAutoImportNowBtn'),
  autoImportDirLabel: document.getElementById('autoImportDirLabel'),
  enableAutoImport: document.getElementById('enableAutoImport'),
  localCallAudioSource: document.getElementById('localCallAudioSource'),
  refreshLocalAudioSourcesBtn: document.getElementById('refreshLocalAudioSourcesBtn'),
  startLocalCallRecordingBtn: document.getElementById('startLocalCallRecordingBtn'),
  stopLocalCallRecordingBtn: document.getElementById('stopLocalCallRecordingBtn'),
  localCallRecordingStatus: document.getElementById('localCallRecordingStatus'),
  addCallAnalysisFileBtn: document.getElementById('addCallAnalysisFileBtn'),
  addCallAnalysisFolderBtn: document.getElementById('addCallAnalysisFolderBtn'),
  newCallGroupBtn: document.getElementById('newCallGroupBtn'),
  callScriptCount: document.getElementById('callScriptCount'),
  callScriptList: document.getElementById('callScriptList'),
  newCallScriptBtn: document.getElementById('newCallScriptBtn'),
  deleteCallScriptBtn: document.getElementById('deleteCallScriptBtn'),
  callGroupList: document.getElementById('callGroupList'),
  callGroupScriptSelect: document.getElementById('callGroupScriptSelect'),
  callGroupAssociationStatus: document.getElementById('callGroupAssociationStatus'),
  callGroupSourceLabel: document.getElementById('callGroupSourceLabel'),
  callGroupName: document.getElementById('callGroupName'),
  saveCallGroupBtn: document.getElementById('saveCallGroupBtn'),
  deleteCallGroupBtn: document.getElementById('deleteCallGroupBtn'),
  selectAllCallAnalysesBtn: document.getElementById('selectAllCallAnalysesBtn'),
  deleteSelectedCallAnalysesBtn: document.getElementById('deleteSelectedCallAnalysesBtn'),
  saveCallScriptBtn: document.getElementById('saveCallScriptBtn'),
  callScriptName: document.getElementById('callScriptName'),
  callAnalysisList: document.getElementById('callAnalysisList'),
  callAnalysisCount: document.getElementById('callAnalysisCount'),
  callExpectedPrompt: document.getElementById('callExpectedPrompt'),
  transcribeSelectedCallBtn: document.getElementById('transcribeSelectedCallBtn'),
  transcribeAllCallsBtn: document.getElementById('transcribeAllCallsBtn'),
  runCallAnalysisBtn: document.getElementById('runCallAnalysisBtn'),
  copyCallAnalysisBtn: document.getElementById('copyCallAnalysisBtn'),
  selectedCallStatus: document.getElementById('selectedCallStatus'),
  callAudioPlayer: document.getElementById('callAudioPlayer'),
  callTranscriptOutput: document.getElementById('callTranscriptOutput'),
  callAnalysisOutput: document.getElementById('callAnalysisOutput'),
  callResultsList: document.getElementById('callResultsList'),
  callGroupSummaryOutput: document.getElementById('callGroupSummaryOutput'),
  callGroupDashboard: document.getElementById('callGroupDashboard'),
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
  initializeCallComparisonGroups();
  updateMetrics();
  setActiveMode('dictate');
  setWorkspaceView('main');
  refreshControls();
  await refreshLocalAudioSources();
  restartAutoImportMonitor();
  installTestHooks();
  log('[ui] Scribeflowai Desktop pronto.');
  if (!currentSttKey()) {
    showNotice('Configure a STT API Key em Configurações para iniciar a gravação.');
    el.configPopover.classList.remove('hidden');
    setConfigSectionsCollapsed();
  }
}

function installTestHooks() {
  if (!new URLSearchParams(window.location.search).has('e2e')) return;
  window.__scribeflowaiTest = {
    commitResultToEditor,
    ensureResultVisible,
    resultText: () => el.resultText.value,
    metricsText: () => el.metrics.textContent,
    setWorkspaceView,
  };
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
  el.btnFileTranscriptMode.addEventListener('click', () => setWorkspaceView('file-transcript'));
  el.btnAutoCallsMode.addEventListener('click', () => setWorkspaceView('auto-calls'));
  el.btnCallAnalysisMode.addEventListener('click', () => setWorkspaceView('call-analysis'));
  el.btnBackToMain.addEventListener('click', () => setWorkspaceView('main'));
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
      const tabName = btn.dataset.tab || 'history';
      el.tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === tabName));
      el.historyTab.classList.toggle('active', tabName === 'history');
      el.statusTab.classList.toggle('active', tabName === 'status');
    });
  });

  el.loadAudioFileBtn.addEventListener('click', async () => {
    await withButtonLoading(el.loadAudioFileBtn, 'Transcrevendo...', async () => {
      await transcribeAudioFileFromDisk();
    });
  });

  el.toggleTranscriptHistoryBtn.addEventListener('click', () => {
    el.fileTranscriptHistoryPanel.classList.toggle('hidden');
    renderFileTranscriptHistory();
  });

  el.chooseAutoImportDirBtn.addEventListener('click', async () => {
    await withButtonLoading(el.chooseAutoImportDirBtn, 'Abrindo...', async () => {
      const selected = await openDialog({ multiple: false, directory: true });
      if (!selected || typeof selected !== 'string') return;
      state.config.autoImportCallsDir = selected;
      el.autoImportDirLabel.textContent = selected;
      persistConfig();
      log(`[auto] Pasta monitorada definida: ${selected}`);
      if (state.config.autoImportCallsEnabled) {
        restartAutoImportMonitor();
      }
    });
  });

  el.scanAutoImportNowBtn.addEventListener('click', async () => {
    await withButtonLoading(el.scanAutoImportNowBtn, 'Processando...', async () => {
      await scanAutoImportDirectory();
    });
  });

  el.refreshLocalAudioSourcesBtn.addEventListener('click', async () => {
    await withButtonLoading(el.refreshLocalAudioSourcesBtn, 'Atualizando...', async () => {
      await refreshLocalAudioSources(true);
    });
  });

  el.startLocalCallRecordingBtn.addEventListener('click', async () => {
    await startLocalCallRecording();
  });

  el.stopLocalCallRecordingBtn.addEventListener('click', async () => {
    await stopLocalCallRecording();
  });

  el.enableAutoImport.addEventListener('change', () => {
    state.config.autoImportCallsEnabled = el.enableAutoImport.checked;
    persistConfig();
    restartAutoImportMonitor();
  });

  el.callSubtabs.forEach((btn) => {
    btn.addEventListener('click', () => setCallAnalysisSubtab(btn.dataset.callTab || 'manage'));
  });

  el.newCallGroupBtn.addEventListener('click', () => createCallComparisonGroup());
  el.saveCallGroupBtn.addEventListener('click', () => saveCurrentCallComparisonGroup());
  el.deleteCallGroupBtn.addEventListener('click', () => deleteCurrentCallComparisonGroup());
  el.newCallScriptBtn.addEventListener('click', () => createNewCallScriptDraft());
  el.saveCallScriptBtn.addEventListener('click', () => saveCurrentCallScript());
  el.deleteCallScriptBtn.addEventListener('click', () => deleteCurrentCallScript());
  el.callGroupScriptSelect.addEventListener('change', () => associateCurrentGroupToScript(el.callGroupScriptSelect.value));
  el.selectAllCallAnalysesBtn.addEventListener('click', () => selectAllCallAnalyses());
  el.deleteSelectedCallAnalysesBtn.addEventListener('click', () => deleteSelectedCallAnalyses());

  el.addCallAnalysisFileBtn.addEventListener('click', async () => {
    await withButtonLoading(el.addCallAnalysisFileBtn, 'Abrindo...', async () => {
      await addCallAnalysisFile();
    });
  });

  el.addCallAnalysisFolderBtn.addEventListener('click', async () => {
    await withButtonLoading(el.addCallAnalysisFolderBtn, 'Abrindo...', async () => {
      await addCallAnalysisFolder();
    });
  });

  el.transcribeSelectedCallBtn.addEventListener('click', async () => {
    await withButtonLoading(el.transcribeSelectedCallBtn, 'Transcrevendo...', async () => {
      await transcribeSelectedCallAnalysis();
    });
  });

  el.transcribeAllCallsBtn.addEventListener('click', async () => {
    await withButtonLoading(el.transcribeAllCallsBtn, 'Transcrevendo...', async () => {
      await transcribeAllCallAnalyses();
    });
  });

  el.runCallAnalysisBtn.addEventListener('click', async () => {
    await withButtonLoading(el.runCallAnalysisBtn, 'Analisando...', async () => {
      await runSelectedCallComparison();
    });
  });

  el.copyCallAnalysisBtn.addEventListener('click', async () => {
    const item = selectedCallAnalysisItem();
    const text = item?.analysis || '';
    if (!text.trim()) return log('[calls] Sem análise para copiar.');
    await navigator.clipboard.writeText(text);
    log('[calls] Análise copiada.');
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
  el.autoSummaryFromAudio.checked = Boolean(state.config.autoSummaryFromAudio);
  el.audioSummaryOutput.textContent = 'Resumo da transcrição aparecerá aqui.';
  el.autoImportDirLabel.textContent = state.config.autoImportCallsDir || 'Nenhuma pasta configurada.';
  el.enableAutoImport.checked = Boolean(state.config.autoImportCallsEnabled);
  state.autoImportSeen = new Set(Array.isArray(state.config.autoImportCallsSeen) ? state.config.autoImportCallsSeen : []);
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
    autoSummaryFromAudio: el.autoSummaryFromAudio.checked,
    autoImportCallsEnabled: el.enableAutoImport.checked,
    autoImportCallsDir: state.config.autoImportCallsDir || '',
    autoImportCallsSeen: Array.from(state.autoImportSeen).slice(-500),
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
  await syncCallComparisons();
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
    await syncCallComparisons();
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

function serializeCallScriptForCloud(script) {
  return {
    id: script.id,
    name: script.name,
    body: script.body,
    created_at: script.createdAt || new Date().toISOString(),
    updated_at: script.updatedAt || script.createdAt || new Date().toISOString(),
  };
}

function serializeCallGroupForCloud(group) {
  return {
    id: group.id,
    name: group.name,
    script_id: group.scriptId || '',
    source_type: group.sourceType || '',
    source_path: group.sourcePath || '',
    source_loaded_at: group.sourceLoadedAt || '',
    summary: group.summary || '',
    created_at: group.createdAt || new Date().toISOString(),
    updated_at: group.updatedAt || group.createdAt || new Date().toISOString(),
    calls: (group.calls || []).map((item) => ({
      id: item.id,
      file_name: item.fileName,
      file_path: item.filePath,
      status: item.status,
      is_transcribed: Boolean(item.rawTranscript || item.speakerTranscript),
      raw_transcript: item.rawTranscript || '',
      speaker_transcript: item.speakerTranscript || '',
      transcript_summary: item.transcriptSummary || '',
      analysis: item.analysis || '',
      comparison_summary: item.comparisonSummary || '',
      sentiment_label: item.sentimentLabel || '',
      sentiment_summary: item.sentimentSummary || '',
      sentiment_people: item.sentimentPeople || '',
      score: item.score,
      is_good: item.isGood,
      error: item.error || '',
      transcribed_at: item.transcribedAt || '',
      analyzed_at: item.analyzedAt || '',
      created_at: item.createdAt || new Date().toISOString(),
      updated_at: item.updatedAt || item.createdAt || new Date().toISOString(),
    })),
  };
}

function mergeCloudCallComparisons(payload) {
  const scripts = Array.isArray(payload?.scripts) ? normalizeCallComparisonScripts(payload.scripts.map((script) => ({
    id: script.id,
    name: script.name,
    body: script.body,
    createdAt: script.created_at,
    updatedAt: script.updated_at,
  }))) : [];
  const groups = Array.isArray(payload?.groups) ? normalizeCallComparisonGroups(payload.groups.map((group) => ({
    id: group.id,
    name: group.name,
    scriptId: group.script_id,
    sourceType: group.source_type,
    sourcePath: group.source_path,
    sourceLoadedAt: group.source_loaded_at,
    summary: group.summary,
    createdAt: group.created_at,
    updatedAt: group.updated_at,
    calls: Array.isArray(group.calls) ? group.calls : [],
  }))) : [];

  const scriptMap = new Map(state.callComparisonScripts.map((script) => [script.id, script]));
  scripts.forEach((script) => {
    const current = scriptMap.get(script.id);
    if (!current || new Date(script.updatedAt || 0) > new Date(current.updatedAt || 0)) {
      scriptMap.set(script.id, script);
    }
  });
  state.callComparisonScripts = [...scriptMap.values()].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

  const groupMap = new Map(state.callComparisonGroups.map((group) => [group.id, group]));
  groups.forEach((group) => {
    const current = groupMap.get(group.id);
    if (!current || new Date(group.updatedAt || 0) > new Date(current.updatedAt || 0)) {
      groupMap.set(group.id, group);
    }
  });
  state.callComparisonGroups = [...groupMap.values()].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  if (!state.callComparisonGroups.some((group) => group.id === state.selectedCallGroupId)) {
    state.selectedCallGroupId = state.callComparisonGroups[0]?.id || '';
  }
  if (!state.callComparisonScripts.some((script) => script.id === state.selectedCallScriptId)) {
    state.selectedCallScriptId = state.callComparisonScripts[0]?.id || '';
  }
  syncCurrentCallGroupCalls();
  renderCallScriptList();
  renderCallGroupList();
  renderSelectedCallAnalysis();
}

async function syncCallComparisons() {
  if (!isAuthenticated()) {
    log('[sync] Faca login para sincronizar analises de ligacoes.');
    return;
  }
  state.isCloudSyncingCallComparisons = true;
  try {
    await apiRequest('/sync/call-comparisons', {
      method: 'POST',
      body: JSON.stringify({
        scripts: state.callComparisonScripts.map(serializeCallScriptForCloud),
        groups: state.callComparisonGroups.map(serializeCallGroupForCloud),
      }),
    });
    const payload = await apiRequest('/sync/call-comparisons', { method: 'GET' });
    mergeCloudCallComparisons(payload);
    localStorage.setItem(CALL_COMPARISON_SCRIPTS_KEY, JSON.stringify(state.callComparisonScripts));
    localStorage.setItem(CALL_COMPARISON_GROUPS_KEY, JSON.stringify(state.callComparisonGroups));
    clearCloudSyncPending();
    log('[sync] Analises de ligacoes sincronizadas com D1.');
  } catch (error) {
    log(`[sync] Falha ao sincronizar analises de ligacoes: ${error.message}`);
  } finally {
    state.isCloudSyncingCallComparisons = false;
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
  await syncCallComparisons();
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
    if (state.mode !== mode) {
      state.mode = mode;
      el.assistMode.textContent = modeLabel(mode);
      setActiveMode(mode);
      log(`[rec] Modo alterado para ${modeLabel(mode)}. Parando e processando o áudio atual.`);
    }
    await stopRecording();
    return;
  }

  setWorkspaceView('main');
  hideNotice();
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
    const { mime, options } = selectSupportedAudioMime();
    state.mediaRecorder = new MediaRecorder(state.stream, options);
    state.recordingMimeType = state.mediaRecorder.mimeType || mime;
    state.recordingExt = mimeToExt(state.recordingMimeType);
    state.mediaRecorder.ondataavailable = (ev) => ev.data.size && state.chunks.push(ev.data);
    state.mediaRecorder.onstop = handleRecordingStopped;
    state.mediaRecorder.start();
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
    const blobType = state.recordingMimeType || state.mediaRecorder?.mimeType || state.chunks[0]?.type || '';
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
    try {
      if (state.mode === 'rewrite') finalText = rewriteSmartLocal(sourceText);
      if (state.mode === 'rewrite_llm') finalText = await rewriteText(sourceText, state.abortController.signal);
      if (state.mode === 'translate') finalText = await translateText(sourceText, state.config.translationLang, state.abortController.signal);
      if (state.mode === 'codex') finalText = await codexPrompt(sourceText, state.abortController.signal);
    } catch (err) {
      finalText = sourceText;
      showNotice(`Transcrição feita, mas o processamento ${modeLabel(state.mode)} falhou. Mantive o texto bruto no box.`, 'error');
      log(`[proc] Falha no processamento ${state.mode}; usando transcrição bruta: ${err.message}`);
    }

    finalText = ensureFinalText(finalText, sourceText);

    if (!state.abortController.signal.aborted) {
      setWorkspaceView('main');
      commitResultToEditor(finalText);
      addHistory(finalText, state.mode, rawText, { combinedWithEditor: state.config.appendDictation && hadExistingText });
      await pasteResultText(finalText);
      ensureResultVisible(finalText);
      log('[rec] Resultado pronto.');
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      log('[proc] Processamento cancelado.');
    } else {
      log(`[error] ${err.message}`);
      showNotice(`Falha ao transcrever: ${err.message}`, 'error');
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

async function pasteResultText(text) {
  const finalText = (text || '').trim();
  if (!finalText) return;
  try {
    await navigator.clipboard.writeText(finalText);
  } catch (err) {
    log(`[paste] Não foi possível copiar para clipboard: ${err.message}`);
  }

  if (!isTauriRuntime) return;
  try {
    await invoke('paste_text', { text: finalText });
    log('[paste] Texto copiado para clipboard.');
  } catch (err) {
    log(`[paste] Não foi possível copiar via Tauri: ${err}`);
    showNotice('Texto transcrito no box, mas não consegui copiar para o clipboard.', 'error');
  }
}

function commitResultToEditor(text) {
  const finalText = (text || '').trim();
  el.resultText.value = finalText;
  el.resultText.dispatchEvent(new Event('input', { bubbles: true }));
  updateMetrics();
  log(`[ui] Texto escrito no box principal (${finalText.length} caracteres).`);
}

function ensureFinalText(finalText, sourceText) {
  const processed = (finalText || '').trim();
  if (processed) return processed;
  const fallback = (sourceText || '').trim();
  if (fallback) {
    log('[proc] Processamento retornou vazio; usando transcrição bruta no box.');
    return fallback;
  }
  return '';
}

function ensureResultVisible(expectedText) {
  const expected = (expectedText || '').trim();
  if (!expected) return;
  if ((el.resultText.value || '').trim() === expected) return;
  log('[ui] Box principal perdeu o texto após a colagem; restaurando resultado.');
  commitResultToEditor(expected);
}

async function transcribe(blob, signal) {
  const sttKey = currentSttKey();
  if (!sttKey) throw new Error('Defina STT API Key.');
  const fd = new FormData();
  fd.append('model', state.config.sttModel || defaultConfig.sttModel);
  const ext = uploadAudioExt(mimeToExt(blob.type || state.recordingMimeType || '') || state.recordingExt || 'mp4');
  log(`[stt] Enviando audio.${ext} (${blob.type || 'sem mime'}, ${(blob.size / 1024).toFixed(1)} KB).`);
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

function uploadAudioExt(ext) {
  return String(ext || '').toLowerCase() === 'opus' ? 'ogg' : ext;
}

async function transcribeAudioFileFromDisk() {
  if (state.isRecording || state.isProcessing || state.isStartingRecording) {
    log('[stt] Aguarde o processamento atual finalizar para importar áudio.');
    return;
  }

  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'mp4', 'ogg', 'opus', 'webm'] }],
  });
  if (!selected || typeof selected !== 'string') return;
  await processAudioFilePath(selected, false);
}

function selectSupportedAudioMime() {
  const preferredMimeTypes = [
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mpeg',
    'audio/ogg;codecs=opus',
  ];
  const selectedMime = preferredMimeTypes.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  return {
    mime: selectedMime,
    options: selectedMime ? { mimeType: selectedMime } : undefined,
  };
}

async function startLocalCallRecording() {
  if (state.isLocalCallRecording) {
    log('[call] A gravação local já está ativa.');
    return;
  }
  if (state.isRecording || state.isProcessing || state.isStartingRecording) {
    log('[call] Aguarde finalizar a operação atual antes de iniciar gravação local.');
    return;
  }
  if (!currentSttKey()) {
    showNotice('Configure a STT API Key em Configurações para gravar/transcrever calls.', 'error');
    log('[error] Configure STT API Key antes de gravar call local.');
    el.configPopover.classList.remove('hidden');
    el.sttKey.focus();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    log('[error] Este ambiente não suporta captura de áudio local (getUserMedia).');
    return;
  }

  try {
    await refreshLocalAudioSources();
    const selectedDeviceId = el.localCallAudioSource.value || '';
    const audioConstraint = selectedDeviceId
      ? { deviceId: { exact: selectedDeviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      : { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('Nenhuma fonte de áudio local foi capturada.');
    }

    const { mime, options } = selectSupportedAudioMime();
    state.localCallStream = stream;
    state.localCallChunks = [];
    state.localCallRecorder = new MediaRecorder(stream, options);
    state.localCallMimeType = state.localCallRecorder.mimeType || mime;
    state.localCallExt = mimeToExt(state.localCallMimeType);
    state.localCallRecorder.ondataavailable = (ev) => ev.data.size && state.localCallChunks.push(ev.data);
    state.localCallRecorder.onstop = handleLocalCallRecordingStopped;
    state.localCallRecorder.start();
    state.isLocalCallRecording = true;

    const [audioTrack] = stream.getAudioTracks();
    if (audioTrack) {
      audioTrack.onended = () => {
        if (state.isLocalCallRecording) {
          void stopLocalCallRecording();
        }
      };
    }

    el.localCallRecordingStatus.textContent = 'Gravação local ativa. Clique em "Parar e transcrever" ao fim da call.';
    refreshControls();
    log(`[call] Gravação local iniciada usando fonte: ${selectedLocalAudioSourceLabel()}.`);
  } catch (err) {
    const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
    if (denied) {
      log('[error] Permissão negada para captura de áudio. Autorize o microfone/entrada de áudio para o app.');
      return;
    }
    log(`[error] Falha ao iniciar gravação local: ${err.message}`);
  }
}

async function refreshLocalAudioSources(forcePermission = false) {
  if (!navigator.mediaDevices?.enumerateDevices) {
    el.localCallAudioSource.innerHTML = '<option value="">Fonte padrão do sistema</option>';
    return;
  }

  if (forcePermission && navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      // enumerateDevices still works, but labels may remain hidden without permission.
    }
  }

  const previous = el.localCallAudioSource.value;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const audioInputs = devices.filter((device) => device.kind === 'audioinput');
  el.localCallAudioSource.innerHTML = '';

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'Fonte padrão do sistema';
  el.localCallAudioSource.appendChild(defaultOption);

  audioInputs.forEach((device, index) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `Entrada de áudio ${index + 1}`;
    el.localCallAudioSource.appendChild(option);
  });

  if (previous && audioInputs.some((device) => device.deviceId === previous)) {
    el.localCallAudioSource.value = previous;
  }
}

function selectedLocalAudioSourceLabel() {
  const option = el.localCallAudioSource.selectedOptions?.[0];
  return option?.textContent || 'Fonte padrão do sistema';
}

async function stopLocalCallRecording() {
  if (!state.isLocalCallRecording || !state.localCallRecorder) return;
  try {
    if (state.localCallRecorder.state === 'recording') {
      state.localCallRecorder.stop();
    }
  } finally {
    state.isLocalCallRecording = false;
    el.localCallRecordingStatus.textContent = 'Finalizando gravação local e iniciando transcrição...';
    refreshControls();
  }
}

async function handleLocalCallRecordingStopped() {
  const strings = UI_STRINGS[state.config.uiLanguage] || UI_STRINGS.pt;
  state.isProcessing = true;
  state.abortController = new AbortController();
  el.assistState.textContent = strings.processing;
  refreshControls();

  try {
    const blobType = state.localCallMimeType || state.localCallRecorder?.mimeType || state.localCallChunks[0]?.type || '';
    const blob = new Blob(state.localCallChunks, { type: blobType });
    if (!blob.size) throw new Error('Nenhum áudio capturado na gravação local da call.');

    const filePath = await persistLocalCallRecording(blob, state.localCallExt || mimeToExt(blobType));
    const fileName = filePath
      ? filePath.split('/').pop()?.split('\\').pop() || 'call-audio'
      : `call-audio.${state.localCallExt || mimeToExt(blobType)}`;
    const rawText = await transcribe(blob, state.abortController.signal);
    if (!rawText) throw new Error('Transcrição vazia para a gravação local.');

    const finalText = rawText.trim();
    commitResultToEditor(finalText);
    addHistory(finalText, 'dictate', rawText, { source: 'local_call_recording', fileName, filePath });
    log(`[call] Gravação local transcrita com sucesso (${fileName}).`);

    if (state.config.autoSummaryFromAudio) {
      const summary = await summarizeTranscript(finalText, state.abortController.signal);
      if (summary) {
        el.audioSummaryOutput.textContent = summary;
        el.chatAnswer.textContent = summary;
        addHistory(`Resumo de ${fileName}\n\n${summary}`, 'chat', finalText, { source: 'audio_summary', fileName, filePath });
        log('[llm] Resumo automático da call gerado.');
      }
    }
    el.localCallRecordingStatus.textContent = filePath
      ? `Gravação finalizada e salva em: ${filePath}`
      : 'Gravação finalizada e transcrita (sem arquivo local no modo navegador).';
  } catch (err) {
    if (err?.name === 'AbortError') {
      log('[proc] Transcrição da call cancelada.');
    } else {
      log(`[error] ${err.message}`);
    }
    el.localCallRecordingStatus.textContent = 'Falha ao processar gravação local. Veja o Status Log.';
  } finally {
    if (state.localCallStream) {
      state.localCallStream.getTracks().forEach((track) => track.stop());
      state.localCallStream = null;
    }
    state.localCallRecorder = null;
    state.localCallChunks = [];
    state.localCallMimeType = '';
    state.localCallExt = 'webm';
    state.isLocalCallRecording = false;
    state.isProcessing = false;
    state.abortController = null;
    el.assistState.textContent = strings.waiting;
    refreshControls();
  }
}

async function persistLocalCallRecording(blob, ext) {
  if (!isTauriRuntime) return '';
  const defaultBaseDir = await join(await documentDir(), HISTORY_SUBDIR);
  const baseDir = state.config.autoImportCallsDir?.trim() || state.historyDirResolved || state.config.historyDir || defaultBaseDir;
  const recordingsDir = await join(baseDir, 'call-recordings');
  await mkdir(recordingsDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeExt = (ext || 'webm').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'webm';
  const filePath = await join(recordingsDir, `call-${stamp}.${safeExt}`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await writeFile(filePath, bytes);
  return filePath;
}

function isSupportedAudioFile(filePath = '') {
  return /\.(mp3|wav|m4a|mp4|ogg|opus|webm)$/i.test(filePath);
}

function restartAutoImportMonitor() {
  if (state.autoImportTimer) {
    clearInterval(state.autoImportTimer);
    state.autoImportTimer = null;
  }
  if (!state.config.autoImportCallsEnabled) {
    log('[auto] Monitoramento automático desativado.');
    return;
  }
  if (!state.config.autoImportCallsDir) {
    log('[auto] Defina uma pasta para ativar o monitoramento automático.');
    return;
  }
  state.autoImportTimer = setInterval(() => {
    void scanAutoImportDirectory();
  }, 30000);
  log('[auto] Monitoramento automático ativado (30s).');
  void scanAutoImportDirectory();
}

async function scanAutoImportDirectory() {
  if (!state.config.autoImportCallsDir) {
    log('[auto] Nenhuma pasta configurada para automação.');
    return;
  }
  if (state.isRecording || state.isProcessing || state.isStartingRecording) {
    return;
  }
  try {
    const files = (await collectAudioFilesFromDirectory(state.config.autoImportCallsDir))
      .filter((path) => isSupportedAudioFile(path))
      .filter((path) => !state.autoImportSeen.has(path));

    if (!files.length) return;
    log(`[auto] ${files.length} novo(s) arquivo(s) detectado(s) para transcrever.`);
    for (const filePath of files) {
      if (state.isRecording || state.isProcessing || state.isStartingRecording) break;
      await processAudioFilePath(filePath, true);
    }
    persistConfig();
  } catch (err) {
    log(`[error] Falha ao varrer pasta monitorada: ${err.message}`);
  }
}

async function collectAudioFilesFromDirectory(dirPath) {
  const files = [];
  const entries = await readDir(dirPath);
  for (const entry of entries) {
    if (!entry?.name) continue;
    const childPath = await join(dirPath, entry.name);
    if (entry.isDirectory) {
      try {
        files.push(...await collectAudioFilesFromDirectory(childPath));
      } catch (err) {
        log(`[calls] Ignorando subpasta sem acesso: ${childPath} (${err.message})`);
      }
      continue;
    }
    if (entry.isFile && isSupportedAudioFile(childPath)) {
      files.push(childPath);
    }
  }
  return files;
}

async function processAudioFilePath(filePath, fromAutomation = false) {
  const sttKey = currentSttKey();
  if (!sttKey) {
    showNotice('Configure a STT API Key em Configurações para transcrever arquivo.');
    log('[error] Configure STT API Key para transcrever arquivo.');
    return;
  }

  const fileName = filePath.split('/').pop()?.split('\\').pop() || 'audio';
  const fileExt = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : 'mp3';
  el.selectedAudioFile.textContent = fileName;
  el.audioTranscriptOutput.value = '';
  el.audioSummaryOutput.textContent = 'Lendo arquivo de áudio...';

  const strings = UI_STRINGS[state.config.uiLanguage] || UI_STRINGS.pt;
  state.isProcessing = true;
  state.abortController = new AbortController();
  el.assistState.textContent = strings.processing;
  refreshControls();

  try {
    const bytes = await readFile(filePath);
    el.audioSummaryOutput.textContent = 'Arquivo carregado. Enviando para transcrição...';
    const mimeTypeByExt = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      m4a: 'audio/mp4',
      mp4: 'audio/mp4',
      ogg: 'audio/ogg',
      opus: 'audio/ogg',
      webm: 'audio/webm',
    };
    const blob = new Blob([bytes], { type: mimeTypeByExt[fileExt] || 'audio/mpeg' });
    state.recordingExt = fileExt;
    const rawText = await transcribe(blob, state.abortController.signal);
    if (!rawText) throw new Error('Transcrição vazia para o arquivo selecionado.');

    const finalText = rawText.trim();
    el.audioTranscriptOutput.value = 'Identificando interlocutores...';
    const displayTranscript = await diarizeTranscriptSemantically(finalText, state.abortController.signal);
    el.audioTranscriptOutput.value = displayTranscript || finalText;
    el.audioSummaryOutput.textContent = state.config.autoSummaryFromAudio
      ? 'Transcrição pronta. Gerando resumo...'
      : 'Transcrição pronta.';
    addHistory(displayTranscript || finalText, 'dictate', rawText, { source: fromAutomation ? 'auto_calls' : 'file_upload', fileName, filePath });
    log(`[stt] Arquivo "${fileName}" transcrito com sucesso.`);
    if (state.config.autoSummaryFromAudio) {
      try {
        const summary = await summarizeTranscript(finalText, state.abortController.signal);
        if (!summary) throw new Error('Resumo vazio.');
        el.audioSummaryOutput.textContent = summary;
        addHistory(`Resumo de ${fileName}\n\n${summary}`, 'chat', finalText, { source: 'audio_summary', fileName, filePath });
        log('[llm] Resumo automático da transcrição gerado.');
      } catch (summaryErr) {
        const fallbackSummary = summarizeTranscriptLocal(finalText);
        el.audioSummaryOutput.textContent = fallbackSummary;
        addHistory(`Resumo de ${fileName}\n\n${fallbackSummary}`, 'chat', finalText, {
          source: 'audio_summary',
          fileName,
          filePath,
          fallback: true,
        });
        log(`[llm] Resumo local gerado após falha da LLM: ${summaryErr.message}`);
      }
    }
    renderFileTranscriptHistory();
    state.autoImportSeen.add(filePath);
  } catch (err) {
    if (err?.name === 'AbortError') {
      log('[proc] Transcrição de arquivo cancelada.');
      el.audioSummaryOutput.textContent = 'Transcrição cancelada.';
    } else {
      log(`[error] ${err.message}`);
      el.audioSummaryOutput.textContent = `Erro: ${err.message}`;
      showNotice(`Erro ao transcrever arquivo: ${err.message}`, 'error');
    }
  } finally {
    state.isProcessing = false;
    state.abortController = null;
    state.recordingExt = 'webm';
    el.assistState.textContent = strings.waiting;
    refreshControls();
  }
}

async function summarizeTranscript(text, signal) {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';
  const prompt =
    'Resuma a transcrição em português, de forma objetiva, com:\n' +
    '1) contexto geral\n' +
    '2) pontos principais\n' +
    '3) decisões tomadas\n' +
    '4) próximos passos acionáveis\n' +
    '5) encerramento da ligação: diga claramente se a conversa terminou normalmente, se alguém desligou, se a ligação caiu ou se o áudio parece ter sido cortado antes do fim.\n\n' +
    `Transcrição:\n${trimmed}`;
  return await llmComplete(prompt, signal);
}

function summarizeTranscriptLocal(text) {
  const trimmed = (text || '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return 'Sem conteúdo suficiente para resumir.';
  const lower = trimmed.toLowerCase();
  const topics = [];
  if (lower.includes('ligação') || lower.includes('gravada')) topics.push('a ligação foi apresentada como gravada');
  if (lower.includes('validação') || lower.includes('validacao')) topics.push('foi solicitada uma validação de dados');
  if (lower.includes('nascimento')) topics.push('foi pedido o dia e mês de nascimento');
  if (lower.includes('cadastro')) topics.push('houve conferência de cadastro');
  const looksInterrupted = /preciso|pode me|confirma|confirmar|qual|quando|dia|m[eê]s|nascimento[?.]?$/.test(lower);
  const topicText = topics.length ? topics.join('; ') : 'a conversa teve caráter operacional e curto';
  return [
    '**Resumo da ligação:**',
    `A chamada tratou de ${topicText}.`,
    '',
    '**Resultado observado:**',
    'A pessoa atendente iniciou a conversa, informou o contexto e pediu confirmação de dados para continuidade do atendimento.',
    '',
    '**Encerramento:**',
    looksInterrupted
      ? 'A conversa parece incompleta: ela parou durante a etapa de validação, sem resposta final do cliente e sem fechamento natural da ligação.'
      : 'Não há sinais suficientes de fechamento formal da ligação na transcrição.',
    '',
    '**Observação:** resumo local gerado porque a LLM não retornou o resumo avançado neste momento.',
  ].join('\n');
}

function callAnalysisId(filePath) {
  return `${filePath}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function callGroupId() {
  return `group:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function callScriptId() {
  return `script:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function createEmptyCallScript(name = 'Novo script de comparação', body = '') {
  return {
    id: callScriptId(),
    name,
    body,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createEmptyCallGroup(name = 'Novo grupo de comparação') {
  return {
    id: callGroupId(),
    name,
    scriptId: '',
    sourceType: '',
    sourcePath: '',
    sourceLoadedAt: '',
    calls: [],
    summary: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeCallAnalysisItem(item) {
  const filePath = item?.filePath || item?.file_path || '';
  const fileName = item?.fileName || item?.file_name || filePath.split('/').pop()?.split('\\').pop() || 'audio';
  const rawTranscript = item?.rawTranscript || item?.raw_transcript || '';
  const speakerTranscript = item?.speakerTranscript || item?.speaker_transcript || '';
  const transcriptSummary = item?.transcriptSummary || item?.transcript_summary || '';
  const analysis = item?.analysis || '';
  const comparisonSummary = item?.comparisonSummary || item?.comparison_summary || '';
  const sentimentLabel = item?.sentimentLabel || item?.sentiment_label || '';
  const sentimentSummary = item?.sentimentSummary || item?.sentiment_summary || '';
  const sentimentPeople = item?.sentimentPeople || item?.sentiment_people || '';
  const scoreValue = item?.score ?? null;
  const score = scoreValue === null || scoreValue === '' ? null : Number(scoreValue);
  const transcribedAt = item?.transcribedAt || item?.transcribed_at || '';
  const analyzedAt = item?.analyzedAt || item?.analyzed_at || '';
  return {
    id: item?.id || callAnalysisId(filePath || fileName),
    filePath,
    fileName,
    status: item?.status || (analysis ? 'Analisada' : rawTranscript || speakerTranscript ? 'Transcrita' : 'Pendente'),
    rawTranscript,
    speakerTranscript,
    transcriptSummary,
    analysis,
    comparisonSummary,
    sentimentLabel,
    sentimentSummary,
    sentimentPeople,
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null,
    isGood: typeof item?.isGood === 'boolean' ? item.isGood : typeof item?.is_good === 'boolean' ? item.is_good : Number.isFinite(score) ? score >= 70 : null,
    error: item?.error || '',
    transcribedAt,
    analyzedAt,
    createdAt: item?.createdAt || item?.created_at || new Date().toISOString(),
    updatedAt: item?.updatedAt || item?.updated_at || item?.createdAt || item?.created_at || new Date().toISOString(),
  };
}

function normalizeCallComparisonScripts(scripts) {
  if (!Array.isArray(scripts)) return [];
  return scripts.map((script) => ({
    id: script.id || callScriptId(),
    name: script.name || 'Script sem nome',
    body: script.body || script.expected || '',
    createdAt: script.createdAt || new Date().toISOString(),
    updatedAt: script.updatedAt || new Date().toISOString(),
  }));
}

function normalizeCallComparisonGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups.map((group) => ({
    id: group.id || callGroupId(),
    name: group.name || 'Grupo sem nome',
    scriptId: group.scriptId || '',
    sourceType: group.sourceType || '',
    sourcePath: group.sourcePath || '',
    sourceLoadedAt: group.sourceLoadedAt || '',
    calls: Array.isArray(group.calls) ? group.calls.map(normalizeCallAnalysisItem) : [],
    summary: group.summary || '',
    createdAt: group.createdAt || new Date().toISOString(),
    updatedAt: group.updatedAt || new Date().toISOString(),
  }));
}

function loadCallComparisonScripts() {
  try {
    return normalizeCallComparisonScripts(JSON.parse(localStorage.getItem(CALL_COMPARISON_SCRIPTS_KEY) || '[]'));
  } catch {
    return [];
  }
}

function loadCallComparisonGroups() {
  try {
    return normalizeCallComparisonGroups(JSON.parse(localStorage.getItem(CALL_COMPARISON_GROUPS_KEY) || '[]'));
  } catch {
    return [];
  }
}

function persistCallComparisonScripts() {
  localStorage.setItem(CALL_COMPARISON_SCRIPTS_KEY, JSON.stringify(state.callComparisonScripts));
  markCallComparisonCloudSyncPending();
}

function persistCallComparisonGroups() {
  localStorage.setItem(CALL_COMPARISON_GROUPS_KEY, JSON.stringify(state.callComparisonGroups));
  markCallComparisonCloudSyncPending();
}

function markCallComparisonCloudSyncPending() {
  if (state.isCloudSyncingCallComparisons) return;
  if (isAuthenticated()) {
    markCloudSyncPending('analise de ligacoes');
  }
}

function currentCallComparisonScript() {
  return state.callComparisonScripts.find((script) => script.id === state.selectedCallScriptId) || null;
}

function currentCallComparisonGroup() {
  return state.callComparisonGroups.find((group) => group.id === state.selectedCallGroupId) || null;
}

function scriptForCurrentGroup() {
  const group = currentCallComparisonGroup();
  if (!group?.scriptId) return null;
  return state.callComparisonScripts.find((script) => script.id === group.scriptId) || null;
}

function syncCurrentCallGroupCalls() {
  const group = currentCallComparisonGroup();
  state.callAnalyses = group?.calls || [];
  if (state.selectedCallAnalysis != null && !state.callAnalyses[state.selectedCallAnalysis]) {
    state.selectedCallAnalysis = state.callAnalyses.length ? 0 : null;
  }
}

function initializeCallComparisonGroups() {
  state.callComparisonScripts = loadCallComparisonScripts();
  state.callComparisonGroups = loadCallComparisonGroups();
  if (!state.callComparisonGroups.length) {
    const legacyGroup = createEmptyCallGroup('Comparação inicial');
    legacyGroup.calls = state.callAnalyses || [];
    state.callComparisonGroups.push(legacyGroup);
  }
  migrateLegacyGroupScripts();
  if (!state.callComparisonScripts.length) {
    state.callComparisonScripts.push(createEmptyCallScript('Script inicial', ''));
  }
  state.selectedCallScriptId = state.callComparisonScripts[0]?.id || '';
  state.selectedCallGroupId = state.callComparisonGroups[0]?.id || '';
  syncCurrentCallGroupCalls();
  renderCallScriptList();
  renderCallGroupList();
  renderSelectedCallAnalysis();
}

function migrateLegacyGroupScripts() {
  let changed = false;
  state.callComparisonGroups.forEach((group) => {
    if (group.scriptId || (!group.expected && !group.scriptName)) return;
    const script = createEmptyCallScript(group.scriptName || `Script de ${group.name}`, group.expected || '');
    state.callComparisonScripts.push(script);
    group.scriptId = script.id;
    delete group.scriptName;
    delete group.expected;
    changed = true;
  });
  if (changed) {
    persistCallComparisonScripts();
    persistCallComparisonGroups();
  }
}

function setCallAnalysisSubtab(tabName) {
  const active = ['manage', 'analyze', 'results'].includes(tabName) ? tabName : 'manage';
  el.callSubtabs.forEach((btn) => btn.classList.toggle('active', btn.dataset.callTab === active));
  el.callManageView?.classList.toggle('active', active === 'manage');
  el.callAnalyzeView?.classList.toggle('active', active === 'analyze');
  el.callResultsView?.classList.toggle('active', active === 'results');
}

function renderCallScriptList() {
  el.callScriptList.innerHTML = '';
  el.callScriptCount.textContent = `${state.callComparisonScripts.length} ${state.callComparisonScripts.length === 1 ? 'script' : 'scripts'}`;
  state.callComparisonScripts.forEach((script) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `call-analysis-item${script.id === state.selectedCallScriptId ? ' selected' : ''}`;
    row.innerHTML = `
      <span class="call-analysis-file">${escapeHtml(script.name)}</span>
      <span class="call-analysis-status">${escapeHtml((script.body || '').slice(0, 90))}${script.body?.length > 90 ? '...' : ''}</span>
    `;
    row.addEventListener('click', () => selectCallComparisonScript(script.id));
    el.callScriptList.appendChild(row);
  });
  const script = currentCallComparisonScript();
  el.callScriptName.value = script?.name || '';
  el.callExpectedPrompt.value = script?.body || '';
  renderGroupScriptSelect();
}

function renderCallGroupList() {
  el.callGroupList.innerHTML = '';
  state.callComparisonGroups.forEach((group) => {
    const script = group.scriptId ? state.callComparisonScripts.find((item) => item.id === group.scriptId) : null;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `call-analysis-item${group.id === state.selectedCallGroupId ? ' selected' : ''}${script ? ' associated' : ''}`;
    row.innerHTML = `
      <span class="call-analysis-file">${escapeHtml(group.name)}</span>
      <span class="call-analysis-status">${group.calls?.length || 0} ligações${script ? ` • Script: ${escapeHtml(script.name)}` : ' • Sem script'}${group.sourcePath ? ` • ${escapeHtml(sourceSummaryForGroup(group))}` : ''}</span>
    `;
    row.addEventListener('click', () => selectCallComparisonGroup(group.id));
    el.callGroupList.appendChild(row);
  });
  const group = currentCallComparisonGroup();
  el.callGroupName.value = group?.name || '';
  syncCurrentCallGroupCalls();
  renderGroupScriptSelect();
  renderCallAnalysisList();
}

function sourceSummaryForGroup(group) {
  if (!group?.sourcePath) return 'Sem pasta';
  if (group.sourceType === 'folder') return `Pasta: ${shortPath(group.sourcePath)}`;
  return group.sourcePath;
}

function shortPath(path) {
  if (!path) return '';
  const parts = String(path).split('/').filter(Boolean);
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join('/')}`;
}

function setCurrentCallGroupSource(sourceType, sourcePath) {
  const group = currentCallComparisonGroup();
  if (!group) return;
  group.sourceType = sourceType;
  group.sourcePath = sourcePath;
  group.sourceLoadedAt = new Date().toISOString();
  group.updatedAt = group.sourceLoadedAt;
  persistCallComparisonGroups();
  renderCallGroupSource();
  renderCallGroupList();
}

function renderCallGroupSource() {
  const group = currentCallComparisonGroup();
  const hasFolder = group?.sourceType === 'folder' && group?.sourcePath;
  if (el.callGroupSourceLabel) {
    if (hasFolder) {
      el.callGroupSourceLabel.textContent = `Pasta ativa: ${group.sourcePath}`;
    } else if (group?.sourcePath) {
      el.callGroupSourceLabel.textContent = `Origem ativa: ${group.sourcePath}`;
    } else {
      el.callGroupSourceLabel.textContent = 'Nenhuma pasta carregada neste grupo.';
    }
    el.callGroupSourceLabel.classList.toggle('active', Boolean(group?.sourcePath));
  }
  el.addCallAnalysisFolderBtn?.classList.toggle('source-active', Boolean(hasFolder));
}

function renderGroupScriptSelect() {
  el.callGroupScriptSelect.innerHTML = '<option value="">Associar script ao grupo...</option>';
  state.callComparisonScripts.forEach((script) => {
    const option = document.createElement('option');
    option.value = script.id;
    option.textContent = script.name;
    el.callGroupScriptSelect.appendChild(option);
  });
  const group = currentCallComparisonGroup();
  el.callGroupScriptSelect.value = group?.scriptId || '';
  const script = scriptForCurrentGroup();
  el.callGroupAssociationStatus.textContent = script ? `Associado: ${script.name}` : 'Sem script associado';
  el.callGroupAssociationStatus.classList.toggle('associated', Boolean(script));
  el.callGroupSummaryOutput && (el.callGroupSummaryOutput.textContent = group?.summary || 'Nenhuma análise em lote ainda.');
  renderCallGroupDashboard();
  renderCallGroupSource();
  renderCallResultsList();
}

function selectCallComparisonGroup(groupId) {
  saveCurrentCallComparisonGroup({ silent: true });
  state.selectedCallGroupId = groupId;
  state.selectedCallAnalysis = null;
  state.selectedCallAnalysisIds.clear();
  syncCurrentCallGroupCalls();
  renderCallGroupList();
  setCallAnalysisSubtab('analyze');
}

function selectCallComparisonScript(scriptId) {
  state.selectedCallScriptId = scriptId;
  renderCallScriptList();
}

function createNewCallScriptDraft() {
  state.selectedCallScriptId = '';
  el.callScriptName.value = '';
  el.callExpectedPrompt.value = '';
  renderCallScriptList();
  el.callScriptName.focus();
  log('[calls] Novo script em edição.');
}

function createCallComparisonGroup() {
  saveCurrentCallComparisonGroup({ silent: true });
  const name = window.prompt('Nome do grupo de ligações:', 'Novo grupo de ligações');
  if (!name) return;
  const group = createEmptyCallGroup(name.trim());
  state.callComparisonGroups.unshift(group);
  state.selectedCallGroupId = group.id;
  state.selectedCallAnalysis = null;
  state.selectedCallAnalysisIds.clear();
  persistCallComparisonGroups();
  renderCallGroupList();
  log(`[calls] Grupo criado: ${group.name}.`);
}

function saveCurrentCallComparisonGroup(options = {}) {
  const group = currentCallComparisonGroup();
  if (!group) return;
  group.name = el.callGroupName.value.trim() || group.name || 'Grupo sem nome';
  group.calls = state.callAnalyses;
  group.updatedAt = new Date().toISOString();
  persistCallComparisonGroups();
  renderCallGroupList();
  if (!options.silent) log(`[calls] Grupo salvo: ${group.name}.`);
}

function saveCurrentCallScript() {
  const name = el.callScriptName.value.trim();
  const body = el.callExpectedPrompt.value.trim();
  if (!name || !body) {
    log('[calls] Informe nome e conteúdo do script antes de salvar.');
    return;
  }
  let script = currentCallComparisonScript();
  if (!script || !state.callComparisonScripts.some((item) => item.id === script.id)) {
    script = createEmptyCallScript(name, body);
    state.callComparisonScripts.unshift(script);
    state.selectedCallScriptId = script.id;
  } else {
    script.name = name;
    script.body = body;
    script.updatedAt = new Date().toISOString();
  }
  persistCallComparisonScripts();
  renderCallScriptList();
  renderCallGroupList();
  log(`[calls] Script salvo: ${script.name}.`);
}

function deleteCurrentCallScript() {
  const script = currentCallComparisonScript();
  if (!script) return;
  const linkedGroups = state.callComparisonGroups.filter((group) => group.scriptId === script.id);
  const hasUntranscribed = linkedGroups.some((group) => (group.calls || []).some((call) => !call.rawTranscript));
  if (hasUntranscribed) {
    showNotice('Não é possível excluir este script: existe grupo associado com ligações ainda não transcritas.', 'error');
    log('[calls] Exclusão bloqueada: script possui ligações associadas não transcritas.');
    return;
  }
  state.callComparisonScripts = state.callComparisonScripts.filter((item) => item.id !== script.id);
  state.callComparisonGroups.forEach((group) => {
    if (group.scriptId === script.id) group.scriptId = '';
  });
  if (!state.callComparisonScripts.length) {
    state.callComparisonScripts.push(createEmptyCallScript('Script inicial', ''));
  }
  state.selectedCallScriptId = state.callComparisonScripts[0]?.id || '';
  persistCallComparisonScripts();
  persistCallComparisonGroups();
  renderCallScriptList();
  renderCallGroupList();
  log(`[calls] Script excluído: ${script.name}.`);
}

function associateCurrentGroupToScript(scriptId) {
  const group = currentCallComparisonGroup();
  if (!group) return;
  group.scriptId = scriptId || '';
  group.updatedAt = new Date().toISOString();
  persistCallComparisonGroups();
  renderCallGroupList();
  log(scriptId ? '[calls] Script associado ao grupo.' : '[calls] Script desassociado do grupo.');
}

function deleteCurrentCallComparisonGroup() {
  const group = currentCallComparisonGroup();
  if (!group) return;
  if (state.callComparisonGroups.length === 1) {
    state.callComparisonGroups = [createEmptyCallGroup('Comparação inicial')];
  } else {
    state.callComparisonGroups = state.callComparisonGroups.filter((item) => item.id !== group.id);
  }
  state.selectedCallGroupId = state.callComparisonGroups[0]?.id || '';
  state.selectedCallAnalysis = null;
  state.selectedCallAnalysisIds.clear();
  persistCallComparisonGroups();
  renderCallGroupList();
  log(`[calls] Grupo excluído: ${group.name}.`);
}

function selectedCallAnalysisItem() {
  if (state.selectedCallAnalysis == null) return null;
  return state.callAnalyses[state.selectedCallAnalysis] || null;
}

function selectedCallAnalysisItems() {
  const selected = state.callAnalyses.filter((item) => state.selectedCallAnalysisIds.has(item.id));
  return selected.length ? selected : selectedCallAnalysisItem() ? [selectedCallAnalysisItem()] : [];
}

function renderCallAnalysisList() {
  syncCurrentCallGroupCalls();
  el.callAnalysisList.innerHTML = '';
  el.callAnalysisCount.textContent = `${state.callAnalyses.length} ${state.callAnalyses.length === 1 ? 'item' : 'itens'}`;
  el.callAnalysisList.classList.toggle('as-table', true);

  const header = document.createElement('div');
  header.className = 'call-table-row call-table-header';
  header.innerHTML = `
    <span></span>
    <span>Ligação</span>
    <span>Transcrição</span>
    <span>Resumo</span>
    <span>Comparação</span>
    <span>Sentimento</span>
    <span>Nota</span>
    <span>Ações</span>
  `;
  el.callAnalysisList.appendChild(header);

  state.callAnalyses.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = `call-analysis-item call-table-row${index === state.selectedCallAnalysis ? ' selected' : ''}${item.analysis ? ' analyzed' : ''}`;
    row.innerHTML = `
      <label class="call-analysis-check table-check">
        <input type="checkbox" ${state.selectedCallAnalysisIds.has(item.id) ? 'checked' : ''} />
      </label>
      <span class="call-analysis-file">${escapeHtml(item.fileName)}</span>
      <span>${callStatusBadge(item)}</span>
      <span class="call-analysis-status">${escapeHtml(item.transcriptSummary || transcriptPreview(item))}</span>
      <span class="call-analysis-status">${escapeHtml(item.comparisonSummary || item.analysis || 'Ainda sem comparação.')}</span>
      <span class="call-analysis-status">${escapeHtml(item.sentimentSummary || item.sentimentLabel || 'Sem sentimento.')}</span>
      <span>${scoreBadge(item)}</span>
      <span class="call-row-actions">
        <button type="button" class="btn ghost small call-play-btn" title="Ouvir gravação">▶</button>
        <button type="button" class="btn ghost small call-delete-btn">Excluir</button>
      </span>
    `;
    row.querySelector('.call-analysis-check input').addEventListener('change', (ev) => {
      if (ev.target.checked) state.selectedCallAnalysisIds.add(item.id);
      else state.selectedCallAnalysisIds.delete(item.id);
      renderCallAnalysisList();
    });
    row.querySelector('.call-play-btn').addEventListener('click', async (ev) => {
      ev.stopPropagation();
      state.selectedCallAnalysis = index;
      renderCallAnalysisList();
      renderSelectedCallAnalysis();
      await playCallAudio(item);
    });
    row.querySelector('.call-delete-btn').addEventListener('click', (ev) => {
      ev.stopPropagation();
      deleteCallAnalysisItem(item.id);
    });
    row.addEventListener('dblclick', async (ev) => {
      if (ev.target.closest('input,button')) return;
      await playCallAudio(item);
    });
    row.addEventListener('click', (ev) => {
      if (ev.target.closest('input,button')) return;
      state.selectedCallAnalysis = index;
      renderCallAnalysisList();
      renderSelectedCallAnalysis();
    });
    el.callAnalysisList.appendChild(row);
  });

  renderSelectedCallAnalysis();
}

function callStatusBadge(item) {
  const isTranscribed = Boolean(item.rawTranscript || item.speakerTranscript);
  const label = item.error ? 'Erro' : isTranscribed ? 'Transcrita' : 'Pendente';
  const klass = item.error ? 'bad' : isTranscribed ? 'good' : 'neutral';
  const errorHint = item.error ? `<br><small class="call-error-hint" title="${escapeHtml(item.error)}">${escapeHtml(item.error.length > 60 ? item.error.slice(0, 60) + '…' : item.error)}</small>` : '';
  return `<span class="mini-badge ${klass}">${label}</span>${errorHint}`;
}

function scoreBadge(item) {
  if (item.score == null) return '<span class="mini-badge neutral">Sem nota</span>';
  const klass = item.score >= 70 ? 'good' : 'bad';
  const label = item.score >= 70 ? 'Boa' : 'Ruim';
  return `<span class="mini-badge ${klass}">${item.score} • ${label}</span>`;
}

function transcriptPreview(item) {
  const text = item.speakerTranscript || item.rawTranscript || '';
  if (!text) return 'Ainda não transcrita.';
  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}

function renderSelectedCallAnalysis() {
  const item = selectedCallAnalysisItem();
  if (!item) {
    el.selectedCallStatus.textContent = 'Nenhuma ligação selecionada';
    el.callTranscriptOutput.textContent = 'A transcrição aparecerá aqui.';
    el.callAnalysisOutput.textContent = 'A análise aparecerá aqui.';
    if (el.callAudioPlayer) el.callAudioPlayer.style.display = 'none';
    return;
  }

  el.selectedCallStatus.textContent = `${item.status}${item.score != null ? ` • Nota ${item.score}` : ''}${item.sentimentLabel ? ` • Sentimento ${item.sentimentLabel}` : ''}${item.error ? ` • Erro: ${item.error}` : ''}`;
  el.callTranscriptOutput.textContent = item.speakerTranscript || item.rawTranscript || (item.error ? `Falha na transcrição:\n${item.error}` : 'Ainda sem transcrição.');
  el.callAnalysisOutput.textContent = item.analysis || 'A análise aparecerá aqui.';
}

function upsertCallAnalysisFiles(filePaths) {
  const existing = new Set(state.callAnalyses.map((item) => item.filePath));
  let added = 0;
  let skipped = 0;
  filePaths
    .filter((filePath) => {
      const shouldAdd = isSupportedAudioFile(filePath) && !existing.has(filePath);
      if (!shouldAdd) skipped += 1;
      return shouldAdd;
    })
    .forEach((filePath) => {
      const fileName = filePath.split('/').pop()?.split('\\').pop() || 'audio';
      state.callAnalyses.push({
        id: callAnalysisId(filePath),
        filePath,
        fileName,
        status: 'Pendente',
        rawTranscript: '',
        speakerTranscript: '',
        transcriptSummary: '',
        analysis: '',
        comparisonSummary: '',
        sentimentLabel: '',
        sentimentSummary: '',
        sentimentPeople: '',
        score: null,
        isGood: null,
        error: '',
        transcribedAt: '',
        analyzedAt: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      existing.add(filePath);
      added += 1;
    });

  if (state.selectedCallAnalysis == null && state.callAnalyses.length) {
    state.selectedCallAnalysis = 0;
  }
  saveCurrentCallComparisonGroup({ silent: true });
  renderCallAnalysisList();
  return { added, skipped };
}

function deleteCallAnalysisItem(itemId) {
  const index = state.callAnalyses.findIndex((item) => item.id === itemId);
  if (index < 0) return;
  const [removed] = state.callAnalyses.splice(index, 1);
  state.selectedCallAnalysisIds.delete(itemId);
  if (state.selectedCallAnalysis === index) state.selectedCallAnalysis = state.callAnalyses.length ? 0 : null;
  if (state.selectedCallAnalysis != null && state.selectedCallAnalysis > index) state.selectedCallAnalysis -= 1;
  saveCurrentCallComparisonGroup({ silent: true });
  renderCallAnalysisList();
  log(`[calls] Ligação excluída: ${removed.fileName}.`);
}

function selectAllCallAnalyses() {
  const allSelected = state.callAnalyses.length > 0 && state.callAnalyses.every((item) => state.selectedCallAnalysisIds.has(item.id));
  state.selectedCallAnalysisIds.clear();
  if (!allSelected) state.callAnalyses.forEach((item) => state.selectedCallAnalysisIds.add(item.id));
  renderCallAnalysisList();
}

function deleteSelectedCallAnalyses() {
  if (!state.selectedCallAnalysisIds.size) {
    log('[calls] Nenhuma ligação selecionada para excluir.');
    return;
  }
  const before = state.callAnalyses.length;
  state.callAnalyses = state.callAnalyses.filter((item) => !state.selectedCallAnalysisIds.has(item.id));
  const removed = before - state.callAnalyses.length;
  const group = currentCallComparisonGroup();
  if (group) group.calls = state.callAnalyses;
  state.selectedCallAnalysisIds.clear();
  state.selectedCallAnalysis = state.callAnalyses.length ? 0 : null;
  saveCurrentCallComparisonGroup({ silent: true });
  renderCallAnalysisList();
  log(`[calls] ${removed} ligação(ões) excluída(s).`);
}

async function addCallAnalysisFile() {
  const selected = await openDialog({
    multiple: true,
    directory: false,
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'mp4', 'ogg', 'opus', 'webm'] }],
  });
  if (!selected) return;
  const files = Array.isArray(selected) ? selected : [selected];
  setCurrentCallGroupSource('files', `${files.length} arquivo(s) selecionado(s) manualmente`);
  const result = upsertCallAnalysisFiles(files);
  log(`[calls] Arquivos carregados: ${result.added} novo(s), ${result.skipped} ignorado(s).`);
}

async function addCallAnalysisFolder() {
  const selected = await openDialog({ multiple: false, directory: true });
  if (!selected || typeof selected !== 'string') return;
  try {
    setCurrentCallGroupSource('folder', selected);
    const files = await collectAudioFilesFromDirectory(selected);
    const result = upsertCallAnalysisFiles(files);
    if (!files.length) {
      showNotice('Pasta salva no grupo, mas nenhuma gravação suportada foi encontrada.', 'error');
    }
    log(`[calls] Pasta ativa: ${selected}. ${files.length} gravação(ões) encontrada(s), ${result.added} nova(s), ${result.skipped} ignorada(s).`);
  } catch (err) {
    showNotice(`Falha ao carregar pasta: ${err.message}`, 'error');
    log(`[error] Falha ao carregar pasta de ligações: ${err.message}`);
  }
}

async function transcribeSelectedCallAnalysis() {
  const items = selectedCallAnalysisItems().filter((item) => !item.rawTranscript || item.error);
  if (!items.length) {
    const selected = selectedCallAnalysisItems();
    if (selected.length && scriptForCurrentGroup()) {
      await runCallComparisonForItems(selected);
      return;
    }
    log('[calls] Selecione uma ou mais ligações pendentes para transcrever.');
    return;
  }
  for (const item of items) {
    await transcribeCallAnalysisItem(item);
  }
  if (scriptForCurrentGroup()) {
    await runCallComparisonForItems(selectedCallAnalysisItems());
  }
  renderCallAnalysisList();
}

async function transcribeAllCallAnalyses() {
  const pending = state.callAnalyses.filter((item) => !item.rawTranscript || item.error);
  if (!pending.length) {
    log('[calls] Nenhuma ligação pendente para transcrever.');
    return;
  }
  for (const item of pending) {
    await transcribeCallAnalysisItem(item);
    renderCallAnalysisList();
  }
  if (scriptForCurrentGroup()) {
    await runCallComparisonForItems(state.callAnalyses);
  }
}

async function transcribeCallAnalysisItem(item) {
  if (!currentSttKey()) {
    showNotice('Configure a STT API Key em Configurações para analisar ligações.', 'error');
    log('[error] Configure STT API Key para analisar ligações.');
    return;
  }
  if (state.isProcessing) {
    log('[calls] Aguarde o processamento atual finalizar.');
    return;
  }

  const strings = UI_STRINGS[state.config.uiLanguage] || UI_STRINGS.pt;
  state.isProcessing = true;
  state.abortController = new AbortController();
  item.status = 'Transcrevendo';
  item.error = '';
  item.rawTranscript = '';
  item.speakerTranscript = '';
  item.transcriptSummary = '';
  el.assistState.textContent = strings.processing;
  renderCallAnalysisList();
  refreshControls();

  try {
    const fileExt = item.fileName.includes('.') ? item.fileName.split('.').pop().toLowerCase() : 'mp3';
    const bytes = await readFile(item.filePath);
    const mimeTypeByExt = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      m4a: 'audio/mp4',
      mp4: 'audio/mp4',
      ogg: 'audio/ogg',
      opus: 'audio/ogg',
      webm: 'audio/webm',
    };
    const blob = new Blob([bytes], { type: mimeTypeByExt[fileExt] || 'audio/mpeg' });
    const MAX_STT_BYTES = 25 * 1024 * 1024; // 25 MB — limite da API Whisper/OpenAI
    if (blob.size > MAX_STT_BYTES) {
      throw new Error(`Arquivo muito grande (${(blob.size / 1024 / 1024).toFixed(1)} MB). O limite da API é 25 MB. Comprima o áudio ou corte em partes menores.`);
    }
    state.recordingExt = fileExt;
    item.rawTranscript = await transcribe(blob, state.abortController.signal);
    if (!item.rawTranscript) throw new Error('Transcrição vazia para a ligação.');

    item.status = 'Separando interlocutores';
    renderCallAnalysisList();
    item.speakerTranscript = await diarizeTranscriptSemantically(item.rawTranscript, state.abortController.signal);
    item.transcriptSummary = await summarizeCallTranscript(item.speakerTranscript || item.rawTranscript, state.abortController.signal);
    item.status = 'Transcrita';
    item.transcribedAt = new Date().toISOString();
    item.updatedAt = item.transcribedAt;
    addHistory(item.speakerTranscript || item.rawTranscript, 'dictate', item.rawTranscript, {
      source: 'call_analysis',
      fileName: item.fileName,
      filePath: item.filePath,
    });
    saveCurrentCallComparisonGroup({ silent: true });
    log(`[calls] Ligação "${item.fileName}" transcrita para análise.`);
  } catch (err) {
    item.status = 'Erro';
    item.error = err.message;
    log(`[error] Falha na análise da ligação ${item.fileName}: ${err.message}`);
  } finally {
    state.isProcessing = false;
    state.abortController = null;
    state.recordingExt = 'webm';
    el.assistState.textContent = strings.waiting;
    refreshControls();
    renderCallAnalysisList();
  }
}

async function diarizeTranscriptSemantically(transcript, signal) {
  const prompt =
    'Organize a transcrição abaixo como uma conversa entre interlocutores, inferindo pela semântica e alternância de fala quem é Pessoa A e Pessoa B.\n' +
    'Use exatamente o formato "Pessoa A:" e "Pessoa B:".\n' +
    'Se houver mais pessoas, use Pessoa C, Pessoa D.\n' +
    'Não invente informação que não esteja na conversa.\n\n' +
    `Transcrição bruta:\n${transcript}`;
  return await llmComplete(prompt, signal);
}

async function summarizeCallTranscript(transcript, signal) {
  const prompt =
    'Resuma a ligação em português em no máximo 2 frases. Informe também se a conversa parece ter sido concluída normalmente ou interrompida/desligada antes do fim.\n' +
    'Não invente dados que não estejam na transcrição.\n\n' +
    `Transcrição:\n${transcript}`;
  try {
    return await llmComplete(prompt, signal);
  } catch (err) {
    log(`[calls] Resumo da transcrição não gerado: ${err.message}`);
    return transcript.length > 180 ? `${transcript.slice(0, 180)}...` : transcript;
  }
}

async function runSelectedCallComparison() {
  saveCurrentCallComparisonGroup({ silent: true });
  const group = currentCallComparisonGroup();
  const items = group?.calls || [];
  if (!items.length) {
    log('[calls] Carregue ligações no grupo antes de comparar.');
    return;
  }
  const script = scriptForCurrentGroup();
  if (!script?.body?.trim()) {
    log('[calls] Associe um script de comparação ao grupo antes de comparar.');
    return;
  }
  await runCallComparisonForItems(items, script, group);
}

async function runCallComparisonForItems(items, script = scriptForCurrentGroup(), group = currentCallComparisonGroup()) {
  if (!script?.body?.trim()) {
    log('[calls] Associe um script de comparação ao grupo antes de comparar.');
    return;
  }
  const pending = items.filter(Boolean);
  for (const item of pending) {
    await runCallComparisonItem(item, script, group);
  }
  group.summary = buildCallGroupSummary(group);
  persistCallComparisonGroups();
  renderCallAnalysisList();
  renderCallResultsList();
  renderGroupScriptSelect();
  setCallAnalysisSubtab('results');
  if (isAuthenticated() && state.config.autoSyncCloud) {
    void syncCallComparisons();
  }
}

async function runCallComparisonItem(item, script, group) {
  if (!item.speakerTranscript && !item.rawTranscript) {
    await transcribeCallAnalysisItem(item);
  }
  const transcript = item.speakerTranscript || item.rawTranscript;
  if (!transcript) return;

  const strings = UI_STRINGS[state.config.uiLanguage] || UI_STRINGS.pt;
  state.isProcessing = true;
  state.abortController = new AbortController();
  item.status = 'Analisando';
  el.assistState.textContent = strings.processing;
  refreshControls();
  renderCallAnalysisList();

  try {
    const prompt =
      'Compare o que deveria ter acontecido em uma ligação com o que realmente aconteceu.\n' +
      'Responda APENAS em JSON válido, sem markdown, no formato:\n' +
      '{"resumo_ligacao":"...","resumo_comparacao":"...","sentimento_geral":"positivo|neutro|negativo|tenso|misto","resumo_sentimento":"...","sentimento_por_pessoa":[{"pessoa":"Pessoa A","sentimento":"...","evidencia":"..."},{"pessoa":"Pessoa B","sentimento":"...","evidencia":"..."}],"pontos_cumpridos":["..."],"pontos_faltantes":["..."],"divergencias":["..."],"evidencias":["..."],"finalizacao":"concluida|interrompida|indefinida","nota":0,"resultado":"boa|ruim","analise_detalhada":"..."}\n' +
      'A nota deve ser de 0 a 100. Considere boa somente nota >= 70.\n' +
      'No sentimento, avalie clima geral e cada interlocutor: estresse, cordialidade, confusão, tensão, irritação, cooperação e mudança de tom.\n' +
      'Se a ligação não chegou ao fechamento, confirmação final ou desligou/interrompeu antes de concluir, marque isso em finalizacao e nos pontos faltantes.\n\n' +
      `Grupo de comparação: ${group?.name || 'Sem nome'}\n` +
      `Script de referência: ${script?.name || 'Sem nome'}\n\n` +
      `Esperado:\n${script.body}\n\n` +
      `Conversa transcrita:\n${transcript}`;
    const llmAnswer = await llmComplete(prompt, state.abortController.signal);
    const structured = parseCallComparisonResult(llmAnswer);
    item.transcriptSummary = structured.resumo_ligacao || item.transcriptSummary || '';
    item.comparisonSummary = structured.resumo_comparacao || '';
    item.sentimentLabel = structured.sentimento_geral || '';
    item.sentimentSummary = structured.resumo_sentimento || '';
    item.sentimentPeople = formatSentimentPeople(structured.sentimento_por_pessoa);
    item.analysis = formatCallComparisonAnalysis(structured, llmAnswer);
    item.score = structured.nota ?? extractScore(item.analysis);
    item.isGood = item.score != null ? item.score >= 70 : structured.resultado === 'boa';
    item.status = 'Analisada';
    item.analyzedAt = new Date().toISOString();
    item.updatedAt = item.analyzedAt;
    el.callAnalysisOutput.textContent = item.analysis || 'Análise vazia.';
    addHistory(`Análise de ${item.fileName}\n\n${item.analysis}`, 'chat', transcript, {
      source: 'call_comparison',
      groupName: group?.name || '',
      scriptName: script?.name || '',
      score: item.score,
      fileName: item.fileName,
      filePath: item.filePath,
    });
    saveCurrentCallComparisonGroup({ silent: true });
    log(`[calls] Comparação gerada para "${item.fileName}".`);
  } catch (err) {
    item.status = 'Erro';
    item.error = err.message;
    log(`[error] Falha ao comparar ligação: ${err.message}`);
  } finally {
    state.isProcessing = false;
    state.abortController = null;
    el.assistState.textContent = strings.waiting;
    refreshControls();
    renderCallAnalysisList();
  }
}

function parseCallComparisonResult(text = '') {
  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(trimmed);
    const nota = Number(parsed.nota ?? parsed.score);
    return {
      resumo_ligacao: trimString(parsed.resumo_ligacao),
      resumo_comparacao: trimString(parsed.resumo_comparacao),
      pontos_cumpridos: Array.isArray(parsed.pontos_cumpridos) ? parsed.pontos_cumpridos.map(trimString).filter(Boolean) : [],
      pontos_faltantes: Array.isArray(parsed.pontos_faltantes) ? parsed.pontos_faltantes.map(trimString).filter(Boolean) : [],
      divergencias: Array.isArray(parsed.divergencias) ? parsed.divergencias.map(trimString).filter(Boolean) : [],
      evidencias: Array.isArray(parsed.evidencias) ? parsed.evidencias.map(trimString).filter(Boolean) : [],
      sentimento_geral: trimString(parsed.sentimento_geral).toLowerCase(),
      resumo_sentimento: trimString(parsed.resumo_sentimento),
      sentimento_por_pessoa: Array.isArray(parsed.sentimento_por_pessoa)
        ? parsed.sentimento_por_pessoa.map((item) => ({
          pessoa: trimString(item?.pessoa),
          sentimento: trimString(item?.sentimento),
          evidencia: trimString(item?.evidencia),
        })).filter((item) => item.pessoa || item.sentimento || item.evidencia)
        : [],
      finalizacao: trimString(parsed.finalizacao) || 'indefinida',
      nota: Number.isFinite(nota) ? Math.max(0, Math.min(100, nota)) : null,
      resultado: trimString(parsed.resultado).toLowerCase(),
      analise_detalhada: trimString(parsed.analise_detalhada),
    };
  } catch {
    const firstMeaningfulLine = text.split('\n').find((line) => line.trim() && !line.trim().startsWith('{') && !line.trim().startsWith('[')) || '';
    return {
      resumo_ligacao: '',
      resumo_comparacao: firstMeaningfulLine,
      pontos_cumpridos: [],
      pontos_faltantes: [],
      divergencias: [],
      evidencias: [],
      sentimento_geral: '',
      resumo_sentimento: '',
      sentimento_por_pessoa: [],
      finalizacao: /deslig|interromp|cortad/i.test(text) ? 'interrompida' : 'indefinida',
      nota: extractScore(text),
      resultado: '',
      analise_detalhada: '',
    };
  }
}

function formatCallComparisonAnalysis(result, fallbackText = '') {
  if (!result || (!result.resumo_comparacao && !result.analise_detalhada)) return fallbackText || 'Análise vazia.';
  const lines = [
    `Resumo da ligação: ${result.resumo_ligacao || 'Não informado.'}`,
    `Resumo da comparação: ${result.resumo_comparacao || 'Não informado.'}`,
    `Sentimento geral: ${result.sentimento_geral || 'Não informado.'}`,
    `Resumo do sentimento: ${result.resumo_sentimento || 'Não informado.'}`,
    `Nota: ${result.nota != null ? result.nota : 'sem nota'}${result.resultado ? ` (${result.resultado})` : ''}`,
    `Finalização: ${result.finalizacao || 'indefinida'}`,
    '',
    'Sentimento por interlocutor:',
    ...(result.sentimento_por_pessoa?.length
      ? result.sentimento_por_pessoa.map((item) => `- ${item.pessoa || 'Pessoa'}: ${item.sentimento || 'sem classificação'}${item.evidencia ? ` (${item.evidencia})` : ''}`)
      : ['- Nenhum sentimento por pessoa informado.']),
    '',
    'Pontos cumpridos:',
    ...(result.pontos_cumpridos.length ? result.pontos_cumpridos.map((item) => `- ${item}`) : ['- Nenhum ponto cumprido informado.']),
    '',
    'Pontos faltantes:',
    ...(result.pontos_faltantes.length ? result.pontos_faltantes.map((item) => `- ${item}`) : ['- Nenhum ponto faltante informado.']),
    '',
    'Divergências:',
    ...(result.divergencias.length ? result.divergencias.map((item) => `- ${item}`) : ['- Nenhuma divergência informada.']),
    '',
    'Evidências:',
    ...(result.evidencias.length ? result.evidencias.map((item) => `- ${item}`) : ['- Nenhuma evidência informada.']),
  ];
  if (result.analise_detalhada) {
    lines.push('', 'Detalhe:', result.analise_detalhada);
  }
  return lines.join('\n');
}

function formatSentimentPeople(items = []) {
  if (!Array.isArray(items) || !items.length) return '';
  return items
    .map((item) => {
      const person = item.pessoa || 'Pessoa';
      const sentiment = item.sentimento || 'sem classificação';
      const evidence = item.evidencia ? `: ${item.evidencia}` : '';
      return `${person} - ${sentiment}${evidence}`;
    })
    .join('\n');
}

function buildCallGroupSummary(group) {
  const analyzed = (group.calls || []).filter((item) => item.analysis);
  if (!analyzed.length) return 'Nenhuma ligação analisada ainda.';
  const scored = analyzed.filter((item) => item.score != null);
  const avg = scored.length
    ? Math.round(scored.reduce((sum, item) => sum + Number(item.score || 0), 0) / scored.length)
    : null;
  const good = scored.filter((item) => Number(item.score) >= 70).length;
  const bad = scored.filter((item) => Number(item.score) < 70).length;
  const worst = scored.slice().sort((a, b) => Number(a.score || 0) - Number(b.score || 0))[0];
  const best = scored.slice().sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
  const sentimentCounts = analyzed.reduce((acc, item) => {
    const label = item.sentimentLabel || 'sem sentimento';
    acc.set(label, (acc.get(label) || 0) + 1);
    return acc;
  }, new Map());
  const sentimentSummary = [...sentimentCounts.entries()]
    .map(([label, count]) => `${label}: ${count}`)
    .join(', ');
  return [
    `${group.calls?.length || 0} ligação(ões) no grupo. ${analyzed.length} analisada(s).`,
    avg != null ? `Nota média: ${avg}.` : 'Sem notas estruturadas extraídas.',
    scored.length ? `Boas: ${good}. Ruins: ${bad}.` : '',
    sentimentSummary ? `Sentimento: ${sentimentSummary}.` : '',
    best ? `Melhor aderência: ${best.fileName} (${best.score}).` : '',
    worst ? `Pior aderência: ${worst.fileName} (${worst.score}).` : '',
  ].filter(Boolean).join(' ');
}

let _currentAudioUrl = null;

async function playCallAudio(item) {
  try {
    if (el.callAudioPlayer.dataset.filePath === item.filePath && !el.callAudioPlayer.paused) {
      el.callAudioPlayer.pause();
      return;
    }
    if (_currentAudioUrl) {
      URL.revokeObjectURL(_currentAudioUrl);
      _currentAudioUrl = null;
    }
    const fileExt = item.fileName.includes('.') ? item.fileName.split('.').pop().toLowerCase() : 'mp3';
    const mimeTypeByExt = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm' };
    const bytes = await readFile(item.filePath);
    const blob = new Blob([bytes], { type: mimeTypeByExt[fileExt] || 'audio/mpeg' });
    _currentAudioUrl = URL.createObjectURL(blob);
    el.callAudioPlayer.src = _currentAudioUrl;
    el.callAudioPlayer.dataset.filePath = item.filePath;
    el.callAudioPlayer.style.display = 'block';
    el.callAudioPlayer.play();
  } catch (err) {
    log(`[error] Falha ao reproduzir áudio: ${err.message}`);
  }
}

function renderCallGroupDashboard() {
  const dash = el.callGroupDashboard;
  if (!dash) return;
  const group = currentCallComparisonGroup();
  const calls = group?.calls || [];
  const total = calls.length;
  const analyzed = calls.filter((c) => c.analysis || c.score != null);
  const scored = analyzed.filter((c) => c.score != null);
  const good = scored.filter((c) => Number(c.score) >= 70);
  const bad = scored.filter((c) => Number(c.score) < 70);
  const avg = scored.length ? Math.round(scored.reduce((s, c) => s + Number(c.score), 0) / scored.length) : null;
  const best = scored.length ? scored.reduce((a, b) => Number(a.score) >= Number(b.score) ? a : b) : null;
  const worst = scored.length ? scored.reduce((a, b) => Number(a.score) <= Number(b.score) ? a : b) : null;

  const sentimentMap = new Map();
  analyzed.forEach((c) => {
    const s = c.sentimentLabel || 'indefinido';
    sentimentMap.set(s, (sentimentMap.get(s) || 0) + 1);
  });
  const sentimentRows = [...sentimentMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `<span class="dash-sentiment-chip">${escapeHtml(label)}: <strong>${count}</strong></span>`)
    .join('');

  const pendingCount = calls.filter((c) => !c.rawTranscript && !c.error).length;
  const errorCount = calls.filter((c) => c.error).length;
  const transcribedCount = calls.filter((c) => c.rawTranscript || c.speakerTranscript).length;

  if (!total) {
    dash.innerHTML = '<p class="muted" style="padding:8px 0">Nenhuma ligação carregada ainda.</p>';
    return;
  }

  const avgColor = avg == null ? 'neutral' : avg >= 70 ? 'good' : avg >= 50 ? 'warn' : 'bad';

  dash.innerHTML = `
    <div class="dash-kpis">
      <div class="dash-kpi">
        <span class="dash-kpi-value">${total}</span>
        <span class="dash-kpi-label">Total de ligações</span>
      </div>
      <div class="dash-kpi">
        <span class="dash-kpi-value">${transcribedCount}</span>
        <span class="dash-kpi-label">Transcritas</span>
      </div>
      <div class="dash-kpi">
        <span class="dash-kpi-value">${analyzed.length}</span>
        <span class="dash-kpi-label">Analisadas</span>
      </div>
      <div class="dash-kpi ${avgColor}">
        <span class="dash-kpi-value">${avg != null ? avg : '—'}</span>
        <span class="dash-kpi-label">Nota média</span>
      </div>
      <div class="dash-kpi good">
        <span class="dash-kpi-value">${good.length}</span>
        <span class="dash-kpi-label">Boas (≥ 70)</span>
      </div>
      <div class="dash-kpi bad">
        <span class="dash-kpi-value">${bad.length}</span>
        <span class="dash-kpi-label">Ruins (< 70)</span>
      </div>
      ${pendingCount ? `<div class="dash-kpi neutral"><span class="dash-kpi-value">${pendingCount}</span><span class="dash-kpi-label">Pendentes</span></div>` : ''}
      ${errorCount ? `<div class="dash-kpi bad"><span class="dash-kpi-value">${errorCount}</span><span class="dash-kpi-label">Com erro</span></div>` : ''}
    </div>
    ${scored.length ? `
    <div class="dash-highlights">
      ${best ? `<div class="dash-highlight good">🏆 Melhor: <strong>${escapeHtml(best.fileName)}</strong> — Nota ${best.score}</div>` : ''}
      ${worst && worst.id !== best?.id ? `<div class="dash-highlight bad">⚠️ Pior: <strong>${escapeHtml(worst.fileName)}</strong> — Nota ${worst.score}</div>` : ''}
    </div>` : ''}
    ${sentimentRows ? `<div class="dash-sentiments">${sentimentRows}</div>` : ''}
  `;
}

function safeResultPreview(item) {
  const looksLikeRawJson = (s) => !s || /^\s*[{[]/.test(s.trim());
  const summary = looksLikeRawJson(item.comparisonSummary) ? '' : item.comparisonSummary;
  const transcript = looksLikeRawJson(item.transcriptSummary) ? '' : item.transcriptSummary;
  return summary || transcript || 'Clique para ver análise.';
}

function renderCallResultsList() {
  renderCallGroupDashboard();
  if (!el.callResultsList) return;
  const group = currentCallComparisonGroup();
  const calls = group?.calls || [];
  el.callResultsList.innerHTML = '';
  const analyzed = calls.filter((item) => item.analysis || item.score != null);
  if (!analyzed.length) {
    el.callResultsList.textContent = 'Nenhum resultado gerado ainda.';
    return;
  }
  analyzed.forEach((item) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'call-result-item';
    row.innerHTML = `
      <strong>${escapeHtml(item.fileName)}</strong>
      <span>${item.score != null ? `Nota ${item.score}` : 'Sem nota'} • ${item.score != null && item.score >= 70 ? 'Boa' : item.score != null ? 'Ruim' : 'Sem classificação'} • Sentimento: ${escapeHtml(item.sentimentLabel || 'sem sentimento')} • ${escapeHtml(item.status)}</span>
      <span>${escapeHtml(safeResultPreview(item))}</span>
    `;
    row.addEventListener('click', () => {
      const idx = state.callAnalyses.findIndex((call) => call.id === item.id);
      if (idx >= 0) {
        state.selectedCallAnalysis = idx;
        renderCallAnalysisList();
      }
    });
    el.callResultsList.appendChild(row);
  });
}

function extractScore(text = '') {
  const explicit = text.match(/score[^0-9]{0,20}(\d{1,3})/i) || text.match(/nota[^0-9]{0,20}(\d{1,3})/i);
  if (!explicit) return null;
  const score = Number(explicit[1]);
  if (!Number.isFinite(score)) return null;
  return Math.max(0, Math.min(100, score));
}

function mimeToExt(mime) {
  if (!mime) return 'webm';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('opus')) return 'opus';
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

function setWorkspaceView(view) {
  const isMain = view === 'main';
  el.workflowPanel.classList.toggle('hidden', isMain);
  el.dockGrid.classList.toggle('hidden', !isMain);
  el.editorCard.classList.toggle('hidden', !isMain);
  el.fileTranscriptPanel.classList.toggle('hidden', view !== 'file-transcript');
  el.autoCallsPanel.classList.toggle('hidden', view !== 'auto-calls');
  el.callAnalysisPanel.classList.toggle('hidden', view !== 'call-analysis');
  el.btnBackToMain.classList.toggle('hidden', isMain);
  el.btnFileTranscriptMode.classList.toggle('primary', view === 'file-transcript');
  el.btnAutoCallsMode.classList.toggle('primary', view === 'auto-calls');
  el.btnCallAnalysisMode.classList.toggle('primary', view === 'call-analysis');
  el.btnFileTranscriptMode.classList.toggle('ghost', view !== 'file-transcript');
  el.btnAutoCallsMode.classList.toggle('ghost', view !== 'auto-calls');
  el.btnCallAnalysisMode.classList.toggle('ghost', view !== 'call-analysis');
}

function refreshControls() {
  const busy = state.isRecording || state.isProcessing || state.isStartingRecording || state.isLocalCallRecording;
  el.btnDictate.disabled = state.isProcessing || state.isStartingRecording;
  el.btnRewrite.disabled = state.isProcessing || state.isStartingRecording;
  el.btnRewriteLlm.disabled = state.isProcessing || state.isStartingRecording;
  el.btnTranslate.disabled = state.isProcessing || state.isStartingRecording;
  el.btnCodex.disabled = state.isProcessing || state.isStartingRecording;
  el.applyTextAction.disabled = busy;
  el.chatAsk.disabled = busy;
  el.stopBtn.disabled = !(state.isRecording || state.isProcessing || state.isLocalCallRecording);
  el.startLocalCallRecordingBtn.disabled = state.isRecording || state.isProcessing || state.isStartingRecording || state.isLocalCallRecording;
  el.stopLocalCallRecordingBtn.disabled = !state.isLocalCallRecording;
  if (el.recordingTag) {
    const showRecording = state.isRecording || state.isStartingRecording || state.isLocalCallRecording;
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

function renderFileTranscriptHistory() {
  if (!el.fileTranscriptHistoryList) return;
  const items = state.history.filter((item) => (
    item?.meta?.source === 'file_upload' ||
    item?.meta?.source === 'audio_summary' ||
    item?.meta?.source === 'auto_calls'
  ));

  el.fileTranscriptHistoryList.innerHTML = '';
  if (!items.length) {
    el.fileTranscriptHistoryList.textContent = 'Nenhuma transcrição carregada ainda.';
    return;
  }

  items.slice(0, 50).forEach((item) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'file-transcript-history-item';
    row.innerHTML = `
      <span>${escapeHtml(item.meta?.fileName || item.action)}</span>
      <small>${escapeHtml(item.text.slice(0, 90))}${item.text.length > 90 ? '...' : ''}</small>
    `;
    row.addEventListener('click', () => {
      if (item.meta?.source === 'audio_summary') {
        el.audioSummaryOutput.textContent = item.text;
        return;
      }
      el.audioTranscriptOutput.value = item.text;
      el.selectedAudioFile.textContent = item.meta?.fileName || 'Histórico selecionado.';
    });
    el.fileTranscriptHistoryList.appendChild(row);
  });
}

function handleStop() {
  if (state.isLocalCallRecording) {
    void stopLocalCallRecording();
    return;
  }

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
