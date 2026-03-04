import { useEffect, useMemo, useState } from 'react';
import { ThumbnailFolderItem } from '../CaptionTypes';
import { getInputPaths } from './captionSessionStore';

interface UseHardsubSettingsOptions {
  inputType: 'srt' | 'draft';
  filePath: string;
  folderVideos: Record<string, { name: string; fullPath: string; duration: number }>;
  thumbnailEnabled: boolean;
  thumbnailTextSecondaryGlobal: string;
}

function normalizeTextForCompare(value: string): string {
  return (value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

export function useHardsubSettings(options: UseHardsubSettingsOptions) {
  const [thumbnailText, setThumbnailText] = useState('');
  const [thumbnailTextsByOrder, setThumbnailTextsByOrder] = useState<string[]>([]);
  const [thumbnailTextSecondary, setThumbnailTextSecondary] = useState(options.thumbnailTextSecondaryGlobal || '');
  const [thumbnailTextsSecondaryByOrder, setThumbnailTextsSecondaryByOrder] = useState<string[]>([]);
  const [thumbnailTextSecondaryOverrideFlags, setThumbnailTextSecondaryOverrideFlags] = useState<boolean[]>([]);
  const [folderOrderSnapshot, setFolderOrderSnapshot] = useState<string[]>([]);
  const [thumbnailAutoStartValue, setThumbnailAutoStartValue] = useState('');

  const selectedDraftPaths = useMemo(
    () => getInputPaths(options.inputType, options.filePath),
    [options.inputType, options.filePath]
  );
  const isMultiFolder = selectedDraftPaths.length > 1;
  const firstFolderPath = selectedDraftPaths[0] ?? '';
  const isThumbnailEnabled = options.thumbnailEnabled;

  useEffect(() => {
    setThumbnailTextSecondary(options.thumbnailTextSecondaryGlobal || '');
  }, [options.thumbnailTextSecondaryGlobal]);

  useEffect(() => {
    const changed = selectedDraftPaths.length !== folderOrderSnapshot.length
      || selectedDraftPaths.some((path, idx) => path !== folderOrderSnapshot[idx]);
    if (!changed) {
      return;
    }

    const prevPaths = folderOrderSnapshot;
    const remapByPath = <T,>(source: T[], fallback: T): T[] =>
      selectedDraftPaths.map((path) => {
        const oldIdx = prevPaths.indexOf(path);
        if (oldIdx < 0) return fallback;
        return source[oldIdx] ?? fallback;
      });

    setFolderOrderSnapshot(selectedDraftPaths);
    setThumbnailTextsByOrder((prev) => remapByPath(prev, ''));
    setThumbnailTextSecondaryOverrideFlags((prev) => remapByPath(prev, false));
    setThumbnailTextsSecondaryByOrder((prev) => {
      const remappedTexts = remapByPath(prev, options.thumbnailTextSecondaryGlobal || '');
      const remappedFlags = remapByPath(thumbnailTextSecondaryOverrideFlags, false);
      return remappedTexts.map((value, idx) =>
        remappedFlags[idx] ? value : (options.thumbnailTextSecondaryGlobal || '')
      );
    });
  }, [
    selectedDraftPaths,
    folderOrderSnapshot,
    options.thumbnailTextSecondaryGlobal,
    thumbnailTextSecondaryOverrideFlags,
  ]);

  useEffect(() => {
    if (!selectedDraftPaths.length) return;
    setThumbnailTextsSecondaryByOrder((prev) => {
      const flags = thumbnailTextSecondaryOverrideFlags.length === selectedDraftPaths.length
        ? thumbnailTextSecondaryOverrideFlags
        : new Array(selectedDraftPaths.length).fill(false);
      const next = prev.length === selectedDraftPaths.length
        ? [...prev]
        : new Array(selectedDraftPaths.length).fill(options.thumbnailTextSecondaryGlobal || '');
      for (let i = 0; i < selectedDraftPaths.length; i++) {
        if (!flags[i]) {
          next[i] = options.thumbnailTextSecondaryGlobal || '';
        }
      }
      return next;
    });
  }, [options.thumbnailTextSecondaryGlobal, selectedDraftPaths, thumbnailTextSecondaryOverrideFlags]);

  const updateThumbnailTextByOrder = (idx: number, value: string) => {
    setThumbnailTextsByOrder(prev => {
      const next = prev.length === selectedDraftPaths.length
        ? [...prev]
        : new Array(selectedDraftPaths.length).fill('');
      next[idx] = value;
      return next;
    });
  };

  const setThumbnailTextSecondaryGlobal = (value: string) => {
    const prevGlobalNormalized = normalizeTextForCompare(thumbnailTextSecondary);
    setThumbnailTextSecondary(value);
    if (!selectedDraftPaths.length) return;
    setThumbnailTextSecondaryOverrideFlags((prev) => {
      const nextFlags = prev.length === selectedDraftPaths.length
        ? [...prev]
        : new Array(selectedDraftPaths.length).fill(false);
      for (let i = 0; i < nextFlags.length; i++) {
        const currentText = thumbnailTextsSecondaryByOrder[i] || '';
        // Backward-compat: nếu text đang trùng global cũ (khác chỉ do CRLF/trim),
        // coi như không override để global mới được áp dụng.
        if (normalizeTextForCompare(currentText) === prevGlobalNormalized) {
          nextFlags[i] = false;
        }
      }
      return nextFlags;
    });
    setThumbnailTextsSecondaryByOrder((prev) => {
      const flags = thumbnailTextSecondaryOverrideFlags.length === selectedDraftPaths.length
        ? thumbnailTextSecondaryOverrideFlags
        : new Array(selectedDraftPaths.length).fill(false);
      const next = prev.length === selectedDraftPaths.length
        ? [...prev]
        : new Array(selectedDraftPaths.length).fill('');
      for (let i = 0; i < next.length; i++) {
        const isAutoBound = !flags[i] || normalizeTextForCompare(next[i] || '') === prevGlobalNormalized;
        if (isAutoBound) {
          next[i] = value;
        }
      }
      return next;
    });
  };

  const setThumbnailTextSecondaryByOrder = (idx: number, value: string) => {
    setThumbnailTextsSecondaryByOrder((prev) => {
      const next = prev.length === selectedDraftPaths.length
        ? [...prev]
        : new Array(selectedDraftPaths.length).fill(options.thumbnailTextSecondaryGlobal || '');
      next[idx] = value;
      return next;
    });
    setThumbnailTextSecondaryOverrideFlags((prev) => {
      const next = prev.length === selectedDraftPaths.length
        ? [...prev]
        : new Array(selectedDraftPaths.length).fill(false);
      next[idx] = true;
      return next;
    });
  };

  const resetThumbnailTextSecondaryOverride = (idx: number) => {
    setThumbnailTextSecondaryOverrideFlags((prev) => {
      const next = prev.length === selectedDraftPaths.length
        ? [...prev]
        : new Array(selectedDraftPaths.length).fill(false);
      next[idx] = false;
      return next;
    });
    setThumbnailTextsSecondaryByOrder((prev) => {
      const next = prev.length === selectedDraftPaths.length
        ? [...prev]
        : new Array(selectedDraftPaths.length).fill(options.thumbnailTextSecondaryGlobal || '');
      next[idx] = options.thumbnailTextSecondaryGlobal || '';
      return next;
    });
  };

  const setSecondaryStateFromSession = (texts: string[], overrideFlagsFromSession?: boolean[]) => {
    const normalized = selectedDraftPaths.map((_, idx) => texts[idx] || '');
    const global = options.thumbnailTextSecondaryGlobal || '';
    const normalizedGlobal = normalizeTextForCompare(global);
    const resolvedFlags = overrideFlagsFromSession && overrideFlagsFromSession.length === selectedDraftPaths.length
      ? [...overrideFlagsFromSession]
      : normalized.map((text) => normalizeTextForCompare(text) !== normalizedGlobal);
    setThumbnailTextsSecondaryByOrder(normalized);
    setThumbnailTextSecondaryOverrideFlags(resolvedFlags);
  };

  const handleAutoFillThumbnailByEpisode = () => {
    const normalized = thumbnailAutoStartValue.trim();
    const match = normalized.match(/-?\d+/);
    if (!match) {
      return;
    }
    const startEpisode = Number.parseInt(match[0], 10);
    if (!Number.isFinite(startEpisode)) {
      return;
    }
    const generated = selectedDraftPaths.map((_, idx) => `Tập ${startEpisode + idx}`);
    setThumbnailTextsByOrder(generated);
  };

  const thumbnailFolderItems: ThumbnailFolderItem[] = isMultiFolder
    ? selectedDraftPaths.map((folderPath, idx) => {
        const folderName = folderPath.split(/[/\\]/).pop() || folderPath;
        const videoName = options.folderVideos[folderPath]?.name || 'Chưa tìm thấy video';
        const text = thumbnailTextsByOrder[idx] || '';
        const secondaryText = thumbnailTextsSecondaryByOrder[idx] || '';
        const secondaryOverridden = !!thumbnailTextSecondaryOverrideFlags[idx];
        return {
          index: idx + 1,
          folderPath,
          folderName,
          videoName,
          text,
          secondaryText,
          secondaryOverridden,
          hasError: isThumbnailEnabled && !text.trim(),
        };
      })
    : [];
  const hasMissingThumbnailText = thumbnailFolderItems.some(item => item.hasError);

  return {
    thumbnailText,
    setThumbnailText,
    thumbnailTextsByOrder,
    setThumbnailTextsByOrder,
    thumbnailTextSecondary,
    setThumbnailTextSecondary,
    setThumbnailTextSecondaryGlobal,
    thumbnailTextsSecondaryByOrder,
    setThumbnailTextsSecondaryByOrder,
    setSecondaryStateFromSession,
    thumbnailTextSecondaryOverrideFlags,
    setThumbnailTextSecondaryOverrideFlags,
    thumbnailAutoStartValue,
    setThumbnailAutoStartValue,
    selectedDraftPaths,
    isMultiFolder,
    firstFolderPath,
    isThumbnailEnabled,
    thumbnailFolderItems,
    hasMissingThumbnailText,
    updateThumbnailTextByOrder,
    setThumbnailTextSecondaryByOrder,
    resetThumbnailTextSecondaryOverride,
    handleAutoFillThumbnailByEpisode,
  };
}
