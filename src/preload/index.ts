import { contextBridge, ipcRenderer } from 'electron'
import { createGeminiAPI, GeminiAPI } from './geminiApi'
import { createCaptionAPI, createTTSAPI, CaptionAPI, TTSAPI } from './captionApi'
import { projectApi, ProjectAPI } from './projectApi'
import { appSettingsApi, AppSettingsAPI } from './appSettingsApi'
import { geminiChatApi, GeminiChatAPI } from './geminiChatApi'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Example API methods - add more as needed
  sendMessage: (channel: string, data: unknown) => {
    ipcRenderer.send(channel, data)
  },
  onMessage: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args))
  },
  invoke: (channel: string, data?: unknown) => {
    return ipcRenderer.invoke(channel, data)
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
})

// Declare types for the exposed API
declare global {
  interface Window {
    electronAPI: {
      sendMessage: (channel: string, data: unknown) => void
      onMessage: (channel: string, callback: (...args: unknown[]) => void) => void
      invoke: (channel: string, data?: unknown) => Promise<unknown>
      gemini: GeminiAPI
      caption: CaptionAPI
      tts: TTSAPI
      project: ProjectAPI
      appSettings: AppSettingsAPI
      geminiChat: GeminiChatAPI
    }
  }
}
