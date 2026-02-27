import { useEffect, useMemo, useState } from 'react';
import { ThumbnailFolderItem } from '../CaptionTypes';

interface UseHardsubSettingsOptions {
  inputType: 'srt' | 'draft';
  filePath: string;
  folderVideos: Record<string, { name: string; fullPath: string; duration: number }>;
}

export function useHardsubSettings(options: UseHardsubSettingsOptions) {
  const [subtitlePosition, setSubtitlePosition] = useState<{ x: number; y: number } | null>(null);
  const [thumbnailFrameTimeSec, setThumbnailFrameTimeSec] = useState<number | null>(null);
  const [thumbnailText, setThumbnailText] = useState('');
  const [thumbnailTextsByOrder, setThumbnailTextsByOrder] = useState<string[]>([]);
  const [folderOrderSnapshot, setFolderOrderSnapshot] = useState<string[]>([]);
  const [thumbnailAutoStartValue, setThumbnailAutoStartValue] = useState('');

  const selectedDraftPaths = useMemo(
    () => (options.inputType === 'draft' && options.filePath ? options.filePath.split('; ') : []),
    [options.inputType, options.filePath]
  );
  const isMultiFolder = selectedDraftPaths.length > 1;
  const firstFolderPath = selectedDraftPaths[0] ?? '';
  const isThumbnailEnabled = thumbnailFrameTimeSec !== null && thumbnailFrameTimeSec !== undefined;

  useEffect(() => {
    const changed = selectedDraftPaths.length !== folderOrderSnapshot.length
      || selectedDraftPaths.some((path, idx) => path !== folderOrderSnapshot[idx]);
    if (!changed) {
      return;
    }

    setFolderOrderSnapshot(selectedDraftPaths);
    setThumbnailTextsByOrder(new Array(selectedDraftPaths.length).fill(''));
  }, [selectedDraftPaths, folderOrderSnapshot]);

  const updateThumbnailTextByOrder = (idx: number, value: string) => {
    setThumbnailTextsByOrder(prev => {
      const next = prev.length === selectedDraftPaths.length
        ? [...prev]
        : new Array(selectedDraftPaths.length).fill('');
      next[idx] = value;
      return next;
    });
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
        return {
          index: idx + 1,
          folderPath,
          folderName,
          videoName,
          text,
          hasError: isThumbnailEnabled && !text.trim(),
        };
      })
    : [];
  const hasMissingThumbnailText = thumbnailFolderItems.some(item => item.hasError);

  return {
    subtitlePosition,
    setSubtitlePosition,
    thumbnailFrameTimeSec,
    setThumbnailFrameTimeSec,
    thumbnailText,
    setThumbnailText,
    thumbnailTextsByOrder,
    setThumbnailTextsByOrder,
    thumbnailAutoStartValue,
    setThumbnailAutoStartValue,
    selectedDraftPaths,
    isMultiFolder,
    firstFolderPath,
    isThumbnailEnabled,
    thumbnailFolderItems,
    hasMissingThumbnailText,
    updateThumbnailTextByOrder,
    handleAutoFillThumbnailByEpisode,
  };
}
