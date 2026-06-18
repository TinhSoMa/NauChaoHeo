import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { type AIProvider, type AIProviderResult } from '../aiProvider';
import { type CliAgentDef } from '../../../cliAgentScan/types';
import { AppSettingsService } from '../../appSettings';
import { getAllCliAgentDefs } from '../../../cliAgentScan/registry';
import { resolveOnPath, createCommandInvocation } from '../../../cliAgentScan/detection';

function resolveAgentBin(agent: CliAgentDef, customBin?: string): string | null {
  if (customBin?.trim()) {
    const p = customBin.trim();
    return existsSync(p) ? p : null;
  }
  const binsToTry = [agent.bin, ...(agent.fallbackBins || [])];
  for (const b of binsToTry) {
    const r = resolveOnPath(b);
    if (r) return r;
  }
  return null;
}

export function createCliAgentProvider(): AIProvider {
  return {
    transport: 'cli_agent',
    async call({ prompt, signal, model: _model }): Promise<AIProviderResult> {
      const allSettings = AppSettingsService.getAll();
      const config = allSettings.cliAgentConfig;
      const selection = allSettings.cliAgentSelection;
      const defs = getAllCliAgentDefs();

      // Resolve agent: prefer selection from settings, fall back to first enabled
      let enabled = selection?.agentId
        ? defs.find((d) => d.id === selection.agentId)
        : null;
      if (!enabled) {
        enabled = defs.find((d) => {
          const entry = config[d.id];
          return entry?.enabled !== false;
        });
      }
      if (!enabled) {
        return { success: false, error: 'Không có CLI agent nào được bật. Vào Settings > CLI Agents để cấu hình.' };
      }

      // Resolve binary path: use resolveOnPath + fallbackBins (không dùng raw enabled.bin)
      const entry = config[enabled.id];
      const binPath = resolveAgentBin(enabled, entry?.customBinPath);
      if (!binPath) {
        const binsToTry = [enabled.bin, ...(enabled.fallbackBins || [])];
        return { success: false, error: `[${enabled.name}] Không tìm thấy binary. Đã thử: ${binsToTry.join(', ')}` };
      }

      // Resolve model: chỉ dùng selection hoặc per-agent config, không fallthrough đến model param (Gemini default)
      const modelToUse = selection?.model || entry?.selectedModel || undefined;

      try {
        const result = await spawnWithStdin(binPath, prompt, signal, modelToUse);
        return { success: true, data: result };
      } catch (err: any) {
        if (err.message === 'STOP_REQUESTED' || signal?.aborted) {
          return { success: false, error: 'STOP_REQUESTED', errorCode: 'STOP_REQUESTED' };
        }
        return { success: false, error: `[${enabled.name}] ${err.message}` };
      }
    },
  };
}

/**
 * Parse opencode's JSON event stream (--format json) thành plain text.
 * Mỗi dòng stdout là 1 JSON object. Collect all `type: text` events,
 * lấy `part.text`, concat lại.
 */
function extractOpenCodeText(stdout: string): string {
  const lines = stdout.split(/\r?\n/);
  console.log(`[extractOpenCodeText] Parsing ${lines.length} lines, total ${stdout.length}B`);
  const parts: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj?.type === 'error') {
        const msg =
          (typeof obj.message === 'string' ? obj.message : '') ||
          (typeof obj.error === 'string' ? obj.error : '') ||
          'OpenCode error';
        throw new Error(`OpenCode error: ${msg}`);
      }
      if (obj?.type === 'text' && typeof obj?.part?.text === 'string') {
        if (obj.part.text.length > 0) parts.push(obj.part.text);
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        console.log(`[extractOpenCodeText] Skipped non-JSON line: ${trimmed.slice(0, 200)}`);
        continue;
      }
      throw err;
    }
  }
  const result = parts.join('').trim();
  console.log(`[extractOpenCodeText] Extracted ${result.length} chars from ${parts.length} text events`);
  console.log(`[extractOpenCodeText] Preview: ${result.slice(0, 300)}`);
  return result;
}

function spawnWithStdin(
  bin: string,
  input: string,
  signal?: AbortSignal,
  model?: string,
  timeoutMs = 60000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // OD pattern: `opencode run --format json` để output là JSON event stream
    const args: string[] = ['run', '--format', 'json'];
    if (model) {
      args.push('-m', model);
    }
    const invocation = createCommandInvocation(bin, args);
    console.log(`[spawnWithStdin] Spawning: ${invocation.command} ${invocation.args.join(' ')}`);
    if (model) console.log(`[spawnWithStdin] Model: ${model}`);
    console.log(`[spawnWithStdin] Input length: ${input.length}B`);
    const child = spawn(invocation.command, invocation.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      signal,
    });

    let killedByTimeout = false;
    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill();
    }, timeoutMs);

    let stdout = '';
    let stderr = '';

    child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (killedByTimeout) {
        reject(new Error(`Timeout sau ${timeoutMs / 1000}s`));
      } else {
        reject(err);
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      console.log(`[spawnWithStdin] close: code=${code} stdout=${stdout.length}B stderr=${stderr.length}B`);
      if (stdout) console.log(`[spawnWithStdin] stdout preview: ${stdout.slice(0, 500)}`);
      if (stderr) console.log(`[spawnWithStdin] stderr: ${stderr}`);
      if (killedByTimeout) {
        reject(new Error(`Timeout sau ${timeoutMs / 1000}s`));
        return;
      }
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`Thoát với code ${code}: ${stderr.trim() || '(no output)'}`));
        return;
      }
      // Parse opencode JSON event stream → plain text
      const text = extractOpenCodeText(stdout);
      if (!text) {
        reject(new Error(`Thoát với code ${code}: response rỗng`));
        return;
      }
      resolve(text);
    });

    if (!child.stdin!.destroyed) {
      child.stdin!.write(input);
      child.stdin!.end();
    }
  });
}
