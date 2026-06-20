import { spawn, ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { AppSettingsService } from './appSettings'
import { type CliAgentDef } from '../cliAgentScan/types'
import { getAllCliAgentDefs, getCliAgentDef } from '../cliAgentScan/registry'
import { resolveOnPath, createCommandInvocation } from '../cliAgentScan/detection'

export interface AgentExecOptions {
  agentId?: string
  args?: string[]
  stdin: string
  signal?: AbortSignal
  timeoutMs?: number
  env?: Record<string, string>
}

export interface AgentResolved {
  agentId: string
  def: CliAgentDef
  bin: string
  model?: string
}

export function resolveAgentDef(agentId?: string): CliAgentDef | null {
  const allSettings = AppSettingsService.getAll()
  const config = allSettings.cliAgentConfig
  const selection = allSettings.cliAgentSelection
  const defs = getAllCliAgentDefs()

  if (agentId) {
    console.log(`[resolveAgentDef] Tìm theo agentId="${agentId}"`)
    const def = getCliAgentDef(agentId as any)
    if (def) {
      const entry = config[def.id]
      if (entry?.enabled === false) {
        console.log(`[resolveAgentDef] Agent "${agentId}" đã bị disable trong config`)
        return null
      }
      console.log(`[resolveAgentDef] Tìm thấy: ${def.name} (${def.bin})`)
      return def
    }
    console.log(`[resolveAgentDef] Không tìm thấy agentId="${agentId}" trong registry`)
    return null
  }

  if (selection?.agentId) {
    const def = defs.find((d) => d.id === selection.agentId)
    if (def) {
      const entry = config[def.id]
      if (entry?.enabled !== false) {
        console.log(`[resolveAgentDef] Dùng agent từ selection: ${def.name}`)
        return def
      }
    }
  }

  const fallback = defs.find((d) => {
    const entry = config[d.id]
    return entry?.enabled !== false
  })
  if (fallback) {
    console.log(`[resolveAgentDef] Fallback đến agent đầu tiên được enable: ${fallback.name}`)
  } else {
    console.log(`[resolveAgentDef] KHÔNG có agent nào được enable!`)
  }
  return fallback || null
}

export function resolveAgentBin(def: CliAgentDef, customBinPath?: string | null): string | null {
  console.log(`[resolveAgentBin] Resolve bin cho ${def.name}: customBinPath=${customBinPath || '(none)'}, defaultBin=${def.bin}, fallbacks=${def.fallbackBins?.join(',') || '(none)'}`)
  if (customBinPath?.trim()) {
    const p = customBinPath.trim()
    if (existsSync(p)) {
      console.log(`[resolveAgentBin] Dùng custom path: ${p}`)
      return p
    }
    console.log(`[resolveAgentBin] Custom path không tồn tại: ${p}`)
    return null
  }
  const binsToTry = [def.bin, ...(def.fallbackBins || [])]
  for (const b of binsToTry) {
    const r = resolveOnPath(b)
    if (r) {
      console.log(`[resolveAgentBin] Tìm thấy: ${b} -> ${r}`)
      return r
    }
    console.log(`[resolveAgentBin] Không tìm thấy trên PATH: ${b}`)
  }
  return null
}

export function resolveAgentModel(def: CliAgentDef): string | undefined {
  const allSettings = AppSettingsService.getAll()
  const config = allSettings.cliAgentConfig
  const selection = allSettings.cliAgentSelection
  const entry = config[def.id]
  const model = selection?.agentId === def.id
    ? (selection.model || entry?.selectedModel || undefined)
    : (entry?.selectedModel || undefined)
  console.log(`[resolveAgentModel] Agent=${def.name}, model=${model || '(default)'} (selection.agentId=${selection?.agentId}, entry.selectedModel=${entry?.selectedModel || '(none)'})`)
  return model
}

export function spawnAgentProcess(
  bin: string,
  args: string[],
  opts?: { signal?: AbortSignal; env?: Record<string, string>; cwd?: string },
): ChildProcess {
  const invocation = createCommandInvocation(bin, args)
  return spawn(invocation.command, invocation.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    signal: opts?.signal,
    env: opts?.env ? { ...process.env, ...opts.env } : { ...process.env },
    cwd: opts?.cwd,
  })
}

export function writeStdin(child: ChildProcess, input: string): void {
  if (!child.stdin!.destroyed) {
    child.stdin!.write(input)
    child.stdin!.end()
  }
}

export function execAgent(options: AgentExecOptions): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const { agentId, args = ['run', '--format', 'json'], stdin, signal, timeoutMs = 60000 } = options

  const def = resolveAgentDef(agentId)
  if (!def) {
    return Promise.reject(new Error('Không có CLI agent nào được bật. Vào Settings > CLI Agents để cấu hình.'))
  }

  const allSettings = AppSettingsService.getAll()
  const entry = allSettings.cliAgentConfig?.[def.id]
  const bin = resolveAgentBin(def, entry?.customBinPath)
  if (!bin) {
    return Promise.reject(new Error(`[${def.name}] Không tìm thấy binary. Đã thử: ${[def.bin, ...(def.fallbackBins || [])].join(', ')}`))
  }

  const model = resolveAgentModel(def)
  const execArgs = model && def.supportsCustomModel ? [...args, '-m', model] : args

  const env = entry?.env && Object.keys(entry.env).length > 0
    ? { ...process.env, ...entry.env, ...options.env }
    : options.env ? { ...process.env, ...options.env } : undefined

  const child = spawnAgentProcess(bin, execArgs, { signal, env })

  let killedByTimeout = false
  const timer = timeoutMs > 0 ? setTimeout(() => {
    killedByTimeout = true
    child.kill()
  }, timeoutMs) : undefined

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let exitCode: number | null = null

    child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    child.on('error', (err) => {
      clearTimeout(timer)
      if (killedByTimeout) {
        reject(new Error(`Timeout sau ${timeoutMs / 1000}s`))
      } else {
        reject(err)
      }
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      exitCode = code
      if (killedByTimeout) {
        reject(new Error(`Timeout sau ${timeoutMs / 1000}s`))
        return
      }
      resolve({ stdout, stderr, exitCode })
    })

    writeStdin(child, stdin)
  })
}
