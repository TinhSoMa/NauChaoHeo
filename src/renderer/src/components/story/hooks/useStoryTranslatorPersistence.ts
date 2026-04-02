import { useProjectFeatureState } from '../../../hooks/useProjectFeatureState';
import type { Chapter } from '@shared/types';
import type { StoryChapterMethod, StoryTranslationMethod, TokenContext } from '../types';
import { extractTranslatedTitle } from '../utils/chapterUtils';

type LegacyTranslateMode = 'api' | 'token' | 'both';

function mapLegacyTranslateModeToMethod(mode: LegacyTranslateMode | undefined): StoryTranslationMethod {
  if (mode === 'token') {
    return 'token';
  }
  if (mode === 'both') {
    return 'api_gemini_webapi_queue';
  }
  return 'api';
}

function toLegacyTranslateMode(method: StoryTranslationMethod): LegacyTranslateMode {
  if (method === 'token') {
    return 'token';
  }
  if (method === 'api_gemini_webapi_queue') {
    return 'both';
  }
  return 'api';
}

function normalizeChapterMethod(method: unknown): StoryChapterMethod {
  if (method === 'token' || method === 'gemini_webapi_queue') {
    return method;
  }
  return 'api';
}

interface StoryTranslatorStateSetters {
  setFilePath: (path: string) => void;
  setSourceLang: (lang: string) => void;
  setTargetLang: (lang: string) => void;
  setModel: (model: string) => void;
  setTranslationMethod: (mode: StoryTranslationMethod) => void;
  setTranslatedChapters: (chapters: Map<string, string>) => void;
  setChapterModels: (models: Map<string, string>) => void;
  setChapterMethods: (methods: Map<string, StoryChapterMethod>) => void;
  setTranslatedTitles: (titles: Map<string, string>) => void;
  setTokenConfigId: (id: string | null) => void;
  setTokenContexts: (contexts: Map<string, TokenContext>) => void;
  setViewMode: (mode: 'original' | 'translated' | 'summary') => void;
  setExcludedChapterIds: (ids: Set<string>) => void;
  setSelectedChapterId: (id: string | null) => void;
  setSummaries: (summaries: Map<string, string>) => void;
  setSummaryTitles: (titles: Map<string, string>) => void;
  setChapterScrollPositions: (positions: Map<string, number>) => void;
  setChapters: (chapters: Chapter[]) => void;
}

interface StoryTranslatorStateValues {
  filePath: string;
  sourceLang: string;
  targetLang: string;
  model: string;
  translationMethod: StoryTranslationMethod;
  chapters: Chapter[];
  translatedChapters: Map<string, string>;
  chapterModels: Map<string, string>;
  chapterMethods: Map<string, StoryChapterMethod>;
  translatedTitles: Map<string, string>;
  tokenConfigId: string | null;
  tokenContexts: Map<string, TokenContext>;
  viewMode: 'original' | 'translated' | 'summary';
  excludedChapterIds: Set<string>;
  selectedChapterId: string | null;
  summaries: Map<string, string>;
  summaryTitles: Map<string, string>;
  chapterScrollPositions: Map<string, number>;
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
    translationMethod?: StoryTranslationMethod;
    translateMode?: LegacyTranslateMode;
    translatedEntries?: Array<[string, string]>;
    chapterModels?: Array<[string, string]>;
    chapterMethods?: Array<[string, StoryChapterMethod | 'api' | 'token']>;
    translatedTitles?: Array<{ id: string; title: string }>;
    tokenConfigId?: string | null;
    tokenContext?: TokenContext | null;
    tokenContexts?: Array<[string, TokenContext]>;
    viewMode?: 'original' | 'translated' | 'summary';
    excludedChapterIds?: string[];
    selectedChapterId?: string | null;
    summaries?: Array<[string, string]>;
    summaryTitles?: Array<[string, string]>;
    chapterScrollPositions?: Array<[string, number]>;
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
        const defaultMethod: StoryChapterMethod = values.translationMethod === 'token'
          ? 'token'
          : values.translationMethod === 'gemini_webapi_queue'
            ? 'gemini_webapi_queue'
            : 'api';
        const usedMethod = values.chapterMethods.get(chapterId) || defaultMethod;
        return [chapterId, usedMethod] as [string, StoryChapterMethod];
      });

      const serializedTitles = orderedTranslatedEntries.map(([chapterId, content]) => ({
        id: chapterId,
        title: extractTranslatedTitle(content, chapterId)
      }));



      return {
        filePath: values.filePath,
        sourceLang: values.sourceLang,
        targetLang: values.targetLang,
        model: values.model,
        translationMethod: values.translationMethod,
        // Keep legacy field for backward compatibility with older builds.
        translateMode: toLegacyTranslateMode(values.translationMethod),
        translatedEntries: orderedTranslatedEntries,
        chapterModels: orderedChapterModels,
        chapterMethods: orderedChapterMethods,
        translatedTitles: serializedTitles,
        tokenConfigId: values.tokenConfigId,
        tokenContexts: Array.from(values.tokenContexts.entries()),
        viewMode: values.viewMode as 'original' | 'translated' | 'summary',
        excludedChapterIds: Array.from(values.excludedChapterIds.values()),
        selectedChapterId: values.selectedChapterId,
        chapterScrollPositions: Array.from(values.chapterScrollPositions.entries())
      };
    },
    deserialize: async (saved: any) => {
      if (saved.sourceLang) setters.setSourceLang(saved.sourceLang);
      if (saved.targetLang) setters.setTargetLang(saved.targetLang);
      if (saved.model) setters.setModel(saved.model);
      if (saved.translationMethod) {
        setters.setTranslationMethod(saved.translationMethod);
      } else if (saved.translateMode) {
        setters.setTranslationMethod(mapLegacyTranslateModeToMethod(saved.translateMode));
      }
      if (saved.translatedEntries) setters.setTranslatedChapters(new Map(saved.translatedEntries));
      if (saved.chapterModels) setters.setChapterModels(new Map(saved.chapterModels));
      if (saved.chapterMethods) {
        const normalized = new Map<string, StoryChapterMethod>();
        for (const [chapterId, method] of saved.chapterMethods) {
          normalized.set(chapterId, normalizeChapterMethod(method));
        }
        setters.setChapterMethods(normalized);
      }
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
      
      // Don't load summaries here - we load them from story-summary.json below

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
      if (saved.chapterScrollPositions) setters.setChapterScrollPositions(new Map(saved.chapterScrollPositions));
    },
    deps: [
      values.filePath,
      values.sourceLang,
      values.targetLang,
      values.model,
      values.translationMethod,
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
      values.chapterScrollPositions
    ],
  });

  // Persistence for story-summary.json (Summaries)
  useProjectFeatureState<{
    summaries?: Array<[string, string]>;
    summaryTitles?: Array<[string, string]>;
  }>({
    feature: 'story',
    fileName: 'story-summary.json',
    serialize: () => {
      const serializedSummaries = Array.from(values.summaries.entries());
      const serializedSummaryTitles = Array.from(values.summaryTitles.entries());

      return {
        summaries: serializedSummaries,
        summaryTitles: serializedSummaryTitles
      };
    },
    deserialize: async (saved: any) => {
      if (saved.summaries) setters.setSummaries(new Map(saved.summaries));
      if (saved.summaryTitles) setters.setSummaryTitles(new Map(saved.summaryTitles));
    },
    deps: [
      values.summaries,
      values.summaryTitles
    ]
  });

  return { projectId };
}
