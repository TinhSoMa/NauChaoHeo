import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

export const CAPCUT_PROJECT_INDEX_FILE = '_capcut_project_index.json';

export interface CapcutProjectIndexItem {
  sourceVideoPath: string;
  sourceVideoFileName: string;
  projectName: string;
  draftsPath: string;
  assetBaseDir: string;
  clipsDir: string;
  sourceVideoCopiedPath?: string;
  lastAutoAudioPath?: string;
  lastAutoAudioUpdatedAt?: string;
}

export interface CapcutProjectIndexData {
  version: 1;
  updatedAt: string;
  items: CapcutProjectIndexItem[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function toWindowsLikePath(inputPath: string): string {
  return path.resolve(inputPath).replace(/\//g, '\\');
}

function normalizeSourceVideoPath(inputPath: string): string {
  return toWindowsLikePath(inputPath).toLowerCase();
}

function getIndexPathInternal(draftsPath: string): string {
  return path.join(path.resolve(draftsPath), CAPCUT_PROJECT_INDEX_FILE);
}

function buildEmptyIndex(): CapcutProjectIndexData {
  return {
    version: 1,
    updatedAt: nowIso(),
    items: [],
  };
}

async function readJsonFile(filePath: string): Promise<CapcutProjectIndexData> {
  if (!fsSync.existsSync(filePath)) {
    return buildEmptyIndex();
  }
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CapcutProjectIndexData>;
    if (parsed?.version !== 1 || !Array.isArray(parsed.items)) {
      return buildEmptyIndex();
    }
    const items = parsed.items
      .filter((item) => item && typeof item.sourceVideoPath === 'string' && typeof item.projectName === 'string')
      .map((item) => ({
        sourceVideoPath: String(item.sourceVideoPath),
        sourceVideoFileName: String(item.sourceVideoFileName || ''),
        projectName: String(item.projectName),
        draftsPath: String(item.draftsPath || ''),
        assetBaseDir: String(item.assetBaseDir || ''),
        clipsDir: String(item.clipsDir || ''),
        sourceVideoCopiedPath: item.sourceVideoCopiedPath ? String(item.sourceVideoCopiedPath) : undefined,
        lastAutoAudioPath: item.lastAutoAudioPath ? String(item.lastAutoAudioPath) : undefined,
        lastAutoAudioUpdatedAt: item.lastAutoAudioUpdatedAt ? String(item.lastAutoAudioUpdatedAt) : undefined,
      }));

    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
      items,
    };
  } catch {
    return buildEmptyIndex();
  }
}

async function writeJsonAtomic(filePath: string, data: CapcutProjectIndexData): Promise<void> {
  const dirPath = path.dirname(filePath);
  if (!fsSync.existsSync(dirPath)) {
    await fs.mkdir(dirPath, { recursive: true });
  }
  const tmpPath = `${filePath}.tmp`;
  const payload = JSON.stringify(data, null, 2);
  await fs.writeFile(tmpPath, payload, 'utf8');
  await fs.rename(tmpPath, filePath);
}

export const capcutProjectIndexStore = {
  normalizeSourceVideoPath,

  getIndexPath(draftsPath: string): string {
    return getIndexPathInternal(draftsPath);
  },

  async load(draftsPath: string): Promise<CapcutProjectIndexData> {
    const indexPath = getIndexPathInternal(draftsPath);
    return await readJsonFile(indexPath);
  },

  async save(draftsPath: string, index: CapcutProjectIndexData): Promise<void> {
    const indexPath = getIndexPathInternal(draftsPath);
    await writeJsonAtomic(indexPath, {
      version: 1,
      updatedAt: nowIso(),
      items: index.items || [],
    });
  },

  async upsert(
    draftsPath: string,
    item: Omit<CapcutProjectIndexItem, 'sourceVideoPath'> & { sourceVideoPath: string },
  ): Promise<void> {
    const normalizedSource = normalizeSourceVideoPath(item.sourceVideoPath);
    const index = await capcutProjectIndexStore.load(draftsPath);
    const nextItem: CapcutProjectIndexItem = {
      ...item,
      sourceVideoPath: normalizedSource,
      sourceVideoFileName: item.sourceVideoFileName || path.basename(item.sourceVideoPath),
      draftsPath: toWindowsLikePath(item.draftsPath),
      assetBaseDir: toWindowsLikePath(item.assetBaseDir),
      clipsDir: toWindowsLikePath(item.clipsDir),
      sourceVideoCopiedPath: item.sourceVideoCopiedPath ? toWindowsLikePath(item.sourceVideoCopiedPath) : undefined,
      lastAutoAudioPath: item.lastAutoAudioPath ? toWindowsLikePath(item.lastAutoAudioPath) : undefined,
      lastAutoAudioUpdatedAt: item.lastAutoAudioUpdatedAt,
    };

    const existingIndex = index.items.findIndex((x) => x.sourceVideoPath === normalizedSource);
    if (existingIndex >= 0) {
      index.items[existingIndex] = nextItem;
    } else {
      index.items.push(nextItem);
    }
    index.updatedAt = nowIso();
    await capcutProjectIndexStore.save(draftsPath, index);
  },

  async findBySourceVideoPath(draftsPath: string, sourceVideoPath: string): Promise<CapcutProjectIndexItem | undefined> {
    const normalizedSource = normalizeSourceVideoPath(sourceVideoPath);
    const index = await capcutProjectIndexStore.load(draftsPath);
    return index.items.find((x) => x.sourceVideoPath === normalizedSource);
  },

  async updateAutoAudio(
    draftsPath: string,
    sourceVideoPath: string,
    audioPath: string,
  ): Promise<void> {
    const normalizedSource = normalizeSourceVideoPath(sourceVideoPath);
    const index = await capcutProjectIndexStore.load(draftsPath);
    const existing = index.items.find((x) => x.sourceVideoPath === normalizedSource);
    if (!existing) return;

    existing.lastAutoAudioPath = toWindowsLikePath(audioPath);
    existing.lastAutoAudioUpdatedAt = nowIso();
    index.updatedAt = nowIso();
    await capcutProjectIndexStore.save(draftsPath, index);
  },
};
