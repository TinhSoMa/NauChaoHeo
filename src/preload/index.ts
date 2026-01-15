import { contextBridge, ipcRenderer } from 'electron'

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
  }
})

// Declare types for the exposed API
declare global {
  interface Window {
    electronAPI: {
      sendMessage: (channel: string, data: unknown) => void
      onMessage: (channel: string, callback: (...args: unknown[]) => void) => void
      invoke: (channel: string, data?: unknown) => Promise<unknown>
    }
  }
}
