import * as fs from 'fs'
import * as path from 'path'
import { EventEmitter } from 'events'

export interface BatchFileEvent {
  batchNumber: number
  filePath: string
  chapterIds: string[]
  timestamp: number
  error?: string
}

export class OutputWatcher extends EventEmitter {
  private dir: string = ''
  private knownFiles: Set<string> = new Set()
  private interval: ReturnType<typeof setInterval> | null = null
  private totalBatches: number = 0
  private _watching: boolean = false

  get watching(): boolean {
    return this._watching
  }

  scanOutputDir(): number {
    if (!fs.existsSync(this.dir)) return 0
    const files = fs.readdirSync(this.dir)
      .filter((f) => f.startsWith('batch_') && f.endsWith('.json'))
    for (const f of files) {
      this.knownFiles.add(f)
    }
    return files.length
  }

  start(dir: string, totalBatches: number): void {
    console.log(`[OutputWatcher] Bắt đầu watch dir=${dir}, totalBatches=${totalBatches}`)
    this.dir = dir
    this.totalBatches = totalBatches
    this.knownFiles.clear()

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const existing = fs.readdirSync(dir).filter((f) => f.startsWith('batch_') && f.endsWith('.json'))
    console.log(`[OutputWatcher] Batch files có sẵn: ${existing.length}`)
    for (const f of existing) {
      this.knownFiles.add(f)
    }

    this._watching = true
    this.interval = setInterval(() => this.poll(), 1000)
  }

  stop(): void {
    console.log(`[OutputWatcher] Dừng watch`)
    this._watching = false
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  private poll(): void {
    if (!fs.existsSync(this.dir)) return

    const files = fs.readdirSync(this.dir)
      .filter((f) => f.startsWith('batch_') && f.endsWith('.json'))

    for (const file of files) {
      if (this.knownFiles.has(file)) continue

      const filePath = path.join(this.dir, file)
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        const data = JSON.parse(content)

        this.knownFiles.add(file)

        const match = file.match(/batch_(\d+)\.json/)
        const batchNumber = match ? parseInt(match[1], 10) : 0

        const chapterIds: string[] = Array.isArray(data)
          ? data.map((item: any) => String(item.chapterId || ''))
          : []

        console.log(`[OutputWatcher] Batch mới: ${file} (#${batchNumber}, ${chapterIds.length} chapters, ${content.length}B)`)

        const event: BatchFileEvent = {
          batchNumber,
          filePath,
          chapterIds,
          timestamp: Date.now()
        }

        this.emit('batch', event)

        if (batchNumber >= this.totalBatches) {
          console.log(`[OutputWatcher] Đã đủ ${this.totalBatches} batches, dừng watch`)
          this.stop()
        }
      } catch (err) {
        console.log(`[OutputWatcher] Parse lỗi ${file}: ${err instanceof Error ? err.message : String(err)} -> sẽ thử lại sau`)
        this.knownFiles.delete(file)
        this.emit('batch', {
          batchNumber: 0,
          filePath,
          chapterIds: [],
          timestamp: Date.now(),
          error: `Parse error: ${err instanceof Error ? err.message : String(err)}`
        } as BatchFileEvent)
      }
    }
  }
}
