/**
 * ProgressTracker
 * 
 * Centralized tracking of translation progress and timing metrics.
 * Removes timer management responsibility from UI layer.
 */

export interface ChapterMetrics {
  chapterId: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface TranslationMetrics {
  totalChapters: number;
  completedChapters: number;
  failedChapters: number;
  totalDuration: number;
  averageDuration: number;
  currentChapter?: ChapterMetrics;
}

export class ProgressTracker {
  private chapters: Map<string, ChapterMetrics> = new Map();
  private currentChapterId: string | null = null;
  private waitingStartTime: number = 0;
  private sessionStartTime: number = 0;

  /**
   * Start tracking a new translation session
   */
  startSession(): void {
    this.chapters.clear();
    this.currentChapterId = null;
    this.waitingStartTime = 0;
    this.sessionStartTime = Date.now();
    console.log('[ProgressTracker] Session started');
  }

  /**
   * Start tracking a chapter translation
   */
  startChapter(chapterId: string): void {
    const metrics: ChapterMetrics = {
      chapterId,
      startTime: Date.now(),
      status: 'processing'
    };

    this.chapters.set(chapterId, metrics);
    this.currentChapterId = chapterId;

    console.log(`[ProgressTracker] Chapter started: ${chapterId}`);
  }

  /**
   * Mark chapter as completed and return duration in milliseconds
   */
  completeChapter(chapterId: string): number {
    const metrics = this.chapters.get(chapterId);
    if (!metrics) {
      console.warn(`[ProgressTracker] Chapter not found: ${chapterId}`);
      return 0;
    }

    const endTime = Date.now();
    const duration = endTime - metrics.startTime;

    metrics.endTime = endTime;
    metrics.duration = duration;
    metrics.status = 'completed';

    this.chapters.set(chapterId, metrics);

    if (this.currentChapterId === chapterId) {
      this.currentChapterId = null;
    }

    console.log(`[ProgressTracker] Chapter completed: ${chapterId} (${duration}ms)`);
    return duration;
  }

  /**
   * Mark chapter as failed
   */
  failChapter(chapterId: string, error?: string): void {
    const metrics = this.chapters.get(chapterId);
    if (!metrics) {
      console.warn(`[ProgressTracker] Chapter not found: ${chapterId}`);
      return;
    }

    metrics.endTime = Date.now();
    metrics.duration = metrics.endTime - metrics.startTime;
    metrics.status = 'failed';

    this.chapters.set(chapterId, metrics);

    if (this.currentChapterId === chapterId) {
      this.currentChapterId = null;
    }

    console.log(`[ProgressTracker] Chapter failed: ${chapterId}`, error);
  }

  /**
   * Start waiting timer (for response waiting)
   */
  startWaiting(): void {
    this.waitingStartTime = Date.now();
  }

  /**
   * Stop waiting timer and return duration in seconds
   */
  stopWaiting(): number {
    if (this.waitingStartTime === 0) return 0;

    const duration = Math.floor((Date.now() - this.waitingStartTime) / 1000);
    this.waitingStartTime = 0;

    return duration;
  }

  /**
   * Get current waiting duration in seconds
   */
  getWaitingDuration(): number {
    if (this.waitingStartTime === 0) return 0;
    return Math.floor((Date.now() - this.waitingStartTime) / 1000);
  }

  /**
   * Get metrics for a specific chapter
   */
  getChapterMetrics(chapterId: string): ChapterMetrics | undefined {
    return this.chapters.get(chapterId);
  }

  /**
   * Get all chapter metrics
   */
  getAllMetrics(): ChapterMetrics[] {
    return Array.from(this.chapters.values());
  }

  /**
   * Get aggregated translation metrics
   */
  getTranslationMetrics(): TranslationMetrics {
    const completed = Array.from(this.chapters.values()).filter(
      m => m.status === 'completed'
    );
    const failed = Array.from(this.chapters.values()).filter(
      m => m.status === 'failed'
    );

    const totalDuration = completed.reduce((sum, m) => sum + (m.duration || 0), 0);
    const averageDuration = completed.length > 0 ? totalDuration / completed.length : 0;

    const currentMetrics = this.currentChapterId
      ? this.chapters.get(this.currentChapterId)
      : undefined;

    return {
      totalChapters: this.chapters.size,
      completedChapters: completed.length,
      failedChapters: failed.length,
      totalDuration,
      averageDuration,
      currentChapter: currentMetrics
    };
  }

  /**
   * Get processing times map (for backward compatibility)
   */
  getProcessingTimes(): Map<string, number> {
    const times = new Map<string, number>();
    
    for (const [id, metrics] of this.chapters) {
      if (metrics.duration !== undefined) {
        times.set(id, metrics.duration);
      }
    }

    return times;
  }

  /**
   * Get session duration in milliseconds
   */
  getSessionDuration(): number {
    if (this.sessionStartTime === 0) return 0;
    return Date.now() - this.sessionStartTime;
  }

  /**
   * Reset all tracking
   */
  reset(): void {
    this.chapters.clear();
    this.currentChapterId = null;
    this.waitingStartTime = 0;
    this.sessionStartTime = 0;
    console.log('[ProgressTracker] Reset');
  }

  /**
   * Check if a chapter is being tracked
   */
  isTracking(chapterId: string): boolean {
    return this.chapters.has(chapterId);
  }

  /**
   * Get current chapter being processed
   */
  getCurrentChapter(): string | null {
    return this.currentChapterId;
  }
}

// Singleton instance for UI usage
let instance: ProgressTracker | null = null;

export function getProgressTracker(): ProgressTracker {
  if (!instance) {
    instance = new ProgressTracker();
  }
  return instance;
}
