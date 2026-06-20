import { ipcMain, BrowserWindow } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { randomUUID } from 'crypto'
import {
  AGENT_TRANSLATION_IPC_CHANNELS,
  AgentTranslationDetectResult,
  AgentTranslationStartPayload,
  AgentTranslationStartResult,
  AgentTranslationProgress,
  AgentTranslationStatus
} from '../../shared/types/agentTranslation'
import { detectAgent } from '../services/agentTranslation/agentDetector'
import { AgentSpawner } from '../services/agentTranslation/spawner'

const activeSessions = new Map<string, {
  spawner: AgentSpawner
  outputDir: string
}>()

function getActiveWebContents(): Electron.WebContents | null {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  return win?.webContents ?? null
}

function sendProgress(progress: AgentTranslationProgress): void {
  const wc = getActiveWebContents()
  if (wc && !wc.isDestroyed()) {
    wc.send(AGENT_TRANSLATION_IPC_CHANNELS.PROGRESS, progress)
  }
}

export function registerAgentTranslationHandlers(): void {
  console.log('[IPC] Đang đăng ký Agent Translation handlers...')

  ipcMain.handle(AGENT_TRANSLATION_IPC_CHANNELS.DETECT, async (_event, agentId: string = 'opencode'): Promise<AgentTranslationDetectResult> => {
    console.log(`[IPC] agentTranslation:detect agentId=${agentId}`)
    const result = detectAgent(agentId)
    console.log(`[IPC] agentTranslation:detect result=`, result)
    return result
  })

  ipcMain.handle(AGENT_TRANSLATION_IPC_CHANNELS.START, async (_event, payload: AgentTranslationStartPayload): Promise<AgentTranslationStartResult> => {
    const { chapters, sourceLang, targetLang, memory, batchSize = 10, outputDir: customDir } = payload
    console.log(`[IPC] agentTranslation:start agentId=${payload.agentId || 'opencode'}, ${chapters?.length || 0} chapters, ${sourceLang}->${targetLang}, batchSize=${batchSize}`)

    if (!chapters || chapters.length === 0) {
      console.log(`[IPC] agentTranslation:start LỖI: không có chapters`)
      return { success: false, error: 'No chapters provided', totalBatches: 0 }
    }

    const agentId = payload.agentId || 'opencode'
    const detected = detectAgent(agentId)
    if (!detected.detected) {
      console.log(`[IPC] agentTranslation:start LỖI: agent "${agentId}" không detected`)
      return { success: false, error: `Agent "${agentId}" not detected. Please install it first.`, totalBatches: 0 }
    }
    console.log(`[IPC] agentTranslation:start agent detected OK: ${detected.agentName} at ${detected.executablePath}`)

    const sessionId = randomUUID()
    const outputDir = customDir || path.join(process.env.TEMP || '.', 'nauchaoheo-agent-translation', sessionId)
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    const totalBatches = Math.ceil(chapters.length / batchSize)
    console.log(`[IPC] agentTranslation:start outputDir=${outputDir}, sessionId=${sessionId}, totalBatches=${totalBatches} (${chapters.length} chapters / ${batchSize} per batch)`)

    const spawner = new AgentSpawner()

    spawner.on('event', (event) => {
      if (event.type === 'progress') {
        console.log(`[IPC] Progress: batch ${event.batchNumber}/${totalBatches}, file=${event.filePath}, chapters=${event.chapterIds?.length}`)
        sendProgress({
          batchNumber: event.batchNumber ?? 0,
          totalBatches,
          filePath: event.filePath ?? '',
          status: 'batch_done',
          chapterIds: event.chapterIds,
        })
      } else if (event.type === 'error') {
        console.log(`[IPC] Error: ${event.message}`)
        sendProgress({
          batchNumber: 0,
          totalBatches,
          filePath: '',
          status: 'error',
          error: event.message,
        })
      } else if (event.type === 'exit') {
        console.log(`[IPC] Exit: ${event.message}`)
        const isComplete = spawner.completedCount >= totalBatches
        sendProgress({
          batchNumber: spawner.completedCount,
          totalBatches,
          filePath: '',
          status: isComplete ? 'batch_done' : 'error',
          error: isComplete ? undefined : `Only ${spawner.completedCount}/${totalBatches} batches completed.`,
        })

        setTimeout(() => {
          activeSessions.delete(sessionId)
        }, 1000)
      }
    })

    activeSessions.set(sessionId, { spawner, outputDir })
    console.log(`[IPC] agentTranslation:start session registered: ${sessionId}`)

    spawner.start({
      agentId,
      chapters,
      sourceLang,
      targetLang,
      outputDir,
      batchSize,
      memory,
    }).catch((err) => {
      console.log(`[IPC] agentTranslation:start spawn error: ${err}`)
      sendProgress({
        batchNumber: 0,
        totalBatches,
        filePath: '',
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
    })

    return { success: true, outputDir, totalBatches }
  })

  ipcMain.handle(AGENT_TRANSLATION_IPC_CHANNELS.STATUS, async (): Promise<AgentTranslationStatus> => {
    for (const [sid, session] of activeSessions) {
      const status = session.spawner.getStatus()
      console.log(`[IPC] agentTranslation:status session=${sid.slice(0, 8)}... running=${status.running}, ${status.completedBatches}/${status.totalBatches}`)
      return {
        running: status.running,
        currentBatch: status.currentBatch,
        totalBatches: status.totalBatches,
        completedBatches: status.completedBatches,
        outputDir: status.outputDir,
      }
    }
    console.log(`[IPC] agentTranslation:status no active session`)
    return { running: false, currentBatch: 0, totalBatches: 0, completedBatches: 0 }
  })

  ipcMain.handle(AGENT_TRANSLATION_IPC_CHANNELS.CANCEL, async (): Promise<{ success: boolean }> => {
    console.log(`[IPC] agentTranslation:cancel ${activeSessions.size} active sessions`)
    for (const [sid, session] of activeSessions) {
      console.log(`[IPC] Cancelling session ${sid.slice(0, 8)}...`)
      session.spawner.cancel()
    }
    activeSessions.clear()
    return { success: true }
  })
}
