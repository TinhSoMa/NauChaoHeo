import { ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { EventEmitter } from 'events'
import { AppSettingsService } from '../appSettings'
import {
  resolveAgentDef,
  resolveAgentBin,
  resolveAgentModel,
  spawnAgentProcess,
  writeStdin,
} from '../cliAgentExecutor'
import { buildBatchPrompt, BatchChapter } from './agentPromptBuilder'
import type { Chapter } from '../../../shared/types/story'

export interface SpawnOptions {
  agentId: string
  chapters: Chapter[]
  sourceLang: string
  targetLang: string
  outputDir: string
  batchSize: number
  memory?: { glossary?: string; continuity?: string } | null
}

export interface SpawnEvent {
  type: 'progress' | 'error' | 'exit' | 'stdout'
  batchNumber?: number
  totalBatches?: number
  filePath?: string
  chapterIds?: string[]
  message?: string
  exitCode?: number
}

function extractJsonFromText(text: string): string | null {
  const trimmed = text.trim()
  const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = jsonMatch ? jsonMatch[1].trim() : trimmed
  const arrayMatch = candidate.match(/\[[\s\S]*\]/)
  if (arrayMatch) return arrayMatch[0]
  const objectMatch = candidate.match(/\{[\s\S]*\}/)
  if (objectMatch) return objectMatch[0]
  return null
}

export class AgentSpawner extends EventEmitter {
  private _running: boolean = false
  private _cancelled: boolean = false
  private totalBatches: number = 0
  private completedBatches: number = 0
  private outputDir: string = ''
  private currentProcesses: ChildProcess[] = []

  constructor() {
    super()
  }

  get running(): boolean {
    return this._running
  }

  get completedCount(): number {
    return this.completedBatches
  }

  private async spawnBatch(
    batchChapters: BatchChapter[],
    batchNumber: number,
    agentId: string,
    sourceLang: string,
    targetLang: string,
    memory: { glossary?: string; continuity?: string } | null | undefined
  ): Promise<boolean> {
    const prompt = buildBatchPrompt(batchChapters, sourceLang, targetLang, batchNumber, this.totalBatches, memory)

    console.log(`[AgentSpawner] Batch ${batchNumber}/${this.totalBatches}: prompt=${prompt.length}B, chapters=${batchChapters.length}`)

    const def = resolveAgentDef(agentId)
    if (!def) {
      console.log(`[AgentSpawner] LỖI: Agent "${agentId}" không có sẵn`)
      return false
    }

    const settings = AppSettingsService.getAll()
    const entry = settings.cliAgentConfig?.[def.id]
    const bin = resolveAgentBin(def, entry?.customBinPath)
    if (!bin) {
      console.log(`[AgentSpawner] LỖI: Không tìm thấy binary cho ${agentId}`)
      return false
    }

    const model = resolveAgentModel(def)
    const args: string[] = ['run', '--format', 'json']
    if (model && def.supportsCustomModel) {
      args.push('-m', model)
    }

    const env = entry?.env && Object.keys(entry.env).length > 0
      ? { ...process.env, ...entry.env }
      : undefined

    return new Promise((resolve) => {
      const child = spawnAgentProcess(bin, args, { env })
      this.currentProcesses.push(child)

      let stdoutData = ''
      child.stdout?.on('data', (data: Buffer) => {
        stdoutData += data.toString('utf-8')
      })

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString('utf-8')
        if (text.length > 0) {
          console.log(`[AgentSpawner stderr batch ${batchNumber}] ${text.slice(0, 200)}`)
        }
      })

      child.on('error', (err) => {
        console.log(`[AgentSpawner] Batch ${batchNumber} error: ${err.message}`)
        this.emit('event', { type: 'error', message: `Batch ${batchNumber}: ${err.message}` } as SpawnEvent)
        resolve(false)
      })

      child.on('exit', (code) => {
        const idx = this.currentProcesses.indexOf(child)
        if (idx >= 0) this.currentProcesses.splice(idx, 1)

        console.log(`[AgentSpawner] Batch ${batchNumber} exit code=${code}, stdout=${stdoutData.length}B`)

        if (this._cancelled) {
          resolve(false)
          return
        }

        const jsonText = this.parseResponse(stdoutData)
        if (!jsonText) {
          console.log(`[AgentSpawner] Batch ${batchNumber}: không tìm thấy JSON trong response`)
          console.log(`[AgentSpawner] Response preview: ${stdoutData.slice(0, 500)}`)
          this.emit('event', { type: 'error', message: `Batch ${batchNumber}: no JSON in response` } as SpawnEvent)
          resolve(false)
          return
        }

        try {
          const parsed = JSON.parse(jsonText)
          if (!Array.isArray(parsed)) {
            console.log(`[AgentSpawner] Batch ${batchNumber}: response không phải array`)
            resolve(false)
            return
          }

          const filename = `batch_${String(batchNumber).padStart(3, '0')}.json`
          const filePath = path.join(this.outputDir, filename)
          fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2), 'utf-8')
          console.log(`[AgentSpawner] Batch ${batchNumber}: đã ghi ${filePath} (${JSON.stringify(parsed).length}B)`)

          const chapterIds = parsed.map((item: any) => String(item.chapterId || ''))
          this.completedBatches++
          this.emit('event', {
            type: 'progress',
            batchNumber,
            totalBatches: this.totalBatches,
            filePath,
            chapterIds,
          } as SpawnEvent)

          resolve(true)
        } catch (err) {
          console.log(`[AgentSpawner] Batch ${batchNumber}: JSON parse error: ${err instanceof Error ? err.message : String(err)}`)
          console.log(`[AgentSpawner] Extracted text: ${jsonText.slice(0, 300)}`)
          resolve(false)
        }
      })

      writeStdin(child, prompt)
    })
  }

  private parseResponse(stdout: string): string | null {
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed.part?.type === 'text' && typeof parsed.part.text === 'string') {
          const extracted = extractJsonFromText(parsed.part.text)
          if (extracted) return extracted
        }
      } catch {
        // skip non-JSON lines
      }
    }
    return null
  }

  async start(options: SpawnOptions): Promise<void> {
    const { agentId, chapters, sourceLang, targetLang, outputDir, batchSize, memory } = options
    this.outputDir = outputDir
    this.totalBatches = Math.ceil(chapters.length / batchSize)
    this.completedBatches = 0
    this._running = true
    this._cancelled = false
    this.currentProcesses = []

    console.log(`[AgentSpawner] Bắt đầu: agentId=${agentId}, ${chapters.length} chapters, ${sourceLang}->${targetLang}, batchSize=${batchSize}, totalBatches=${this.totalBatches}`)

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    for (let i = 0; i < chapters.length; i += batchSize) {
      if (this._cancelled) break

      const batchNumber = Math.floor(i / batchSize) + 1
      const batchChapters: BatchChapter[] = chapters.slice(i, i + batchSize).map((c) => ({
        id: c.id,
        title: c.title,
        content: c.content,
      }))

      const ok = await this.spawnBatch(batchChapters, batchNumber, agentId, sourceLang, targetLang, memory)
      if (!ok && !this._cancelled) {
        console.log(`[AgentSpawner] Batch ${batchNumber} thất bại, dừng lại`)
        break
      }
    }

    this._running = false
    console.log(`[AgentSpawner] Kết thúc: ${this.completedBatches}/${this.totalBatches} batches`)
    this.emit('event', {
      type: 'exit',
      exitCode: this.completedBatches >= this.totalBatches ? 0 : 1,
      message: `${this.completedBatches}/${this.totalBatches} batches completed`
    } as SpawnEvent)
  }

  cancel(): void {
    console.log(`[AgentSpawner] Cancel requested`)
    this._cancelled = true
    for (const child of this.currentProcesses) {
      if (!child.killed) {
        child.kill('SIGTERM')
      }
    }
    this.currentProcesses = []
    this._running = false
  }

  getStatus(): { running: boolean; currentBatch: number; totalBatches: number; completedBatches: number; outputDir: string } {
    return {
      running: this._running,
      currentBatch: this.completedBatches + 1,
      totalBatches: this.totalBatches,
      completedBatches: this.completedBatches,
      outputDir: this.outputDir,
    }
  }
}
