/**
 * useProjectFeatureState - Hook tái sử dụng để lưu/load state của feature vào project
 * 
 * Pattern được trích xuất từ StoryTranslator, StorySummary, CaptionTranslator.
 * Bất kỳ feature nào cần lưu state vào project đều có thể dùng hook này.
 * 
 * === CÁCH SỬ DỤNG ===
 * 
 * ```tsx
 * const [name, setName] = useState('');
 * const [count, setCount] = useState(0);
 * 
 * useProjectFeatureState({
 *   feature: 'caption',
 *   fileName: 'my-state.json',
 *   serialize: () => ({ name, count }),
 *   deserialize: (saved) => {
 *     if (saved.name) setName(saved.name);
 *     if (typeof saved.count === 'number') setCount(saved.count);
 *   },
 *   deps: [name, count],
 * });
 * ```
 * 
 * Hook sẽ tự động:
 * - Load state từ file khi component mount (projectId/paths thay đổi)
 * - Auto-save với debounce khi bất kỳ dep nào thay đổi
 * - Chỉ save SAU KHI đã load xong (tránh ghi đè dữ liệu cũ bằng default)
 */

import { useEffect, useRef } from 'react';
import { useProjectContext } from '../context/ProjectContext';
import type { ProjectFeature } from '@shared/types/project';

interface UseProjectFeatureStateOptions<T> {
  /** Feature folder: 'story' | 'caption' | 'tts' | 'gemini' */
  feature: ProjectFeature;
  /** Tên file JSON để lưu, ví dụ: 'caption-state.json' */
  fileName: string;
  /** Hàm serialize: trả về object chứa toàn bộ state cần lưu */
  serialize: () => T;
  /** Hàm deserialize: nhận dữ liệu đã lưu và restore lại các state (hỗ trợ async) */
  deserialize: (saved: T) => void | Promise<void>;
  /** Dependencies - khi bất kỳ giá trị nào thay đổi sẽ trigger auto-save */
  deps: unknown[];
  /** Thời gian debounce (ms). Mặc định 500ms */
  debounceMs?: number;
  /** Callback sau khi load xong (dù thành công hay thất bại) */
  onLoaded?: () => void;
  /**
   * Custom load function thay thế hoàn toàn logic đọc file + deserialize mặc định.
   * Hữu ích khi cần load từ nhiều file (ví dụ: StorySummary đọc cả translator + summary).
   * Hook vẫn quản lý hasLoadedRef và auto-save.
   */
  customLoad?: () => Promise<void>;
}

interface UseProjectFeatureStateReturn {
  /** Đã load xong chưa */
  loaded: boolean;
  /** Gọi thủ công để save ngay (không debounce) */
  save: () => Promise<void>;
  /** Gọi thủ công để load lại */
  load: () => Promise<void>;
  /** projectId hiện tại */
  projectId: string | null;
}

export function useProjectFeatureState<T>(
  options: UseProjectFeatureStateOptions<T>
): UseProjectFeatureStateReturn {
  const { feature, fileName, deps, debounceMs = 500, onLoaded } = options;
  const { projectId, paths } = useProjectContext();
  const hasLoadedRef = useRef(false);
  const saveTimeoutRef = useRef<number | null>(null);

  // Dùng ref để tránh stale closure trong async functions
  const serializeRef = useRef(options.serialize);
  const deserializeRef = useRef(options.deserialize);
  const customLoadRef = useRef(options.customLoad);
  serializeRef.current = options.serialize;
  deserializeRef.current = options.deserialize;
  customLoadRef.current = options.customLoad;

  // Ref cho projectId để dùng trong async functions
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const loadState = async () => {
    if (!projectIdRef.current) return;

    try {
      if (customLoadRef.current) {
        // Custom load: component tự quản lý việc đọc file(s)
        await customLoadRef.current();
      } else {
        // Default: đọc 1 file JSON và gọi deserialize
        const res = await window.electronAPI.project.readFeatureFile({
          projectId: projectIdRef.current,
          feature,
          fileName
        });

        if (res?.success && res.data) {
          const saved = JSON.parse(res.data) as T;
          await deserializeRef.current(saved);
        }
      }
    } catch (err) {
      console.error(`[useProjectFeatureState] Lỗi load ${feature}/${fileName}:`, err);
    } finally {
      hasLoadedRef.current = true;
      onLoaded?.();
    }
  };

  const saveState = async () => {
    if (!projectIdRef.current) return;

    try {
      const payload = serializeRef.current();
      await window.electronAPI.project.writeFeatureFile({
        projectId: projectIdRef.current,
        feature,
        fileName,
        content: payload
      });
    } catch (err) {
      console.error(`[useProjectFeatureState] Lỗi save ${feature}/${fileName}:`, err);
    }
  };

  // Load khi mount hoặc khi projectId/paths thay đổi
  useEffect(() => {
    if (!projectId || !paths) return;
    hasLoadedRef.current = false;
    loadState();
  }, [projectId, paths]);

  // Auto-save với debounce khi deps thay đổi
  // Chỉ save sau khi đã load xong (tránh ghi đè default lên dữ liệu cũ)
  useEffect(() => {
    if (!projectId || !paths || !hasLoadedRef.current) return;

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      saveState();
    }, debounceMs);

    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [projectId, paths, ...deps]);

  return {
    loaded: hasLoadedRef.current,
    save: saveState,
    load: loadState,
    projectId,
  };
}
