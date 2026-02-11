import { useProjectFeatureState } from '../../../hooks/useProjectFeatureState';
import type { Chapter } from '@shared/types';
import type { TokenContext } from '../types';
import { extractTranslatedTitle } from '../utils/chapterUtils';

interface StoryTranslatorStateSetters {
  setFilePath: (path: string) => void;
  setSourceLang: (lang: string) => void;
  setTargetLang: (lang: string) => void;
  setModel: (model: string) => void;
  setTranslateMode: (mode: 'api' | 'token' | 'both') => void;
  setTranslatedChapters: (chapters: Map<string, string>) => void;
  setChapterModels: (models: Map<string, string>) => void;
  setChapterMethods: (methods: Map<string, 'api' | 'token'>) => void;
  setTranslatedTitles: (titles: Map<string, string>) => void;
  setTokenConfigId: (id: string | null) => void;
  setTokenContexts: (contexts: Map<string, TokenContext>) => void;
  setViewMode: (mode: 'original' | 'translated' | 'summary') => void;
  setExcludedChapterIds: (ids: Set<string>) => void;
  setSelectedChapterId: (id: string | null) => void;
  setSummaries: (summaries: Map<string, string>) => void;
  setSummaryTitles: (titles: Map<string, string>) => void;
  setChapters: (chapters: Chapter[]) => void;
}

interface StoryTranslatorStateValues {
  filePath: string;
  sourceLang: string;
  targetLang: string;
  model: string;
  translateMode: 'api' | 'token' | 'both';
  chapters: Chapter[];
  translatedChapters: Map<string, string>;
  chapterModels: Map<string, string>;
  chapterMethods: Map<string, 'api' | 'token'>;
  translatedTitles: Map<string, string>;
  tokenConfigId: string | null;
  tokenContexts: Map<string, TokenContext>;
  viewMode: 'original' | 'translated' | 'summary';
  excludedChapterIds: Set<string>;
  selectedChapterId: string | null;
  summaries: Map<string, string>;
  summaryTitles: Map<string, string>;
}

