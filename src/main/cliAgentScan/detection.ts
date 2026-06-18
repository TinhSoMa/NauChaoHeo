import { execFile } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import { getAllCliAgentDefs } from './registry';
import type { CliAgentDef, CliAgentModelOption, DetectedCliAgent, DetectedCliAgentMap } from './types';

const SCAN_TIMEOUT = 5000;

export interface CliAgentScanConfig {
  customBinPath?: string | null;
  env?: Record<string, string>;
  enabled?: boolean;
}

export type CliAgentConfigMap = Record<string, CliAgentScanConfig>;

function resolvePathDirs(): string[] {
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const seen = new Set<string>();
  const dirs: string[] = [];

  const addDir = (dir: string) => {
    const normalized = path.resolve(dir);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      dirs.push(normalized);
    }
  };

  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (dir.trim()) addDir(dir.trim());
  }

  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    if (appData) addDir(`${appData}\\npm`);
    if (localAppData) addDir(`${localAppData}\\Programs`);
    if (home) addDir(`${home}\\.local\\bin`);
    if (home) addDir(`${home}\\.bun\\bin`);
    if (home) addDir(`${home}\\scoop\\shims`);
  } else {
    if (home) addDir(`${home}/.local/bin`);
    if (home) addDir(`${home}/.bun/bin`);
    if (home) addDir(`${home}/.npm-global/bin`);
    addDir('/opt/homebrew/bin');
    addDir('/usr/local/bin');
    addDir('/opt/local/bin');
  }

  return dirs;
}

export function resolveOnPath(bin: string): string | null {
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map((e) => e.trim().toLowerCase())
      : [''];
  const dirs = resolvePathDirs();
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, bin + ext);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

