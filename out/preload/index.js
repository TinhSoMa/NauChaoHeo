"use strict";
const electron = require("electron");
const GEMINI_IPC_CHANNELS = {
  // API Key Management
  GET_NEXT_API_KEY: "gemini:getNextApiKey",
  GET_ALL_AVAILABLE_KEYS: "gemini:getAllAvailableKeys",
  GET_STATS: "gemini:getStats",
  RECORD_SUCCESS: "gemini:recordSuccess",
  RECORD_RATE_LIMIT: "gemini:recordRateLimit",
  RECORD_EXHAUSTED: "gemini:recordExhausted",
  RECORD_ERROR: "gemini:recordError",
  RESET_ALL_STATUS: "gemini:resetAllStatus",
  RELOAD_CONFIG: "gemini:reloadConfig",
  // Gemini API calls
  CALL_GEMINI: "gemini:callApi",
  TRANSLATE_TEXT: "gemini:translateText",
  // Key Storage Management
  KEYS_IMPORT: "gemini:keys:import",
  KEYS_EXPORT: "gemini:keys:export",
  KEYS_HAS_KEYS: "gemini:keys:hasKeys",
  KEYS_GET_LOCATION: "gemini:keys:getLocation",
  KEYS_GET_ALL: "gemini:keys:getAll",
  KEYS_GET_ALL_WITH_STATUS: "gemini:keys:getAllWithStatus"
};
function createGeminiAPI() {
  return {
    // API Key Management
    getNextApiKey: () => electron.ipcRenderer.invoke(GEMINI_IPC_CHANNELS.GET_NEXT_API_KEY),
    getAllAvailableKeys: () => electron.ipcRenderer.invoke(GEMINI_IPC_CHANNELS.GET_ALL_AVAILABLE_KEYS),
    getStats: () => electron.ipcRenderer.invoke(GEMINI_IPC_CHANNELS.GET_STATS),
    recordSuccess: (apiKey) => electron.ipcRenderer.invoke(GEMINI_IPC_CHANNELS.RECORD_SUCCESS, apiKey),
    recordRateLimit: (apiKey) => electron.ipcRenderer.invoke(GEMINI_IPC_CHANNELS.RECORD_RATE_LIMIT, apiKey),
    recordExhausted: (apiKey) => electron.ipcRenderer.invoke(GEMINI_IPC_CHANNELS.RECORD_EXHAUSTED, apiKey),
    recordError: (apiKey, errorMessage) => electron.ipcRenderer.invoke(GEMINI_IPC_CHANNELS.RECORD_ERROR, apiKey, errorMessage),
    resetAllStatus: () => electron.ipcRenderer.invoke(GEMINI_IPC_CHANNELS.RESET_ALL_STATUS),
    reloadConfig: () => electron.ipcRenderer.invoke(GEMINI_IPC_CHANNELS.RELOAD_CONFIG),
    // Gemini API calls
    callGemini: (prompt, model) => electron.ipcRenderer.invoke(GEMINI_IPC_CHANNELS.CALL_GEMINI, prompt, model),
    translateText: (text, targetLanguage, model) => electron.ipcRenderer.invoke(GEMINI_IPC_CHANNELS.TRANSLATE_TEXT, text, targetLanguage, model),
    // Key Storage Management
    importKeys: (jsonString) => electron.ipcRenderer.invoke(GEMINI_IPC_CHANNELS.KEYS_IMPORT, jsonString),
    exportKeys: () => electron.ipcRenderer.invoke(GEMINI_IPC_CHANNELS.KEYS_EXPORT),
    hasKeys: () => electron.ipcRenderer.invoke(GEMINI_IPC_CHANNELS.KEYS_HAS_KEYS),
    getKeysLocation: () => electron.ipcRenderer.invoke(GEMINI_IPC_CHANNELS.KEYS_GET_LOCATION),
    getAllKeys: () => electron.ipcRenderer.invoke(GEMINI_IPC_CHANNELS.KEYS_GET_ALL),
    getAllKeysWithStatus: () => electron.ipcRenderer.invoke(GEMINI_IPC_CHANNELS.KEYS_GET_ALL_WITH_STATUS)
  };
}
const CAPTION_IPC_CHANNELS = {
  // Caption
  PARSE_SRT: "caption:parseSrt",
  TRANSLATE: "caption:translate",
  TRANSLATE_PROGRESS: "caption:translateProgress",
  EXPORT_SRT: "caption:exportSrt",
  SPLIT: "caption:split",
  // TTS
  TTS_GENERATE: "tts:generate",
  TTS_PROGRESS: "tts:progress",
  TTS_GET_VOICES: "tts:getVoices",
  TTS_TRIM_SILENCE: "tts:trimSilence",
  // Audio Merge
  AUDIO_ANALYZE: "audio:analyze",
  AUDIO_MERGE: "audio:merge"
};
function createCaptionAPI() {
  return {
    parseSrt: (filePath) => electron.ipcRenderer.invoke(CAPTION_IPC_CHANNELS.PARSE_SRT, filePath),
    parseDraft: (filePath) => electron.ipcRenderer.invoke("caption:parseDraft", filePath),
    exportSrt: (entries, outputPath) => electron.ipcRenderer.invoke(CAPTION_IPC_CHANNELS.EXPORT_SRT, entries, outputPath),
    translate: (options) => electron.ipcRenderer.invoke(CAPTION_IPC_CHANNELS.TRANSLATE, options),
    onTranslateProgress: (callback) => {
      electron.ipcRenderer.on(CAPTION_IPC_CHANNELS.TRANSLATE_PROGRESS, (_event, progress) => {
        callback(progress);
      });
    },
    split: (options) => electron.ipcRenderer.invoke(CAPTION_IPC_CHANNELS.SPLIT, options)
  };
}
function createTTSAPI() {
  return {
    getVoices: () => electron.ipcRenderer.invoke(CAPTION_IPC_CHANNELS.TTS_GET_VOICES),
    generate: (entries, options) => electron.ipcRenderer.invoke(CAPTION_IPC_CHANNELS.TTS_GENERATE, entries, options),
    onProgress: (callback) => {
      electron.ipcRenderer.on(CAPTION_IPC_CHANNELS.TTS_PROGRESS, (_event, progress) => {
        callback(progress);
      });
    },
    analyzeAudio: (audioFiles, srtDuration) => electron.ipcRenderer.invoke(CAPTION_IPC_CHANNELS.AUDIO_ANALYZE, audioFiles, srtDuration),
    mergeAudio: (audioFiles, outputPath, timeScale = 1) => electron.ipcRenderer.invoke(CAPTION_IPC_CHANNELS.AUDIO_MERGE, audioFiles, outputPath, timeScale),
    trimSilence: (audioPaths) => electron.ipcRenderer.invoke(CAPTION_IPC_CHANNELS.TTS_TRIM_SILENCE, audioPaths)
  };
}
const PROJECT_IPC_CHANNELS = {
  OPEN: "project:open",
  CREATE_AND_OPEN: "project:createAndOpen",
  SCAN_PROJECTS: "project:scanProjects",
  GET_METADATA: "project:getMetadata",
  GET_RESOLVED_PATHS: "project:getResolvedPaths",
  READ_FEATURE_FILE: "project:readFeatureFile",
  WRITE_FEATURE_FILE: "project:writeFeatureFile",
  GET_PROJECTS_PATH: "project:getProjectsPath",
  SET_PROJECTS_PATH: "project:setProjectsPath"
};
const projectApi = {
  openProject: (projectId) => electron.ipcRenderer.invoke(PROJECT_IPC_CHANNELS.OPEN, projectId),
  createAndOpen: (projectName) => electron.ipcRenderer.invoke(PROJECT_IPC_CHANNELS.CREATE_AND_OPEN, projectName),
  scanProjects: () => electron.ipcRenderer.invoke(PROJECT_IPC_CHANNELS.SCAN_PROJECTS),
  getMetadata: (projectId) => electron.ipcRenderer.invoke(PROJECT_IPC_CHANNELS.GET_METADATA, projectId),
  getResolvedPaths: (projectId) => electron.ipcRenderer.invoke(PROJECT_IPC_CHANNELS.GET_RESOLVED_PATHS, projectId),
  readFeatureFile: (payload) => electron.ipcRenderer.invoke(PROJECT_IPC_CHANNELS.READ_FEATURE_FILE, payload),
  writeFeatureFile: (payload) => electron.ipcRenderer.invoke(PROJECT_IPC_CHANNELS.WRITE_FEATURE_FILE, payload),
  getProjectsPath: () => electron.ipcRenderer.invoke(PROJECT_IPC_CHANNELS.GET_PROJECTS_PATH),
  setProjectsPath: (path) => electron.ipcRenderer.invoke(PROJECT_IPC_CHANNELS.SET_PROJECTS_PATH, path)
};
const APP_SETTINGS_IPC_CHANNELS = {
  GET_ALL: "appSettings:getAll",
  UPDATE: "appSettings:update",
  GET_PROJECTS_BASE_PATH: "appSettings:getProjectsBasePath",
  SET_PROJECTS_BASE_PATH: "appSettings:setProjectsBasePath",
  ADD_RECENT_PROJECT: "appSettings:addRecentProject",
  GET_RECENT_PROJECT_IDS: "appSettings:getRecentProjectIds",
  GET_LAST_ACTIVE_PROJECT_ID: "appSettings:getLastActiveProjectId",
  REMOVE_FROM_RECENT: "appSettings:removeFromRecent"
};
function createAppSettingsAPI() {
  return {
    getAll: () => electron.ipcRenderer.invoke(APP_SETTINGS_IPC_CHANNELS.GET_ALL),
    update: (partial) => electron.ipcRenderer.invoke(APP_SETTINGS_IPC_CHANNELS.UPDATE, partial),
    getProjectsBasePath: () => electron.ipcRenderer.invoke(APP_SETTINGS_IPC_CHANNELS.GET_PROJECTS_BASE_PATH),
    setProjectsBasePath: (basePath) => electron.ipcRenderer.invoke(APP_SETTINGS_IPC_CHANNELS.SET_PROJECTS_BASE_PATH, basePath),
    addRecentProject: (projectId) => electron.ipcRenderer.invoke(APP_SETTINGS_IPC_CHANNELS.ADD_RECENT_PROJECT, projectId),
    getRecentProjectIds: () => electron.ipcRenderer.invoke(APP_SETTINGS_IPC_CHANNELS.GET_RECENT_PROJECT_IDS),
    getLastActiveProjectId: () => electron.ipcRenderer.invoke(APP_SETTINGS_IPC_CHANNELS.GET_LAST_ACTIVE_PROJECT_ID),
    removeFromRecent: (projectId) => electron.ipcRenderer.invoke(APP_SETTINGS_IPC_CHANNELS.REMOVE_FROM_RECENT, projectId)
  };
}
const appSettingsApi = createAppSettingsAPI();
const CHANNELS = {
  GET_ALL: "geminiChat:getAll",
  GET_ACTIVE: "geminiChat:getActive",
  GET_BY_ID: "geminiChat:getById",
  CREATE: "geminiChat:create",
  UPDATE: "geminiChat:update",
  DELETE: "geminiChat:delete",
  SEND_MESSAGE: "geminiChat:sendMessage",
  GET_COOKIE_CONFIG: "geminiChat:getCookieConfig",
  SAVE_COOKIE_CONFIG: "geminiChat:saveCookieConfig"
};
const geminiChatApi = {
  getAll: () => electron.ipcRenderer.invoke(CHANNELS.GET_ALL),
  getActive: () => electron.ipcRenderer.invoke(CHANNELS.GET_ACTIVE),
  getById: (id) => electron.ipcRenderer.invoke(CHANNELS.GET_BY_ID, id),
  create: (data) => electron.ipcRenderer.invoke(CHANNELS.CREATE, data),
  update: (id, data) => electron.ipcRenderer.invoke(CHANNELS.UPDATE, id, data),
  delete: (id) => electron.ipcRenderer.invoke(CHANNELS.DELETE, id),
  sendMessage: (message, configId, context) => electron.ipcRenderer.invoke(CHANNELS.SEND_MESSAGE, message, configId, context),
  // Cookie config
  getCookieConfig: () => electron.ipcRenderer.invoke(CHANNELS.GET_COOKIE_CONFIG),
  saveCookieConfig: (data) => electron.ipcRenderer.invoke(CHANNELS.SAVE_COOKIE_CONFIG, data)
};
const PROXY_IPC_CHANNELS = {
  GET_ALL: "proxy:getAll",
  ADD: "proxy:add",
  REMOVE: "proxy:remove",
  UPDATE: "proxy:update",
  TEST: "proxy:test",
  GET_STATS: "proxy:getStats",
  IMPORT: "proxy:import",
  EXPORT: "proxy:export",
  RESET: "proxy:reset"
  // Reset failed counts
};
const proxyApi = {
  getAll: () => electron.ipcRenderer.invoke(PROXY_IPC_CHANNELS.GET_ALL),
  add: (config) => electron.ipcRenderer.invoke(PROXY_IPC_CHANNELS.ADD, config),
  remove: (id) => electron.ipcRenderer.invoke(PROXY_IPC_CHANNELS.REMOVE, id),
  update: (id, updates) => electron.ipcRenderer.invoke(PROXY_IPC_CHANNELS.UPDATE, id, updates),
  test: (id) => electron.ipcRenderer.invoke(PROXY_IPC_CHANNELS.TEST, id),
  getStats: async () => {
    return electron.ipcRenderer.invoke(PROXY_IPC_CHANNELS.GET_STATS);
  },
  import: async (data) => {
    return electron.ipcRenderer.invoke(PROXY_IPC_CHANNELS.IMPORT, data);
  },
  export: async () => {
    return electron.ipcRenderer.invoke(PROXY_IPC_CHANNELS.EXPORT);
  },
  reset: async () => {
    return electron.ipcRenderer.invoke(PROXY_IPC_CHANNELS.RESET);
  }
};
electron.contextBridge.exposeInMainWorld("electronAPI", {
  // Example API methods - add more as needed
  sendMessage: (channel, data) => {
    electron.ipcRenderer.send(channel, data);
  },
  onMessage: (channel, callback) => {
    electron.ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },
  invoke: (channel, data) => {
    return electron.ipcRenderer.invoke(channel, data);
  },
  // Gemini API
  gemini: createGeminiAPI(),
  // Caption API (dịch phụ đề)
  caption: createCaptionAPI(),
  // TTS API (text-to-speech)
  tts: createTTSAPI(),
  // Project API (quan ly du an dich)
  project: projectApi,
  // App Settings API (cai dat ung dung)
  appSettings: appSettingsApi,
  // Gemini Chat API (cau hinh Gemini web)
  geminiChat: geminiChatApi,
  // Proxy API (quan ly proxy rotation)
  proxy: proxyApi
});
