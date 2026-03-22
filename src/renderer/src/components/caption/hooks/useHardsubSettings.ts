import { useEffect, useMemo, useState } from 'react';
import { ThumbnailFolderItem } from '../CaptionTypes';
import { getInputPaths } from './captionSessionStore';

interface UseHardsubSettingsOptions {
  inputType: 'srt' | 'draft';
  filePath: string;
  folderVideos: Record<string, { name: string; fullPath: string; duration: number }>;
  thumbnailEnabled: boolean;
}

type BulkThumbnailRow = {
  indexZeroBased: number;
  text1: string;
  text2?: string;
};

export function useHardsubSettings(options: UseHardsubSettingsOptions) {
  const [thumbnailText, setThumbnailText] = useState('');
  const [thumbnailTextsByOrder, setThumbnailTextsByOrder] = useState<string[]>([]);
  const [thumbnailTextSecondary, setThumbnailTextSecondary] = useState('');
  const [thumbnailTextsSecondaryByOrder, setThumbnailTextsSecondaryByOrder] = useState<string[]>([]);
  const [videoText, setVideoText] = useState('');
  const [videoTextsByOrder, setVideoTextsByOrder] = useState<string[]>([]);
  const [videoTextSecondary, setVideoTextSecondary] = useState('');
  const [videoTextsSecondaryByOrder, setVideoTextsSecondaryByOrder] = useState<string[]>([]);
  const [folderOrderSnapshot, setFolderOrderSnapshot] = useState<string[]>([]);
  const [thumbnailAutoStartValue, setThumbnailAutoStartValueState] = useState('');

  const selectedDraftPaths = useMemo(
    () => getInputPaths(options.inputType, options.filePath),
    [options.inputType, options.filePath]
  );
  const isMultiFolder = selectedDraftPaths.length > 1;
  const firstFolderPath = selectedDraftPaths[0] ?? '';
  const isThumbnailEnabled = options.thumbnailEnabled;

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
    setThumbnailTextsSecondaryByOrder((prev) => remapByPath(prev, ''));
    setVideoTextsByOrder((prev) => remapByPath(prev, ''));
    setVideoTextsSecondaryByOrder((prev) => remapByPath(prev, ''));
  }, [
    selectedDraftPaths,
    folderOrderSnapshot,
  ]);

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
    setThumbnailTextSecondary(value);
  };

  const applyText2GlobalToAll = (value: string) => {
    if (!selectedDraftPaths.length) return;
    setThumbnailTextsSecondaryByOrder((prev) => {
      const next = prev.length === selectedDraftPaths.length
        ? [...prev]
        : new Array(selectedDraftPaths.length).fill('');
      for (let i = 0; i < next.length; i++) {
        next[i] = value;
      }
      return next;
    });
  };

  const setThumbnailTextSecondaryByOrder = (idx: number, value: string) => {
    setThumbnailTextsSecondaryByOrder((prev) => {
      const next = prev.length === selectedDraftPaths.length
        ? [...prev]
        : new Array(selectedDraftPaths.length).fill('');
      next[idx] = value;
      return next;
    });
  };

  const updateVideoTextByOrder = (idx: number, value: string) => {
    setVideoTextsByOrder((prev) => {
      const next = prev.length === selectedDraftPaths.length
        ? [...prev]
        : new Array(selectedDraftPaths.length).fill('');
      next[idx] = value;
      return next;
    });
  };

  const setVideoTextSecondaryByOrder = (idx: number, value: string) => {
    setVideoTextsSecondaryByOrder((prev) => {
      const next = prev.length === selectedDraftPaths.length
        ? [...prev]
        : new Array(selectedDraftPaths.length).fill('');
      next[idx] = value;
      return next;
    });
  };

  const syncVideoText1FromThumbnail = () => {
    if (isMultiFolder) {
      setVideoTextsByOrder((prev) => {
        const next = prev.length === selectedDraftPaths.length
          ? [...prev]
          : new Array(selectedDraftPaths.length).fill('');
        for (let i = 0; i < selectedDraftPaths.length; i++) {
          next[i] = thumbnailTextsByOrder[i] || '';
        }
        return next;
      });
      return;
    }
    setVideoText(thumbnailText || '');
  };

  const syncVideoText2FromThumbnail = () => {
    if (isMultiFolder) {
      setVideoTextsSecondaryByOrder((prev) => {
        const next = prev.length === selectedDraftPaths.length
          ? [...prev]
          : new Array(selectedDraftPaths.length).fill('');
        for (let i = 0; i < selectedDraftPaths.length; i++) {
          next[i] = thumbnailTextsSecondaryByOrder[i] || '';
        }
        return next;
      });
      return;
    }
    setVideoTextSecondary(thumbnailTextSecondary || '');
  };

  const setSecondaryStateFromSession = (texts: string[]) => {
    const normalized = selectedDraftPaths.map((_, idx) => texts[idx] || '');
    setThumbnailTextsSecondaryByOrder(normalized);
  };

  const autoFillThumbnailByEpisode = (rawValue: string) => {
    const normalized = rawValue.trim();
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

  const handleThumbnailAutoStartValueChange = (value: string) => {
    setThumbnailAutoStartValueState(value);
    autoFillThumbnailByEpisode(value);
  };

  const applyBulkThumbnailByOrder = (rows: BulkThumbnailRow[]): { appliedText1: number; appliedText2: number } => {
    if (!selectedDraftPaths.length || !rows.length) {
      return { appliedText1: 0, appliedText2: 0 };
    }
    const maxItems = selectedDraftPaths.length;
    const normalizedRows = rows
      .map((row) => ({
        indexZeroBased: row.indexZeroBased,
        text1: (row.text1 || '').trim(),
        hasText2: Object.prototype.hasOwnProperty.call(row, 'text2'),
        text2: typeof row.text2 === 'string' ? row.text2.trim() : '',
      }))
      .filter((row) => (
        Number.isInteger(row.indexZeroBased)
        && row.indexZeroBased >= 0
        && row.indexZeroBased < maxItems
        && row.text1.length > 0
      ));

    if (!normalizedRows.length) {
      return { appliedText1: 0, appliedText2: 0 };
    }

    const text2Rows = normalizedRows.filter((row) => row.hasText2);

    setThumbnailTextsByOrder((prev) => {
      const next = prev.length === maxItems
        ? [...prev]
        : new Array(maxItems).fill('');
      normalizedRows.forEach((row) => {
        next[row.indexZeroBased] = row.text1;
      });
      return next;
    });

    if (text2Rows.length > 0) {
      setThumbnailTextsSecondaryByOrder((prev) => {
        const next = prev.length === maxItems
          ? [...prev]
          : new Array(maxItems).fill('');
        text2Rows.forEach((row) => {
          next[row.indexZeroBased] = row.text2;
        });
        return next;
      });
    }

    return { appliedText1: normalizedRows.length, appliedText2: text2Rows.length };
  };

  const thumbnailFolderItems: ThumbnailFolderItem[] = isMultiFolder
    ? selectedDraftPaths.map((folderPath, idx) => {
        const folderName = folderPath.split(/[/\\]/).pop() || folderPath;
        const videoName = options.folderVideos[folderPath]?.name || 'Chưa tìm thấy video';
        const text = thumbnailTextsByOrder[idx] || '';
        const secondaryText = thumbnailTextsSecondaryByOrder[idx] || '';
        const videoTextValue = videoTextsByOrder[idx] || '';
        const videoSecondaryTextValue = videoTextsSecondaryByOrder[idx] || '';
        return {
          index: idx + 1,
          folderPath,
          folderName,
          videoName,
          text,
          secondaryText,
          videoText: videoTextValue,
          videoSecondaryText: videoSecondaryTextValue,
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
    applyText2GlobalToAll,
    thumbnailTextsSecondaryByOrder,
    setThumbnailTextsSecondaryByOrder,
    videoText,
    setVideoText,
    videoTextSecondary,
    setVideoTextSecondary,
    videoTextsByOrder,
    setVideoTextsByOrder,
    videoTextsSecondaryByOrder,
    setVideoTextsSecondaryByOrder,
    updateVideoTextByOrder,
    setVideoTextSecondaryByOrder,
    syncVideoText1FromThumbnail,
    syncVideoText2FromThumbnail,
    setSecondaryStateFromSession,
    thumbnailAutoStartValue,
    setThumbnailAutoStartValue: handleThumbnailAutoStartValueChange,
    handleThumbnailAutoStartValueChange,
    selectedDraftPaths,
    isMultiFolder,
    firstFolderPath,
    isThumbnailEnabled,
    thumbnailFolderItems,
    hasMissingThumbnailText,
    updateThumbnailTextByOrder,
    setThumbnailTextSecondaryByOrder,
    applyBulkThumbnailByOrder,
    handleAutoFillThumbnailByEpisode: () => autoFillThumbnailByEpisode(thumbnailAutoStartValue),
  };
}
