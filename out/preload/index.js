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
  TRANSLATE_TEXT: "gemini:translateText"
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
    translateText: (text, targetLanguage, model) => electron.ipcRenderer.invoke(GEMINI_IPC_CHANNELS.TRANSLATE_TEXT, text, targetLanguage, model)
  };
}
const CAPTION_IPC_CHANNELS = {
  // Caption
  PARSE_SRT: "caption:parseSrt",
  TRANSLATE: "caption:translate",
  TRANSLATE_PROGRESS: "caption:translateProgress",
  EXPORT_SRT: "caption:exportSrt",
  // TTS
  TTS_GENERATE: "tts:generate",
  TTS_PROGRESS: "tts:progress",
  TTS_GET_VOICES: "tts:getVoices",
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
    }
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
    mergeAudio: (audioFiles, outputPath, timeScale = 1) => electron.ipcRenderer.invoke(CAPTION_IPC_CHANNELS.AUDIO_MERGE, audioFiles, outputPath, timeScale)
  };
}
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
  tts: createTTSAPI()
});