export function useStoryTranslatorPersistence(
  values: StoryTranslatorStateValues,
  setters: StoryTranslatorStateSetters,
  parseFile: (path: string, options?: { keepTranslations?: boolean; keepSelection?: boolean }) => Promise<boolean>
) {
  const STORY_STATE_FILE = 'story-translator.json';

  const { projectId } = useProjectFeatureState<{
    filePath?: string;
    sourceLang?: string;
    targetLang?: string;
    model?: string;
    translateMode?: 'api' | 'token' | 'both';
    translatedEntries?: Array<[string, string]>;
    chapterModels?: Array<[string, string]>;
    chapterMethods?: Array<[string, 'api' | 'token']>;
    translatedTitles?: Array<{ id: string; title: string }>;
    tokenConfigId?: string | null;
    tokenContext?: TokenContext | null;
    tokenContexts?: Array<[string, TokenContext]>;
    viewMode?: 'original' | 'translated' | 'summary';
    excludedChapterIds?: string[];
    selectedChapterId?: string | null;
    summaries?: Array<[string, string]>;
    summaryTitles?: Array<[string, string]>;
  }>({
    feature: 'story',
    fileName: STORY_STATE_FILE,
    serialize: () => {
      const orderedTranslatedEntries = values.chapters
        .filter((c) => values.translatedChapters.has(c.id))
        .map((c) => [c.id, values.translatedChapters.get(c.id)!] as [string, string]);

      const orderedChapterModels = orderedTranslatedEntries.map(([chapterId]) => {
        const usedModel = values.chapterModels.get(chapterId) || values.model;
        return [chapterId, usedModel] as [string, string];
      });

      const orderedChapterMethods = orderedTranslatedEntries.map(([chapterId]) => {
        const usedMethod = values.chapterMethods.get(chapterId) || (values.translateMode === 'token' ? 'token' : 'api');
        return [chapterId, usedMethod] as [string, 'api' | 'token'];
      });

      const serializedTitles = orderedTranslatedEntries.map(([chapterId, content]) => ({
        id: chapterId,
        title: extractTranslatedTitle(content, chapterId)
      }));

      const serializedSummaries = Array.from(values.summaries.entries());
      const serializedSummaryTitles = Array.from(values.summaryTitles.entries());

      return {
        filePath: values.filePath,
        sourceLang: values.sourceLang,
        targetLang: values.targetLang,
        model: values.model,
        translateMode: values.translateMode,
        translatedEntries: orderedTranslatedEntries,
        chapterModels: orderedChapterModels,
        chapterMethods: orderedChapterMethods,
        translatedTitles: serializedTitles,
        tokenConfigId: values.tokenConfigId,
        tokenContexts: Array.from(values.tokenContexts.entries()),
        viewMode: values.viewMode as 'original' | 'translated' | 'summary',
        excludedChapterIds: Array.from(values.excludedChapterIds.values()),
        selectedChapterId: values.selectedChapterId,
        summaries: serializedSummaries,
        summaryTitles: serializedSummaryTitles
      };
    },
    deserialize: async (saved: any) => {
      if (saved.sourceLang) setters.setSourceLang(saved.sourceLang);
      if (saved.targetLang) setters.setTargetLang(saved.targetLang);
      if (saved.model) setters.setModel(saved.model);
      if (saved.translateMode) setters.setTranslateMode(saved.translateMode);
      if (saved.translatedEntries) setters.setTranslatedChapters(new Map(saved.translatedEntries));
      if (saved.chapterModels) setters.setChapterModels(new Map(saved.chapterModels));
      if (saved.chapterMethods) setters.setChapterMethods(new Map(saved.chapterMethods));
      if (saved.translatedTitles) {
        setters.setTranslatedTitles(new Map(saved.translatedTitles.map((t: any) => [t.id, t.title] as [string, string])));
      }
      if (typeof saved.tokenConfigId !== 'undefined') {
        setters.setTokenConfigId(saved.tokenConfigId || null);
      }
      if (saved.tokenContexts && saved.tokenContexts.length > 0) {
        setters.setTokenContexts(new Map(saved.tokenContexts));
      } else if (saved.tokenContext && saved.tokenConfigId) {
        setters.setTokenContexts(new Map([[saved.tokenConfigId, saved.tokenContext]]));
      }
      
      if (saved.summaries) setters.setSummaries(new Map(saved.summaries));
      if (saved.summaryTitles) setters.setSummaryTitles(new Map(saved.summaryTitles));

      let parsedOk = false;
      if (saved.filePath) {
        setters.setFilePath(saved.filePath);
        parsedOk = await parseFile(saved.filePath, { keepTranslations: true, keepSelection: true });
      }

      if (!parsedOk && saved.translatedTitles && saved.translatedTitles.length > 0) {
        setters.setChapters(saved.translatedTitles.map((c: any) => ({ id: c.id, title: c.title, content: '' })));
      }

      if (saved.viewMode) setters.setViewMode(saved.viewMode);
      if (saved.excludedChapterIds) setters.setExcludedChapterIds(new Set(saved.excludedChapterIds));
      if (typeof saved.selectedChapterId !== 'undefined') setters.setSelectedChapterId(saved.selectedChapterId);
    },
    deps: [
      values.filePath,
      values.sourceLang,
      values.targetLang,
      values.model,
      values.translateMode,
      values.chapters,
      values.translatedChapters,
      values.chapterModels,
      values.chapterMethods,
      values.translatedTitles,
      values.tokenConfigId,
      values.tokenContexts,
      values.viewMode,
      values.excludedChapterIds,
      values.selectedChapterId,
      values.summaries,
      values.summaryTitles
    ],
  });

  return { projectId };
}
