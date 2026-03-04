import { useState, useCallback, useEffect } from 'react';
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
  onProgress?: (progress: { current: number; total: number; message: string }) => void;
}

export function useCaptionFileManagement({ inputType, onProgress }: UseCaptionFileManagementProps) {
  const { projectId } = useProjectContext();
  const [filePath, setFilePath] = useState('');
  const [entries, setEntries] = useState<SubtitleEntry[]>([]);
  const [folderVideos, setFolderVideos] = useState<Record<string, { name: string; fullPath: string; duration: number }>>({});
  const storageKey = `caption:lastInput:${projectId || 'global'}:${inputType}`;

  useEffect(() => {
    if (filePath) return;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved && saved.trim()) {
        setFilePath(saved);
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

  const handleBrowseFile = useCallback(async () => {
    try {
      let filters = undefined;
      let properties = ['openFile'];

      if (inputType === 'srt') {
        filters = [{ name: 'SRT Files', extensions: ['srt'] }];
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
      const session = await readCaptionSession(sessionPath, {
        projectId,
        inputType,
        sourcePath: firstPath,
        folderPath: inputType === 'draft' ? firstPath : firstPath.replace(/[^/\\]+$/, ''),
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
    if (inputType !== 'draft' || !filePath) {
      setFolderVideos({});
      return;
    }

    const paths = getInputPaths(inputType, filePath);
    const fetchVideos = async () => {
      const newFolderVideos: Record<string, { name: string; fullPath: string; duration: number }> = {};
      for (const p of paths) {
        try {
          // @ts-ignore
          const res = await window.electronAPI.captionVideo.findBestVideoInFolders([p]);
          if (res.success && res.data?.videoPath) {
             const videoName = res.data.videoPath.split(/[/\\]/).pop();
             if (videoName) {
               newFolderVideos[p] = { 
                 name: videoName, 
                 fullPath: res.data.videoPath,
                 duration: res.data.metadata?.duration || 0
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
  }, [filePath, inputType]);

  // First video path for preview
  const firstVideoPath = Object.values(folderVideos)[0]?.fullPath || null;

  return {
    filePath, setFilePath,
    entries, setEntries,
    folderVideos,
    firstVideoPath,
    handleBrowseFile
  };
}
