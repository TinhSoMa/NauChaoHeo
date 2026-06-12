import { useState, useCallback, useEffect, useRef } from 'react';
import { SubtitleEntry } from '../CaptionTypes';
import { InputType } from '../../../config/captionConfig';
import { useProjectContext } from '../../../context/ProjectContext';
import {
  getInputPaths,
  getSessionPathForInputPath,
  readCaptionSession,
  updateCaptionSession,
  compactEntries,
  toStepKey,
  makeStepSuccess,
} from './captionSessionStore';

interface UseCaptionFileManagementProps {
  inputType: InputType;
  videoSelectionAudioMode?: 'all' | 'with_audio' | 'without_audio';
  onProgress?: (progress: { current: number; total: number; message: string }) => void;
}

export function useCaptionFileManagement({ inputType, videoSelectionAudioMode = 'all', onProgress }: UseCaptionFileManagementProps) {
  const { projectId } = useProjectContext();
  const [filePath, setFilePath] = useState('');
  const [entries, setEntries] = useState<SubtitleEntry[]>([]);
  const [folderVideos, setFolderVideos] = useState<Record<string, { name: string; fullPath: string; duration: number; hasAudio?: boolean }>>({});
  const [srtFilesByFolder, setSrtFilesByFolder] = useState<Record<string, string>>({});
  const [missingSrtFolders, setMissingSrtFolders] = useState<Set<string>>(new Set());
  const srtFilesByFolderRef = useRef<Record<string, string>>({});
  const storageKey = `caption:lastInput:${projectId || 'global'}:${inputType}`;

  useEffect(() => {
    srtFilesByFolderRef.current = srtFilesByFolder;
  }, [srtFilesByFolder]);

  useEffect(() => {
    if (filePath) return;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved && saved.trim()) {
        setFilePath(saved);
        if (import.meta?.env?.DEV) {
          console.log('[CaptionFileManagement] Restore last input', {
            inputType,
            filePath: saved,
            storageKey,
          });
        }
      }
    } catch (error) {
      console.warn('[CaptionFileManagement] Không đọc được localStorage last input', error);
    }
  }, [filePath, storageKey]);

  useEffect(() => {
    if (!filePath) return;
    try {
      window.localStorage.setItem(storageKey, filePath);
    } catch (error) {
      console.warn('[CaptionFileManagement] Không lưu được localStorage last input', error);
    }
  }, [filePath, storageKey]);

  const normalizeFolderPath = useCallback((value: string): string => {
    return (value || '').trim().replace(/[\\/]+$/, '');
  }, []);

  const normalizePathForCompare = useCallback((value: string): string => {
    return (value || '')
      .trim()
      .replace(/[\\/]+/g, '/')
      .replace(/\/+$/, '');
  }, []);

  const isDirectChildFile = useCallback((folderPath: string, filePath: string): boolean => {
    const folderNorm = normalizePathForCompare(folderPath);
    const fileNorm = normalizePathForCompare(filePath);
    if (!folderNorm || !fileNorm) return false;
    const lastSlash = fileNorm.lastIndexOf('/');
    if (lastSlash <= 0) return false;
    const parentDir = fileNorm.slice(0, lastSlash);
    return parentDir === folderNorm;
  }, [normalizePathForCompare]);

  const updateMissingSrt = useCallback((paths: string[], map: Record<string, string>) => {
    const missing = new Set<string>();
    for (const p of paths) {
      if (!map[p]) {
        missing.add(p);
      }
    }
    setMissingSrtFolders(missing);
  }, []);

  const hydrateSrtEntries = useCallback(async (folderPath: string, srtPath: string) => {
    if (!folderPath || !srtPath) return;
    try {
      // @ts-ignore
      const parseResult = await window.electronAPI.caption.parseSrt(srtPath);
      if (!parseResult?.success || !parseResult.data) return;
      const parsedData = parseResult.data;
      setEntries(parsedData.entries);
      const sessionPath = getSessionPathForInputPath('srt', folderPath);
      await updateCaptionSession(
        sessionPath,
        (session) => {
          const stepKey = toStepKey(1);
          return {
            ...session,
            projectContext: {
              ...session.projectContext,
              projectId: projectId || null,
              inputType: 'srt',
              sourcePath: srtPath,
              folderPath,
            },
            data: {
              ...session.data,
              extractedEntries: compactEntries(parsedData.entries),
            },
            steps: {
              ...session.steps,
              [stepKey]: makeStepSuccess(session.steps[stepKey], {
                totalEntries: parsedData.totalEntries,
                source: 'browse_srt',
              }),
            },
          };
        },
        {
          projectId,
          inputType: 'srt',
          sourcePath: srtPath,
          folderPath,
        }
      );
      if (onProgress) {
        onProgress({
          current: 0,
          total: parsedData.totalEntries,
          message: `Đã load ${parsedData.totalEntries} dòng từ SRT`,
        });
      }
    } catch (error) {
      console.warn('[CaptionFileManagement] Không thể parse SRT:', error);
    }
  }, [onProgress, projectId]);

  const handleBrowseFile = useCallback(async () => {
    try {
      let filters = undefined;
      let properties = ['openFile'];

      if (inputType === 'srt') {
        properties = ['openDirectory', 'multiSelections'];
      } else if (inputType === 'draft') {
        properties = ['openDirectory', 'multiSelections'];
      }

      // @ts-ignore - electronAPI is globally defined
      const result = await window.electronAPI.invoke('dialog:openFile', { filters, properties }) as { 
        canceled: boolean; 
        filePaths: string[] 
      };

      if (result?.canceled || !result?.filePaths?.length) return;

      if (inputType === 'draft') {
        const selectedPaths = result.filePaths;
        setFilePath(selectedPaths.join('; '));
        setEntries([]);
        for (const selectedPath of selectedPaths) {
          const sessionPath = getSessionPathForInputPath('draft', selectedPath);
          await updateCaptionSession(
            sessionPath,
            (session) => ({
              ...session,
              projectContext: {
                ...session.projectContext,
                projectId: projectId || null,
                inputType: 'draft',
                sourcePath: selectedPath,
                folderPath: selectedPath,
              },
            }),
            { projectId, inputType: 'draft', sourcePath: selectedPath, folderPath: selectedPath }
          );
        }
        if (onProgress) {
            onProgress({ 
            current: 0, 
            total: selectedPaths.length, 
            message: `Đã chọn ${selectedPaths.length} thư mục dự án CapCut` 
            });
        }
        return;
      }

      if (inputType === 'srt') {
        const selectedPaths = result.filePaths
          .map((p) => p.trim())
          .filter(Boolean);
        setFilePath(selectedPaths.join('; '));
        setEntries([]);
        if (onProgress) {
          onProgress({
            current: 0,
            total: selectedPaths.length,
            message: `Đã chọn ${selectedPaths.length} thư mục SRT`,
          });
        }
        return;
      }

      const selectedPath = result.filePaths[0];
      setFilePath(selectedPath);

      // Parse depending on file type
      // @ts-ignore
      const parseResult = inputType === 'srt'
        ? await window.electronAPI.caption.parseSrt(selectedPath)
        : await window.electronAPI.caption.parseDraft(selectedPath);

      if (parseResult.success && parseResult.data) {
        const parsedData = parseResult.data;
        setEntries(parsedData.entries);
        const sessionPath = getSessionPathForInputPath('srt', selectedPath);
        await updateCaptionSession(
          sessionPath,
          (session) => {
            const stepKey = toStepKey(1);
            return {
              ...session,
              projectContext: {
                ...session.projectContext,
                projectId: projectId || null,
                inputType: 'srt',
                sourcePath: selectedPath,
                folderPath: selectedPath.replace(/[^/\\]+$/, ''),
              },
              data: {
                ...session.data,
                extractedEntries: compactEntries(parsedData.entries),
              },
              steps: {
                ...session.steps,
                [stepKey]: makeStepSuccess(session.steps[stepKey], {
                  totalEntries: parsedData.totalEntries,
                  source: 'browse_srt',
                }),
              },
            };
          },
          {
            projectId,
            inputType: 'srt',
            sourcePath: selectedPath,
            folderPath: selectedPath.replace(/[^/\\]+$/, ''),
          }
        );
        if (onProgress) {
            onProgress({ 
            current: 0, 
            total: parsedData.totalEntries, 
            message: `Đã load ${parsedData.totalEntries} dòng từ ${inputType === 'srt' ? 'SRT' : 'Draft JSON'}` 
            });
        }
      } else {
        if (onProgress) {
            onProgress({ current: 0, total: 0, message: `Lỗi: ${parseResult.error}` });
        }
      }
    } catch (err) {
        if (onProgress) {
            onProgress({ current: 0, total: 0, message: `Lỗi: ${err}` });
        }
    }
  }, [inputType, onProgress, projectId]);

  useEffect(() => {
    const paths = getInputPaths(inputType, filePath);
    if (!paths.length) return;
    const firstPath = paths[0];
    const sessionPath = getSessionPathForInputPath(inputType, firstPath);
    let cancelled = false;

    const hydrateFromSession = async () => {
      if (import.meta?.env?.DEV) {
        console.log('[CaptionFileManagement] Hydrate session', {
          inputType,
          filePath,
          inputPaths: paths,
          sessionPath,
        });
      }
      const sourcePath = inputType === 'srt'
        ? (srtFilesByFolderRef.current[firstPath] || firstPath)
        : firstPath;
      const session = await readCaptionSession(sessionPath, {
        projectId,
        inputType,
        sourcePath,
        folderPath: inputType === 'draft' || inputType === 'srt'
          ? firstPath
          : firstPath.replace(/[^/\\]+$/, ''),
      });
      if (cancelled) return;
      const step3Done = session.steps.step3?.status === 'success';
      if (step3Done && session.data.translatedEntries && session.data.translatedEntries.length > 0) {
        setEntries(session.data.translatedEntries as SubtitleEntry[]);
      } else if (session.data.extractedEntries && session.data.extractedEntries.length > 0) {
        setEntries(session.data.extractedEntries as SubtitleEntry[]);
      } else if (session.data.translatedEntries && session.data.translatedEntries.length > 0) {
        // backward-safe fallback khi session cũ chưa có step status chuẩn
        setEntries(session.data.translatedEntries as SubtitleEntry[]);
      }
    };

    hydrateFromSession();
    return () => {
      cancelled = true;
    };
  }, [filePath, inputType, projectId]);

  useEffect(() => {
    if ((inputType !== 'draft' && inputType !== 'srt') || !filePath) {
      setFolderVideos({});
      return;
    }

    const paths = getInputPaths(inputType, filePath);
    const fetchVideos = async () => {
      const newFolderVideos: Record<string, { name: string; fullPath: string; duration: number; hasAudio?: boolean }> = {};
      for (const p of paths) {
        try {
          // @ts-ignore
          const res = await window.electronAPI.captionVideo.findBestVideoInFolders([p], {
            audioPreference: videoSelectionAudioMode,
          });
          if (res.success && res.data?.videoPath) {
             const videoName = res.data.videoPath.split(/[/\\]/).pop();
             if (videoName) {
               newFolderVideos[p] = { 
                 name: videoName, 
                 fullPath: res.data.videoPath,
                 duration: res.data.metadata?.duration || 0,
                 hasAudio: res.data.metadata?.hasAudio === true,
               };
             }
          }
        } catch (e) {
          console.error('Error finding video for folder', p, e);
        }
      }
      setFolderVideos(newFolderVideos);
    };

    fetchVideos();
  }, [filePath, inputType, videoSelectionAudioMode]);

  const pickVideoForFolder = useCallback(async (folderPath: string) => {
    const targetFolder = normalizeFolderPath(folderPath);
    if (!targetFolder) return;
    try {
      // @ts-ignore - electronAPI is globally defined
      const result = await window.electronAPI.invoke('dialog:openFile', {
        filters: [{ name: 'Video Files', extensions: ['mp4', 'mov', 'mkv', 'avi', 'm4v', 'webm'] }],
        properties: ['openFile'],
      }) as { canceled: boolean; filePaths: string[] };

      if (result?.canceled || !result?.filePaths?.length) return;
      const selectedPath = result.filePaths[0];
      if (!selectedPath) return;

      if (!isDirectChildFile(targetFolder, selectedPath)) {
        if (onProgress) {
          onProgress({
            current: 0,
            total: 0,
            message: 'Video phải nằm trực tiếp trong folder input đã chọn.',
          });
        }
        return;
      }

      // @ts-ignore
      const metadataRes = await window.electronAPI.captionVideo.getVideoMetadata(selectedPath);
      const duration = metadataRes?.success && metadataRes?.data?.duration
        ? metadataRes.data.duration
        : 0;
      const hasAudio = metadataRes?.success ? metadataRes?.data?.hasAudio === true : undefined;
      const videoName = selectedPath.split(/[/\\]/).pop() || selectedPath;

      setFolderVideos((prev) => ({
        ...prev,
        [targetFolder]: {
          name: videoName,
          fullPath: selectedPath,
          duration,
          hasAudio,
        },
      }));

      if (onProgress) {
        onProgress({
          current: 0,
          total: 0,
          message: `Đã chọn video input: ${videoName}${hasAudio === false ? ' (không có audio)' : ''}`,
        });
      }
    } catch (error) {
      console.warn('[CaptionFileManagement] Không thể chọn video cho folder:', error);
    }
  }, [isDirectChildFile, normalizeFolderPath, onProgress]);

  useEffect(() => {
    if (inputType !== 'srt') {
      setSrtFilesByFolder({});
      setMissingSrtFolders(new Set());
      return;
    }
    const rawPaths = getInputPaths('srt', filePath);
    const folderPaths = rawPaths.map(normalizeFolderPath).filter(Boolean);
    if (folderPaths.length === 0) {
      setSrtFilesByFolder({});
      setMissingSrtFolders(new Set());
      return;
    }
    let cancelled = false;

    const syncSrtFiles = async () => {
      const prev = srtFilesByFolderRef.current;
      const next: Record<string, string> = {};
      const pending: string[] = [];
      for (const folderPath of folderPaths) {
        const prevValue = prev[folderPath];
        if (prevValue && prevValue.trim()) {
          next[folderPath] = prevValue;
        } else {
          pending.push(folderPath);
        }
      }
      if (pending.length > 0) {
        try {
          // @ts-ignore
          const res = await window.electronAPI.caption.findSrtInFolders(pending);
          if (res?.success && res.data) {
            for (const folderPath of pending) {
              const found = res.data[folderPath];
              if (typeof found === 'string' && found.trim() && isDirectChildFile(folderPath, found)) {
                next[folderPath] = found;
              }
            }
          }
        } catch (error) {
          console.warn('[CaptionFileManagement] Không thể auto-detect SRT:', error);
        }
      }
      if (cancelled) return;
      setSrtFilesByFolder(next);
      updateMissingSrt(folderPaths, next);
      for (const folderPath of folderPaths) {
        const sourcePath = next[folderPath] || '';
        const sessionPath = getSessionPathForInputPath('srt', folderPath);
        await updateCaptionSession(
          sessionPath,
          (session) => ({
            ...session,
            projectContext: {
              ...session.projectContext,
              projectId: projectId || null,
              inputType: 'srt',
              sourcePath,
              folderPath,
            },
          }),
          { projectId, inputType: 'srt', sourcePath, folderPath }
        );
      }
      if (folderPaths.length === 1) {
        const onlyPath = folderPaths[0];
        const srtPath = next[onlyPath];
        if (srtPath) {
          await hydrateSrtEntries(onlyPath, srtPath);
        }
      }
    };

    void syncSrtFiles();
    return () => {
      cancelled = true;
    };
  }, [filePath, inputType, normalizeFolderPath, projectId, updateMissingSrt, hydrateSrtEntries]);

  const pickSrtForFolder = useCallback(async (folderPath: string) => {
    const targetFolder = normalizeFolderPath(folderPath);
    if (!targetFolder) return;
    try {
      // @ts-ignore - electronAPI is globally defined
      const result = await window.electronAPI.invoke('dialog:openFile', {
        filters: [{ name: 'SRT Files', extensions: ['srt'] }],
        properties: ['openFile'],
      }) as { canceled: boolean; filePaths: string[] };

      if (result?.canceled || !result?.filePaths?.length) return;
      const selectedPath = result.filePaths[0];
      if (!selectedPath) return;

      setSrtFilesByFolder((prev) => ({ ...prev, [targetFolder]: selectedPath }));
      setMissingSrtFolders((prev) => {
        const next = new Set(prev);
        next.delete(targetFolder);
        return next;
      });

      const sessionPath = getSessionPathForInputPath('srt', targetFolder);
      await updateCaptionSession(
        sessionPath,
        (session) => ({
          ...session,
          projectContext: {
            ...session.projectContext,
            projectId: projectId || null,
            inputType: 'srt',
            sourcePath: selectedPath,
            folderPath: targetFolder,
          },
        }),
        { projectId, inputType: 'srt', sourcePath: selectedPath, folderPath: targetFolder }
      );
      const inputPaths = getInputPaths('srt', filePath);
      if (inputPaths.length === 1 && normalizeFolderPath(inputPaths[0]) === targetFolder) {
        await hydrateSrtEntries(targetFolder, selectedPath);
      }
    } catch (error) {
      console.warn('[CaptionFileManagement] Không thể chọn SRT cho folder:', error);
    }
  }, [filePath, hydrateSrtEntries, normalizeFolderPath, projectId]);

  // First video path for preview
  const firstVideoPath = Object.values(folderVideos)[0]?.fullPath || null;

  return {
    filePath, setFilePath,
    entries, setEntries,
    folderVideos,
    firstVideoPath,
    srtFilesByFolder,
    missingSrtFolders,
    pickSrtForFolder,
    pickVideoForFolder,
    handleBrowseFile
  };
}
