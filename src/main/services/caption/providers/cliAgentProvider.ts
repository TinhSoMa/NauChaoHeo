import { type AIProvider, type AIProviderResult } from '../aiProvider';
import { execAgent } from '../../cliAgentExecutor';

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

export function createCliAgentProvider(): AIProvider {
  return {
    transport: 'cli_agent',
    async call({ prompt, signal }): Promise<AIProviderResult> {
      try {
        const { stdout, stderr, exitCode } = await execAgent({
          args: ['run', '--format', 'json'],
          stdin: prompt,
          signal,
          timeoutMs: 60000,
        });

        if (stderr) console.log(`[cliAgentProvider] stderr: ${stderr}`);
        if (exitCode !== 0 && !stdout.trim()) {
          return { success: false, error: `Agent thoát với code ${exitCode}: ${stderr.trim() || '(no output)'}` };
        }

        const text = extractOpenCodeText(stdout);
        if (!text) {
          return { success: false, error: `Agent response rỗng (exit code ${exitCode})` };
        }
        return { success: true, data: text };
      } catch (err: any) {
        if (err.message === 'STOP_REQUESTED' || signal?.aborted) {
          return { success: false, error: 'STOP_REQUESTED', errorCode: 'STOP_REQUESTED' };
        }
        return { success: false, error: err.message };
      }
    },
  };
}