interface CommandInvocation {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

export function createCommandInvocation(command: string, args: string[]): CommandInvocation {
  if (process.platform === 'win32' && /\.(bat|cmd)$/i.test(command)) {
    const quote = (w: string) => /[\s"&<>|^%]/.test(w) ? `"${w.replace(/"/g, '""')}"` : w;
    const inner = [command, ...args].map(quote).join(' ');
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', `"${inner}"`],
      windowsVerbatimArguments: true,
    };
  }
  return { command, args };
}

function probeVersion(binPath: string, args: string[], extraEnv?: Record<string, string>): Promise<string | null> {
  const invocation = createCommandInvocation(binPath, args);
  const env = extraEnv && Object.keys(extraEnv).length > 0
    ? { ...process.env, ...extraEnv }
    : undefined;
  return new Promise((resolve) => {
    execFile(invocation.command, invocation.args, {
      timeout: SCAN_TIMEOUT,
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      env,
    }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const v = stdout?.toString().trim();
      resolve(v || null);
    });
  });
}

async function fetchModels(
  def: CliAgentDef,
  resolvedBin: string,
  env?: Record<string, string>,
): Promise<{ models: CliAgentModelOption[]; source: 'live' | 'fallback' }> {
  if (typeof def.fetchModels === 'function') {
    try {
      const parsed = await def.fetchModels(resolvedBin, env || {});
      if (!parsed || parsed.length === 0) {
        return { models: def.models || [], source: 'fallback' };
      }
      return { models: parsed, source: 'live' };
    } catch {
      return { models: def.models || [], source: 'fallback' };
    }
  }

  if (!def.listModels) {
    return { models: def.models || [], source: 'fallback' };
  }

  try {
    const invocation = createCommandInvocation(resolvedBin, def.listModels.args);
    const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      execFile(invocation.command, invocation.args, {
        timeout: def.listModels!.timeoutMs ?? 10000,
        windowsHide: true,
        windowsVerbatimArguments: invocation.windowsVerbatimArguments,
        env: env && Object.keys(env).length > 0 ? { ...process.env, ...env } : undefined,
        maxBuffer: 8 * 1024 * 1024,
      }, (error, stdoutBuffer) => {
        if (error) { reject(error); return; }
        resolve({ stdout: (stdoutBuffer || '').toString() });
      });
    });
    const parsed = def.listModels.parse(stdout);
    if (!parsed || parsed.length === 0) {
      return { models: def.models || [], source: 'fallback' };
    }
    return { models: parsed, source: 'live' };
  } catch {
    return { models: def.models || [], source: 'fallback' };
  }
}

async function detectSingleAgent(
  def: CliAgentDef,
  config?: CliAgentScanConfig,
): Promise<DetectedCliAgent> {
  if (config?.enabled === false) {
    return {
      id: def.id as any,
      name: def.name,
      bin: def.bin,
      fallbackBins: def.fallbackBins,
      versionArgs: def.versionArgs,
      models: def.models,
      modelsSource: 'fallback',
      supportsCustomModel: def.supportsCustomModel,
      available: false,
      path: null,
      version: null,
      error: 'Disabled in config',
    };
  }

  let resolvedPath: string | null = null;
  let foundBin: string | null = null;

  if (config?.customBinPath) {
    if (existsSync(config.customBinPath)) {
      resolvedPath = config.customBinPath;
      foundBin = def.bin;
    } else {
      return {
        id: def.id as any,
        name: def.name,
        bin: def.bin,
        fallbackBins: def.fallbackBins,
        versionArgs: def.versionArgs,
        models: def.models,
        modelsSource: 'fallback',
        supportsCustomModel: def.supportsCustomModel,
        available: false,
        path: null,
        version: null,
        error: `Custom bin path not found: ${config.customBinPath}`,
      };
    }
  } else {
    const binsToTry = [def.bin, ...(def.fallbackBins || [])];
    for (const bin of binsToTry) {
      const r = resolveOnPath(bin);
      if (r) {
        resolvedPath = r;
        foundBin = bin;
        break;
      }
    }
  }

  if (!resolvedPath) {
    return {
      id: def.id as any,
      name: def.name,
      bin: def.bin,
      fallbackBins: def.fallbackBins,
      versionArgs: def.versionArgs,
      models: def.models,
      modelsSource: 'fallback',
      supportsCustomModel: def.supportsCustomModel,
      available: false,
      path: null,
      version: null,
      error: 'Not found on PATH',
    };
  }

  const [version, { models, source: modelsSource }] = await Promise.all([
    probeVersion(resolvedPath, def.versionArgs, config?.env),
    fetchModels(def, resolvedPath, config?.env),
  ]);

  return {
    id: def.id as any,
    name: def.name,
    bin: foundBin || def.bin,
    fallbackBins: def.fallbackBins,
    versionArgs: def.versionArgs,
    models,
    modelsSource,
    supportsCustomModel: def.supportsCustomModel,
    available: true,
    path: resolvedPath,
    version,
  };
}

async function detectSingleAgentSafe(
  def: CliAgentDef,
  config?: CliAgentScanConfig,
): Promise<DetectedCliAgent> {
  try {
    return await detectSingleAgent(def, config);
  } catch (err) {
    return {
      id: def.id as any,
      name: def.name,
      bin: def.bin,
      fallbackBins: def.fallbackBins,
      versionArgs: def.versionArgs,
      models: def.models,
      modelsSource: 'fallback',
      supportsCustomModel: def.supportsCustomModel,
      available: false,
      path: null,
      version: null,
      error: `Detection failed: ${(err as Error).message}`,
    };
  }
}

export async function scanCliAgents(config?: CliAgentConfigMap): Promise<DetectedCliAgent[]> {
  const defs = getAllCliAgentDefs();
  const results = await Promise.all(
    defs.map((def) => detectSingleAgentSafe(def, config?.[def.id]))
  );
  return results;
}

export async function scanCliAgentsMap(config?: CliAgentConfigMap): Promise<DetectedCliAgentMap> {
  const results = await scanCliAgents(config);
  const map = {} as DetectedCliAgentMap;
  for (const agent of results) {
    map[agent.id] = agent;
  }
  return map;
}
