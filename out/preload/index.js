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
  gemini: createGeminiAPI()
});
