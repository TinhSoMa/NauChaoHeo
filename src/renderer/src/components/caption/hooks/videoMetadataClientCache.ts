type CachedVideoMetadata = {
  width: number;
  height: number;
  actualHeight?: number;
  duration: number;
  fps: number;
};

type MetadataResponse = {
  success: boolean;
  data?: CachedVideoMetadata;
  error?: string;
};

type MetadataCacheEntry = {
  expiresAt: number;
  data: CachedVideoMetadata;
};

const METADATA_CACHE_TTL_MS = 30_000;
const METADATA_CACHE_MAX_ENTRIES = 16;

const metadataCache = new Map<string, MetadataCacheEntry>();
const metadataInFlight = new Map<string, Promise<MetadataResponse>>();

function cloneMetadata(data: CachedVideoMetadata): CachedVideoMetadata {
  return { ...data };
}

function pruneCache(now = Date.now()): void {
  for (const [key, entry] of metadataCache.entries()) {
    if (entry.expiresAt <= now) {
      metadataCache.delete(key);
    }
  }
  while (metadataCache.size > METADATA_CACHE_MAX_ENTRIES) {
    const oldestKey = metadataCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    metadataCache.delete(oldestKey);
  }
}

function readCache(videoPath: string): MetadataResponse | null {
  pruneCache();
  const entry = metadataCache.get(videoPath);
  if (!entry) {
    return null;
  }
  metadataCache.delete(videoPath);
  metadataCache.set(videoPath, entry);
  return {
    success: true,
    data: cloneMetadata(entry.data),
  };
}

function writeCache(videoPath: string, response: MetadataResponse): void {
  if (!response.success || !response.data) {
    return;
  }
  const now = Date.now();
  pruneCache(now);
  metadataCache.set(videoPath, {
    expiresAt: now + METADATA_CACHE_TTL_MS,
    data: cloneMetadata(response.data),
  });
  pruneCache(now);
}

export async function getVideoMetadataCached(videoPath: string): Promise<MetadataResponse> {
  if (!videoPath) {
    return {
      success: false,
      error: 'Đường dẫn video trống.',
    };
  }

  const cached = readCache(videoPath);
  if (cached) {
    return cached;
  }

  const inFlight = metadataInFlight.get(videoPath);
  if (inFlight) {
    return inFlight;
  }

  const task = (async () => {
    try {
      const api = (window.electronAPI as any).captionVideo;
      const response = await api.getVideoMetadata(videoPath) as MetadataResponse;
      writeCache(videoPath, response);
      return response;
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  })();

  metadataInFlight.set(videoPath, task);
  return task.finally(() => {
    metadataInFlight.delete(videoPath);
  });
}

export function clearVideoMetadataClientCache(videoPath?: string): void {
  if (videoPath) {
    metadataCache.delete(videoPath);
    metadataInFlight.delete(videoPath);
    return;
  }
  metadataCache.clear();
  metadataInFlight.clear();
}
