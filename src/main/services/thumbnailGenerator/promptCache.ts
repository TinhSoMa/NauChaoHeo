import { createHash } from 'crypto';

interface CacheEntry {
  enhancedPrompt: string
  timestamp: number
}

export class PromptCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize = 100, ttlMinutes = 60) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMinutes * 60 * 1000;
  }

  private generateKey(prompt: string): string {
    return createHash('md5').update(prompt.trim().toLowerCase()).digest('hex');
  }

  get(originalPrompt: string): string | null {
    const key = this.generateKey(originalPrompt);
    const cached = this.cache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    return cached.enhancedPrompt;
  }

  set(originalPrompt: string, enhancedPrompt: string): void {
    const key = this.generateKey(originalPrompt);
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, { enhancedPrompt, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): { size: number; maxSize: number; ttlMinutes: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMinutes: this.ttlMs / (60 * 1000),
    };
  }
}
