import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Check,
  Edit2,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Subtitles,
  Trash2,
} from 'lucide-react';
import { Button } from '../common/Button';
import shellStyles from './Settings.module.css';
import styles from './PromptSettings.module.css';

interface PromptSettingsProps {
  onBack: () => void;
}

type PromptType = 'translation' | 'summary' | 'caption';
type PromptFunction = PromptType;
type PanelTab = 'assign' | 'library';
type GroupFilter = '__all__' | '__ungrouped__' | string;
type EditorMode = 'new-family' | 'new-version';
type ToastType = 'success' | 'error' | 'info';

interface PromptRecord {
  id: string;
  name: string;
  description?: string;
  sourceLang: string;
  targetLang: string;
  content: string;
  promptType: PromptType;
  languageBucket: string;
  groupId: string | null;
  groupName?: string;
  familyId: string;
  version: number;
  isLatest: boolean;
  archived: boolean;
  updatedAt: number;
}

interface PromptGroupRecord {
  id: string;
  languageBucket: string;
  name: string;
}

interface PromptFamilyRecord {
  familyId: string;
  promptType: PromptType;
  languageBucket: string;
  sourceLang: string;
  targetLang: string;
  groupId: string | null;
  groupName?: string;
  latestPromptId: string;
  latestName: string;
  latestVersion: number;
  latestUpdatedAt: number;
}

interface LanguageBucketRecord {
  languageBucket: string;
  sourceLang: string;
  targetLang: string;
  totalFamilies: number;
  totalPrompts: number;
}

interface EditorForm {
  promptType: PromptType;
  name: string;
  description: string;
  sourceLang: string;
  targetLang: string;
  groupId: string | null;
  content: string;
}

const GROUP_ALL: GroupFilter = '__all__';
const GROUP_UNGROUPED: GroupFilter = '__ungrouped__';

const LANGUAGE_LABELS: Record<string, string> = {
  zh: 'Trung',
  'zh-cn': 'Trung giản thể',
  'zh-tw': 'Trung phồn thể',
  vi: 'Việt',
  en: 'Anh',
  es: 'Tây Ban Nha',
  fr: 'Pháp',
  de: 'Đức',
  it: 'Ý',
  pt: 'Bồ Đào Nha',
  ru: 'Nga',
  ja: 'Nhật',
  ko: 'Hàn',
  th: 'Thái',
  id: 'Indonesia',
  ms: 'Malaysia',
  hi: 'Hindi',
  ar: 'Ả Rập',
  tr: 'Thổ Nhĩ Kỳ',
};

const LANGUAGE_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'zh', label: 'Trung' },
  { code: 'zh-cn', label: 'Trung giản thể' },
  { code: 'zh-tw', label: 'Trung phồn thể' },
  { code: 'vi', label: 'Việt' },
  { code: 'en', label: 'Anh' },
  { code: 'es', label: 'Tây Ban Nha' },
  { code: 'fr', label: 'Pháp' },
  { code: 'de', label: 'Đức' },
  { code: 'it', label: 'Ý' },
  { code: 'pt', label: 'Bồ Đào Nha' },
  { code: 'ru', label: 'Nga' },
  { code: 'ja', label: 'Nhật' },
  { code: 'ko', label: 'Hàn' },
  { code: 'th', label: 'Thái' },
  { code: 'id', label: 'Indonesia' },
  { code: 'ms', label: 'Malaysia' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ar', label: 'Ả Rập' },
  { code: 'tr', label: 'Thổ Nhĩ Kỳ' },
];

const FUNCTION_META: Record<PromptFunction, { label: string; icon: typeof Sparkles; description: string }> = {
  translation: {
    label: 'Dịch truyện',
    icon: BookOpen,
    description: 'Áp dụng cho pipeline dịch chương truyện.',
  },
  summary: {
    label: 'Tóm tắt',
    icon: Sparkles,
    description: 'Áp dụng cho bước tạo summary chương.',
  },
  caption: {
    label: 'Caption Step 3',
    icon: Subtitles,
    description: 'Áp dụng cho dịch subtitle trong tab Caption.',
  },
};

function parseLanguageBucket(bucket: string): { sourceLang: string; targetLang: string } {
  const [sourceLang = 'zh', targetLang = 'vi'] = (bucket || '').split('->');
  return {
    sourceLang: sourceLang.trim().toLowerCase(),
    targetLang: targetLang.trim().toLowerCase(),
  };
}

function toLanguageBucket(sourceLang: string, targetLang: string): string {
  return `${sourceLang.trim().toLowerCase()}->${targetLang.trim().toLowerCase()}`;
}

function languageLabel(code: string): string {
  return LANGUAGE_LABELS[code] || code.toUpperCase();
}

function formatBucketLabel(bucket: string): string {
  const { sourceLang, targetLang } = parseLanguageBucket(bucket);
  return `${languageLabel(sourceLang)} -> ${languageLabel(targetLang)}`;
}

function normalizePromptContent(content: unknown): string {
  if (typeof content !== 'string') {
    return '';
  }
  try {
    if (content.trim().startsWith('{')) {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object') {
        const asRecord = parsed as Record<string, unknown>;
        if (typeof asRecord.content === 'string') {
          return asRecord.content;
        }
        if (typeof asRecord.systemInstruction === 'string') {
          return asRecord.systemInstruction;
        }
      }
    }
  } catch {
    return content;
  }
  return content;
}

function buildLanguageBuckets(
  languages: LanguageBucketRecord[],
  prompts: PromptRecord[],
  groups: PromptGroupRecord[]
): LanguageBucketRecord[] {
  const map = new Map<string, LanguageBucketRecord>();

  for (const lang of languages) {
    map.set(lang.languageBucket, {
      languageBucket: lang.languageBucket,
      sourceLang: lang.sourceLang,
      targetLang: lang.targetLang,
      totalFamilies: Number(lang.totalFamilies || 0),
      totalPrompts: Number(lang.totalPrompts || 0),
    });
  }

  for (const prompt of prompts) {
    const existing = map.get(prompt.languageBucket);
    if (existing) {
      continue;
    }
    map.set(prompt.languageBucket, {
      languageBucket: prompt.languageBucket,
      sourceLang: prompt.sourceLang,
      targetLang: prompt.targetLang,
      totalFamilies: 0,
      totalPrompts: 0,
    });
  }

  for (const group of groups) {
    const bucket = String(group.languageBucket || '').trim().toLowerCase();
    if (!bucket || map.has(bucket)) {
      continue;
    }
    const parsed = parseLanguageBucket(bucket);
    map.set(bucket, {
      languageBucket: bucket,
      sourceLang: parsed.sourceLang,
      targetLang: parsed.targetLang,
      totalFamilies: 0,
      totalPrompts: 0,
    });
  }

  return Array.from(map.values()).sort((a, b) => a.languageBucket.localeCompare(b.languageBucket));
}

function toPromptRecord(row: any): PromptRecord {
  return {
    id: String(row.id),
    name: String(row.name || 'Untitled Prompt'),
    description: row.description ? String(row.description) : '',
    sourceLang: String(row.sourceLang || 'zh').toLowerCase(),
    targetLang: String(row.targetLang || 'vi').toLowerCase(),
    content: normalizePromptContent(row.content),
    promptType: (row.promptType || 'translation') as PromptType,
    languageBucket: String(row.languageBucket || toLanguageBucket(row.sourceLang || 'zh', row.targetLang || 'vi')),
    groupId: row.groupId ?? null,
    groupName: row.groupName ? String(row.groupName) : undefined,
    familyId: String(row.familyId || row.id),
    version: Number(row.version || 1),
    isLatest: Boolean(row.isLatest),
    archived: Boolean(row.archived),
    updatedAt: Number(row.updatedAt || Date.now()),
  };
}

function toFamilyRecord(row: any): PromptFamilyRecord {
  return {
    familyId: String(row.familyId),
    promptType: (row.promptType || 'translation') as PromptType,
    languageBucket: String(row.languageBucket),
    sourceLang: String(row.sourceLang || 'zh').toLowerCase(),
    targetLang: String(row.targetLang || 'vi').toLowerCase(),
    groupId: row.groupId ?? null,
    groupName: row.groupName ? String(row.groupName) : undefined,
    latestPromptId: String(row.latestPromptId),
    latestName: String(row.latestName || 'Untitled Prompt'),
    latestVersion: Number(row.latestVersion || 1),
    latestUpdatedAt: Number(row.latestUpdatedAt || Date.now()),
  };
}

export function PromptSettings({ onBack }: PromptSettingsProps) {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<PanelTab>('assign');

  const [families, setFamilies] = useState<PromptFamilyRecord[]>([]);
  const [groups, setGroups] = useState<PromptGroupRecord[]>([]);
  const [languageBuckets, setLanguageBuckets] = useState<LanguageBucketRecord[]>([]);

  const [translationFamilyId, setTranslationFamilyId] = useState<string>('');
  const [summaryFamilyId, setSummaryFamilyId] = useState<string>('');
  const [captionFamilyId, setCaptionFamilyId] = useState<string>('');
  const [legacyTranslationPromptId, setLegacyTranslationPromptId] = useState<string>('');
  const [legacySummaryPromptId, setLegacySummaryPromptId] = useState<string>('');
  const [legacyCaptionPromptId, setLegacyCaptionPromptId] = useState<string>('');
  const [hasAssignmentChanges, setHasAssignmentChanges] = useState(false);

  const [selectedLanguageBucket, setSelectedLanguageBucket] = useState<string>('');
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<GroupFilter>(GROUP_ALL);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string>('');
  const [versions, setVersions] = useState<PromptRecord[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');

  const [groupDraftName, setGroupDraftName] = useState('');
  const [groupRenameName, setGroupRenameName] = useState('');
  const [bucketSourceLang, setBucketSourceLang] = useState('zh');
  const [bucketTargetLang, setBucketTargetLang] = useState('vi');

  const [editorMode, setEditorMode] = useState<EditorMode>('new-version');
  const [editor, setEditor] = useState<EditorForm>({
    promptType: 'translation',
    name: '',
    description: '',
    sourceLang: 'zh',
    targetLang: 'vi',
    groupId: null,
    content: '',
  });

  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const selectedLanguageBucketRef = useRef('');
  const selectedFamilyIdRef = useRef('');

  const showToast = useCallback((message: string, type: ToastType) => {
    setToast({ message, type });
    window.setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 3200);
  }, []);

  const selectedFamily = useMemo(
    () => families.find((family) => family.familyId === selectedFamilyId) || null,
    [families, selectedFamilyId]
  );

  const groupsForLanguage = useMemo(() => {
    if (!selectedLanguageBucket) {
      return [];
    }
    return groups.filter((group) => group.languageBucket === selectedLanguageBucket);
  }, [groups, selectedLanguageBucket]);

  const familiesForLanguage = useMemo(() => {
    if (!selectedLanguageBucket) {
      return [];
    }
    return families.filter((family) => family.languageBucket === selectedLanguageBucket);
  }, [families, selectedLanguageBucket]);

  const familyList = useMemo(() => {
    if (selectedGroupFilter === GROUP_ALL) {
      return familiesForLanguage;
    }
    if (selectedGroupFilter === GROUP_UNGROUPED) {
      return familiesForLanguage.filter((family) => !family.groupId);
    }
    return familiesForLanguage.filter((family) => family.groupId === selectedGroupFilter);
  }, [familiesForLanguage, selectedGroupFilter]);

  const familiesByType = useMemo(() => {
    return {
      translation: families.filter((family) => family.promptType === 'translation'),
      summary: families.filter((family) => family.promptType === 'summary'),
      caption: families.filter((family) => family.promptType === 'caption'),
    };
  }, [families]);

  const activeVersion = useMemo(
    () => versions.find((version) => version.id === selectedVersionId) || null,
    [versions, selectedVersionId]
  );

  const selectFamily = useCallback(
    (familyId: string) => {
      setSelectedFamilyId(familyId);
      const family = families.find((item) => item.familyId === familyId);
      if (!family) {
        return;
      }
      setEditor((prev) => ({
        ...prev,
        promptType: family.promptType,
        sourceLang: family.sourceLang,
        targetLang: family.targetLang,
        groupId: family.groupId,
      }));
    },
    [families]
  );

  useEffect(() => {
    selectedLanguageBucketRef.current = selectedLanguageBucket;
  }, [selectedLanguageBucket]);

  useEffect(() => {
    selectedFamilyIdRef.current = selectedFamilyId;
  }, [selectedFamilyId]);

  const loadData = useCallback(async (preferred?: { languageBucket?: string; familyId?: string }) => {
    setLoading(true);
    try {
      const [promptRows, hierarchy, settingsRes] = await Promise.all([
        window.electronAPI.prompt.getAll(),
        window.electronAPI.prompt.getHierarchy(),
        window.electronAPI.appSettings.getAll(),
      ]);

      const normalizedPrompts = Array.isArray(promptRows) ? promptRows.map(toPromptRecord) : [];
      const normalizedFamilies = Array.isArray(hierarchy?.families) ? hierarchy.families.map(toFamilyRecord) : [];
      const normalizedGroups = Array.isArray(hierarchy?.groups)
        ? hierarchy.groups.map((group: any) => ({
            id: String(group.id),
            languageBucket: String(group.languageBucket),
            name: String(group.name),
          }))
        : [];
      const normalizedLanguages = buildLanguageBuckets(
        Array.isArray(hierarchy?.languages) ? hierarchy.languages : [],
        normalizedPrompts,
        normalizedGroups
      );
      const getFamilyByPromptId = (promptId: string | null | undefined): string => {
        if (!promptId) {
          return '';
        }
        const hit = normalizedPrompts.find((prompt) => prompt.id === promptId);
        return hit?.familyId || '';
      };

      setFamilies(normalizedFamilies);
      setGroups(normalizedGroups);
      setLanguageBuckets(normalizedLanguages);

      const preferredLanguage = preferred?.languageBucket ?? selectedLanguageBucketRef.current;
      const nextLanguage = preferredLanguage && normalizedLanguages.some((l) => l.languageBucket === preferredLanguage)
        ? preferredLanguage
        : normalizedLanguages[0]?.languageBucket || '';
      setSelectedLanguageBucket(nextLanguage);

      const preferredFamilyId = preferred?.familyId ?? selectedFamilyIdRef.current;
      if (preferredFamilyId && normalizedFamilies.some((family) => family.familyId === preferredFamilyId)) {
        setSelectedFamilyId(preferredFamilyId);
      } else {
        const seedFamily = normalizedFamilies.find((family) => family.languageBucket === nextLanguage);
        setSelectedFamilyId(seedFamily?.familyId || '');
      }

      if (settingsRes.success && settingsRes.data) {
        const settings = settingsRes.data;
        const nextTranslationFamily = settings.translationPromptFamilyId || getFamilyByPromptId(settings.translationPromptId);
        const nextSummaryFamily = settings.summaryPromptFamilyId || getFamilyByPromptId(settings.summaryPromptId);
        const nextCaptionFamily = settings.captionPromptFamilyId || getFamilyByPromptId(settings.captionPromptId);

        setTranslationFamilyId(nextTranslationFamily);
        setSummaryFamilyId(nextSummaryFamily);
        setCaptionFamilyId(nextCaptionFamily);

        setLegacyTranslationPromptId(settings.translationPromptId || '');
        setLegacySummaryPromptId(settings.summaryPromptId || '');
        setLegacyCaptionPromptId(settings.captionPromptId || '');
      }

      setHasAssignmentChanges(false);
    } catch (error) {
      console.error('[PromptSettings] Failed to load prompt data:', error);
      showToast('Không thể tải Prompt Library.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!selectedLanguageBucket) {
      return;
    }
    const parsed = parseLanguageBucket(selectedLanguageBucket);
    setEditor((prev) => ({
      ...prev,
      sourceLang: parsed.sourceLang,
      targetLang: parsed.targetLang,
    }));
  }, [selectedLanguageBucket]);

  useEffect(() => {
    if (!selectedFamilyId) {
      setVersions([]);
      setSelectedVersionId('');
      return;
    }

    let disposed = false;
    const loadVersions = async () => {
      try {
        const rows = await window.electronAPI.prompt.getVersions(selectedFamilyId);
        if (disposed) {
          return;
        }
        const nextVersions = Array.isArray(rows) ? rows.map(toPromptRecord) : [];
        setVersions(nextVersions);

        const preferred = nextVersions.find((version) => version.isLatest) || nextVersions[0] || null;
        if (!preferred) {
          setSelectedVersionId('');
          return;
        }

        setSelectedVersionId(preferred.id);
        setEditorMode('new-version');
        setEditor({
          promptType: preferred.promptType,
          name: preferred.name,
          description: preferred.description || '',
          sourceLang: preferred.sourceLang,
          targetLang: preferred.targetLang,
          groupId: preferred.groupId,
          content: preferred.content || '',
        });
      } catch (error) {
        console.error('[PromptSettings] Failed to load versions:', error);
        if (!disposed) {
          showToast('Không thể tải danh sách version.', 'error');
        }
      }
    };

    void loadVersions();
    return () => {
      disposed = true;
    };
  }, [selectedFamilyId, showToast]);

  useEffect(() => {
    if (!selectedFamilyId) {
      return;
    }
    const stillVisible = familyList.some((family) => family.familyId === selectedFamilyId);
    if (!stillVisible) {
      setSelectedFamilyId(familyList[0]?.familyId || '');
    }
  }, [familyList, selectedFamilyId]);

  const handleAssignmentChange = useCallback((func: PromptFunction, value: string) => {
    if (func === 'translation') {
      setTranslationFamilyId(value);
    }
    if (func === 'summary') {
      setSummaryFamilyId(value);
    }
    if (func === 'caption') {
      setCaptionFamilyId(value);
    }
    setHasAssignmentChanges(true);
  }, []);

  const handleSaveAssignments = useCallback(async () => {
    try {
      const translationPromptId = translationFamilyId
        ? families.find((family) => family.familyId === translationFamilyId)?.latestPromptId || null
        : null;
      const summaryPromptId = summaryFamilyId
        ? families.find((family) => family.familyId === summaryFamilyId)?.latestPromptId || null
        : null;
      const captionPromptId = captionFamilyId
        ? families.find((family) => family.familyId === captionFamilyId)?.latestPromptId || null
        : null;

      const result = await window.electronAPI.appSettings.update({
        translationPromptFamilyId: translationFamilyId || null,
        summaryPromptFamilyId: summaryFamilyId || null,
        captionPromptFamilyId: captionFamilyId || null,
        translationPromptId,
        summaryPromptId,
        captionPromptId,
      });

      if (!result.success) {
        showToast(`Lưu thất bại: ${result.error || 'unknown error'}`, 'error');
        return;
      }

      setLegacyTranslationPromptId(translationPromptId || '');
      setLegacySummaryPromptId(summaryPromptId || '');
      setLegacyCaptionPromptId(captionPromptId || '');
      setHasAssignmentChanges(false);
      showToast('Đã lưu ánh xạ prompt theo family.', 'success');
    } catch (error) {
      console.error('[PromptSettings] Failed to save assignments:', error);
      showToast('Không thể lưu ánh xạ prompt.', 'error');
    }
  }, [captionFamilyId, families, showToast, summaryFamilyId, translationFamilyId]);

  const handleCreateGroup = useCallback(async () => {
    if (!selectedLanguageBucket || !groupDraftName.trim()) {
      showToast('Cần chọn language và nhập tên nhóm.', 'error');
      return;
    }
    try {
      await window.electronAPI.prompt.createGroup({
        languageBucket: selectedLanguageBucket,
        name: groupDraftName.trim(),
      });
      setGroupDraftName('');
      await loadData({ languageBucket: selectedLanguageBucket });
      showToast('Đã tạo group mới.', 'success');
    } catch (error) {
      console.error('[PromptSettings] Failed to create group:', error);
      showToast('Tạo group thất bại.', 'error');
    }
  }, [groupDraftName, loadData, selectedLanguageBucket, showToast]);

  const handleCreateLanguageBucket = useCallback(async () => {
    const source = bucketSourceLang.trim().toLowerCase();
    const target = bucketTargetLang.trim().toLowerCase();
    if (!source || !target) {
      showToast('Cần nhập source và target language.', 'error');
      return;
    }

    const bucket = toLanguageBucket(source, target);
    try {
      // Seed bucket with General group so bucket can exist even before prompts are created.
      await window.electronAPI.prompt.createGroup({
        languageBucket: bucket,
        name: 'General',
      });

      await loadData({ languageBucket: bucket });
      setSelectedGroupFilter(GROUP_ALL);
      showToast(`Đã tạo cặp ngôn ngữ ${formatBucketLabel(bucket)}.`, 'success');
    } catch (error) {
      console.error('[PromptSettings] Failed to create language bucket:', error);
      showToast('Không thể tạo cặp ngôn ngữ.', 'error');
    }
  }, [bucketSourceLang, bucketTargetLang, loadData, showToast]);

  const handleRenameGroup = useCallback(async () => {
    if (selectedGroupFilter === GROUP_ALL || selectedGroupFilter === GROUP_UNGROUPED) {
      showToast('Hãy chọn một group cụ thể để đổi tên.', 'error');
      return;
    }
    if (!groupRenameName.trim()) {
      showToast('Tên group không hợp lệ.', 'error');
      return;
    }

    try {
      await window.electronAPI.prompt.renameGroup({
        groupId: selectedGroupFilter,
        name: groupRenameName.trim(),
      });
      await loadData();
      showToast('Đã đổi tên group.', 'success');
    } catch (error) {
      console.error('[PromptSettings] Failed to rename group:', error);
      showToast('Không thể đổi tên group.', 'error');
    }
  }, [groupRenameName, loadData, selectedGroupFilter, showToast]);

  const handleDeleteGroup = useCallback(async () => {
    if (selectedGroupFilter === GROUP_ALL || selectedGroupFilter === GROUP_UNGROUPED) {
      showToast('Chọn group cụ thể để xóa.', 'error');
      return;
    }

    const picked = groupsForLanguage.find((group) => group.id === selectedGroupFilter);
    if (!picked) {
      showToast('Group không tồn tại.', 'error');
      return;
    }

    if (!window.confirm(`Xóa group "${picked.name}"? Các family sẽ được chuyển về General.`)) {
      return;
    }

    try {
      await window.electronAPI.prompt.deleteGroup(picked.id);
      setSelectedGroupFilter(GROUP_ALL);
      await loadData();
      showToast('Đã xóa group.', 'success');
    } catch (error) {
      console.error('[PromptSettings] Failed to delete group:', error);
      showToast('Không thể xóa group.', 'error');
    }
  }, [groupsForLanguage, loadData, selectedGroupFilter, showToast]);

  const handleCreateFamily = useCallback(async () => {
    if (!editor.name.trim() || !editor.content.trim()) {
      showToast('Tên và nội dung prompt là bắt buộc.', 'error');
      return;
    }

    try {
      const created = await window.electronAPI.prompt.create({
        name: editor.name.trim(),
        description: editor.description.trim() || undefined,
        sourceLang: editor.sourceLang,
        targetLang: editor.targetLang,
        content: editor.content,
        promptType: editor.promptType,
        groupId: editor.groupId,
      });

      await loadData({
        languageBucket: created?.languageBucket || toLanguageBucket(editor.sourceLang, editor.targetLang),
        familyId: created?.familyId,
      });
      if (created?.familyId) {
        selectFamily(created.familyId);
      }
      showToast('Đã tạo family prompt mới.', 'success');
    } catch (error) {
      console.error('[PromptSettings] Failed to create family:', error);
      showToast('Không thể tạo family prompt.', 'error');
    }
  }, [editor, loadData, selectFamily, showToast]);

  const handleCreateVersion = useCallback(async () => {
    if (!selectedVersionId) {
      showToast('Chọn một version làm base trước khi tạo version mới.', 'error');
      return;
    }
    if (!editor.name.trim() || !editor.content.trim()) {
      showToast('Tên và nội dung prompt là bắt buộc.', 'error');
      return;
    }

    try {
      const created = await window.electronAPI.prompt.update(selectedVersionId, {
        name: editor.name.trim(),
        description: editor.description.trim() || undefined,
        sourceLang: editor.sourceLang,
        targetLang: editor.targetLang,
        content: editor.content,
        promptType: editor.promptType,
        groupId: editor.groupId,
      });

      await loadData({
        languageBucket: selectedLanguageBucketRef.current,
        familyId: created?.familyId,
      });
      if (created?.familyId) {
        selectFamily(created.familyId);
      }
      showToast('Đã tạo version mới (không ghi đè bản cũ).', 'success');
    } catch (error) {
      console.error('[PromptSettings] Failed to create version:', error);
      showToast('Không thể tạo version mới.', 'error');
    }
  }, [editor, loadData, selectFamily, selectedVersionId, showToast]);

  const handleMoveFamily = useCallback(async () => {
    if (!selectedFamily || !editor.groupId) {
      showToast('Chọn family và group đích hợp lệ.', 'error');
      return;
    }
    if (selectedFamily.groupId === editor.groupId) {
      showToast('Family đã ở group này.', 'info');
      return;
    }

    try {
      await window.electronAPI.prompt.moveFamily({
        familyId: selectedFamily.familyId,
        targetGroupId: editor.groupId,
      });
      await loadData();
      selectFamily(selectedFamily.familyId);
      showToast('Đã chuyển family sang group mới.', 'success');
    } catch (error) {
      console.error('[PromptSettings] Failed to move family:', error);
      showToast('Không thể chuyển family.', 'error');
    }
  }, [editor.groupId, loadData, selectFamily, selectedFamily, showToast]);

  const handleDeleteVersion = useCallback(async () => {
    if (!activeVersion) {
      showToast('Không có version được chọn để xóa.', 'error');
      return;
    }

    if (!window.confirm(`Xóa version v${activeVersion.version} - ${activeVersion.name}?`)) {
      return;
    }

    try {
      await window.electronAPI.prompt.delete(activeVersion.id);
      await loadData();
      showToast('Đã xóa version.', 'success');
    } catch (error) {
      console.error('[PromptSettings] Failed to delete version:', error);
      showToast('Không thể xóa version.', 'error');
    }
  }, [activeVersion, loadData, showToast]);

  const handlePrepareNewFamily = useCallback(() => {
    const parsed = parseLanguageBucket(selectedLanguageBucket || 'zh->vi');
    const preferredGroup = groupsForLanguage[0]?.id || null;
    setEditorMode('new-family');
    setSelectedFamilyId('');
    setVersions([]);
    setSelectedVersionId('');
    setEditor({
      promptType: 'translation',
      name: '',
      description: '',
      sourceLang: parsed.sourceLang,
      targetLang: parsed.targetLang,
      groupId: preferredGroup,
      content: '',
    });
  }, [groupsForLanguage, selectedLanguageBucket]);

  const selectedGroup = useMemo(() => {
    if (selectedGroupFilter === GROUP_ALL || selectedGroupFilter === GROUP_UNGROUPED) {
      return null;
    }
    return groupsForLanguage.find((group) => group.id === selectedGroupFilter) || null;
  }, [groupsForLanguage, selectedGroupFilter]);

  useEffect(() => {
    setGroupRenameName(selectedGroup?.name || '');
  }, [selectedGroup]);

  const renderAssignmentCard = (func: PromptFunction, selectedFamilyValue: string, onChange: (value: string) => void) => {
    const meta = FUNCTION_META[func];
    const Icon = meta.icon;
    const typedOptions = familiesByType[func].slice().sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt);
    const isCaptionFallback = func === 'caption' && typedOptions.length === 0 && families.length > 0;
    const options = isCaptionFallback
      ? families.slice().sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt)
      : typedOptions;

    return (
      <div className={styles.assignmentCard}>
        <div className={styles.assignmentHeader}>
          <div className={styles.assignmentIcon}><Icon size={18} /></div>
          <div>
            <h3>{meta.label}</h3>
            <p>{meta.description}</p>
          </div>
        </div>

        <select
          className={styles.select}
          value={selectedFamilyValue}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Tự động theo ngôn ngữ/loại prompt</option>
          {options.map((family) => (
            <option key={family.familyId} value={family.familyId}>
              {family.latestName} v{family.latestVersion} • {formatBucketLabel(family.languageBucket)}{isCaptionFallback ? ` • ${family.promptType}` : ''}
            </option>
          ))}
        </select>

        {isCaptionFallback && (
          <div className={styles.assignmentNote}>
            Chưa có prompt loại caption. Đang cho phép chọn tạm từ toàn bộ bộ prompt.
          </div>
        )}

        {!isCaptionFallback && options.length === 0 && (
          <div className={styles.assignmentNote}>
            Chưa có prompt phù hợp cho chức năng này.
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className={shellStyles.detailContainer}>
        <div className={shellStyles.detailContent}>
          <div className={styles.loadingState}>
            <RefreshCw size={34} className={styles.spinning} />
            <p>Đang tải thư viện prompt...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={shellStyles.detailContainer}>
      <div className={styles.tabBar}>
        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'assign' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('assign')}
        >
          Gán chức năng
        </button>
        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'library' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('library')}
        >
          Ngôn ngữ / Nhóm / Bộ prompt / Phiên bản
        </button>
      </div>

      <div className={shellStyles.detailContent}>
        {activeTab === 'assign' && (
          <>
            <div className={styles.assignmentGrid}>
              {renderAssignmentCard('translation', translationFamilyId, (value) => handleAssignmentChange('translation', value))}
              {renderAssignmentCard('summary', summaryFamilyId, (value) => handleAssignmentChange('summary', value))}
              {renderAssignmentCard('caption', captionFamilyId, (value) => handleAssignmentChange('caption', value))}
            </div>

            <div className={styles.legacyHint}>
              <strong>Legacy sync:</strong> mỗi family được chọn sẽ tự đồng bộ sang promptId mới nhất để tương thích runtime cũ.
              <span>
                translationPromptId={legacyTranslationPromptId || 'null'} | summaryPromptId={legacySummaryPromptId || 'null'} | captionPromptId={legacyCaptionPromptId || 'null'}
              </span>
            </div>

            <div className={styles.stickySaveBar}>
              <div>
                {hasAssignmentChanges ? (
                  <span className={styles.pendingWarning}>
                    <AlertCircle size={16} /> Có thay đổi chưa lưu
                  </span>
                ) : (
                  <span className={styles.savedInfo}>Đang dùng cấu hình đã lưu.</span>
                )}
              </div>
              <Button variant="primary" onClick={handleSaveAssignments} disabled={!hasAssignmentChanges}>
                <Save size={16} /> Lưu ánh xạ prompt
              </Button>
            </div>
          </>
        )}

        {activeTab === 'library' && (
          <div className={styles.desktopShell}>
            <aside className={styles.languagePane}>
              <div className={styles.paneHeader}>Cặp ngôn ngữ</div>
              <div className={styles.languageCreateRow}>
                <select
                  className={styles.select}
                  value={bucketSourceLang}
                  onChange={(event) => setBucketSourceLang(event.target.value.toLowerCase())}
                >
                  {LANGUAGE_OPTIONS.map((language) => (
                    <option key={`source-${language.code}`} value={language.code}>
                      {language.label}
                    </option>
                  ))}
                </select>
                <span className={styles.languageArrow}>{'->'}</span>
                <select
                  className={styles.select}
                  value={bucketTargetLang}
                  onChange={(event) => setBucketTargetLang(event.target.value.toLowerCase())}
                >
                  {LANGUAGE_OPTIONS.map((language) => (
                    <option key={`target-${language.code}`} value={language.code}>
                      {language.label}
                    </option>
                  ))}
                </select>
                <Button variant="secondary" onClick={handleCreateLanguageBucket}>
                  <Plus size={14} /> Thêm
                </Button>
              </div>
              <div className={styles.languageList}>
                {languageBuckets.map((bucket) => {
                  const active = bucket.languageBucket === selectedLanguageBucket;
                  return (
                    <button
                      key={bucket.languageBucket}
                      type="button"
                      className={`${styles.languageItem} ${active ? styles.languageItemActive : ''}`}
                      onClick={() => {
                        setSelectedLanguageBucket(bucket.languageBucket);
                        setSelectedGroupFilter(GROUP_ALL);
                      }}
                    >
                      <div className={styles.languageTitle}>{formatBucketLabel(bucket.languageBucket)}</div>
                      <div className={styles.languageMeta}>{bucket.totalFamilies} families • {bucket.totalPrompts} versions</div>
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className={styles.groupFamilyPane}>
              <div className={styles.paneHeader}>Nhóm & Bộ prompt</div>

              <div className={styles.groupActions}>
                <input
                  className={styles.input}
                  placeholder="Tạo group mới (ví dụ: bựa, vui vẻ...)"
                  value={groupDraftName}
                  onChange={(event) => setGroupDraftName(event.target.value)}
                />
                <Button variant="secondary" onClick={handleCreateGroup}>
                  <Plus size={14} /> Tạo group
                </Button>
              </div>

              <div className={styles.groupFilters}>
                <button
                  type="button"
                  className={`${styles.groupChip} ${selectedGroupFilter === GROUP_ALL ? styles.groupChipActive : ''}`}
                  onClick={() => setSelectedGroupFilter(GROUP_ALL)}
                >
                  Tất cả
                </button>
                <button
                  type="button"
                  className={`${styles.groupChip} ${selectedGroupFilter === GROUP_UNGROUPED ? styles.groupChipActive : ''}`}
                  onClick={() => setSelectedGroupFilter(GROUP_UNGROUPED)}
                >
                  Chưa nhóm
                </button>
                {groupsForLanguage.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    className={`${styles.groupChip} ${selectedGroupFilter === group.id ? styles.groupChipActive : ''}`}
                    onClick={() => setSelectedGroupFilter(group.id)}
                  >
                    {group.name}
                  </button>
                ))}
              </div>

              {selectedGroup && (
                <div className={styles.groupManageRow}>
                  <input
                    className={styles.input}
                    value={groupRenameName}
                    onChange={(event) => setGroupRenameName(event.target.value)}
                  />
                  <Button variant="secondary" onClick={handleRenameGroup}>
                    <Edit2 size={14} /> Đổi tên
                  </Button>
                  <Button variant="danger" onClick={handleDeleteGroup}>
                    <Trash2 size={14} /> Xóa
                  </Button>
                </div>
              )}

              <div className={styles.familyToolbar}>
                <Button variant="primary" onClick={handlePrepareNewFamily}>
                  <Plus size={14} /> Bộ prompt mới
                </Button>
              </div>

              <div className={styles.familyList}>
                {familyList.length === 0 && <div className={styles.emptyState}>Không có family nào trong bộ lọc hiện tại.</div>}
                {familyList.map((family) => {
                  const active = family.familyId === selectedFamilyId;
                  return (
                    <button
                      key={family.familyId}
                      type="button"
                      className={`${styles.familyItem} ${active ? styles.familyItemActive : ''}`}
                      onClick={() => {
                        setEditorMode('new-version');
                        selectFamily(family.familyId);
                      }}
                    >
                      <div className={styles.familyTitleRow}>
                        <strong>{family.latestName}</strong>
                        <span className={styles.versionBadge}>v{family.latestVersion}</span>
                      </div>
                      <div className={styles.familyMetaRow}>
                        <span>{family.promptType}</span>
                        <span>{family.groupName || 'Ungrouped'}</span>
                        <span>{new Date(family.latestUpdatedAt).toLocaleString()}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className={styles.inspectorPane}>
              <div className={styles.paneHeader}>Chi tiết phiên bản</div>

              <div className={styles.editorTopRow}>
                <select
                  className={styles.select}
                  value={editorMode}
                  onChange={(event) => setEditorMode(event.target.value as EditorMode)}
                >
                  <option value="new-version">Tạo phiên bản mới trong bộ hiện tại</option>
                  <option value="new-family">Tạo bộ prompt mới</option>
                </select>
                <div className={styles.editorActions}>
                  <Button
                    variant="primary"
                    onClick={() => {
                      if (editorMode === 'new-family') {
                        void handleCreateFamily();
                      } else {
                        void handleCreateVersion();
                      }
                    }}
                  >
                    <Save size={14} /> {editorMode === 'new-family' ? 'Tạo family' : 'Tạo version'}
                  </Button>
                  <Button variant="secondary" onClick={handleMoveFamily} disabled={!selectedFamilyId || !editor.groupId}>
                    Chuyển group
                  </Button>
                  <Button variant="danger" onClick={handleDeleteVersion} disabled={!activeVersion}>
                    <Trash2 size={14} /> Xóa version
                  </Button>
                </div>
              </div>

              <div className={styles.versionRail}>
                {versions.length === 0 && <div className={styles.emptyState}>Chọn family để xem timeline version.</div>}
                {versions.map((version) => (
                  <button
                    key={version.id}
                    type="button"
                    className={`${styles.versionItem} ${selectedVersionId === version.id ? styles.versionItemActive : ''}`}
                    onClick={() => {
                      setEditorMode('new-version');
                      setSelectedVersionId(version.id);
                      setEditor({
                        promptType: version.promptType,
                        name: version.name,
                        description: version.description || '',
                        sourceLang: version.sourceLang,
                        targetLang: version.targetLang,
                        groupId: version.groupId,
                        content: version.content || '',
                      });
                    }}
                  >
                    <strong>v{version.version}</strong>
                    <span>{new Date(version.updatedAt).toLocaleString()}</span>
                    {version.isLatest && <span className={styles.latestBadge}>latest</span>}
                  </button>
                ))}
              </div>

              <div className={styles.editorForm}>
                <div className={styles.formGrid3}>
                  <div>
                    <label>Prompt Type</label>
                    <select
                      className={styles.select}
                      value={editor.promptType}
                      onChange={(event) => setEditor((prev) => ({ ...prev, promptType: event.target.value as PromptType }))}
                    >
                      <option value="translation">translation</option>
                      <option value="summary">summary</option>
                      <option value="caption">caption</option>
                    </select>
                  </div>
                  <div>
                    <label>Source</label>
                    <input
                      className={styles.input}
                      value={editor.sourceLang}
                      onChange={(event) => setEditor((prev) => ({ ...prev, sourceLang: event.target.value.toLowerCase() }))}
                    />
                  </div>
                  <div>
                    <label>Target</label>
                    <input
                      className={styles.input}
                      value={editor.targetLang}
                      onChange={(event) => setEditor((prev) => ({ ...prev, targetLang: event.target.value.toLowerCase() }))}
                    />
                  </div>
                </div>

                <div className={styles.formGrid2}>
                  <div>
                    <label>Tên Prompt</label>
                    <input
                      className={styles.input}
                      value={editor.name}
                      onChange={(event) => setEditor((prev) => ({ ...prev, name: event.target.value }))}
                      placeholder="Ví dụ: Dịch tiên hiệp kiểu đời thường"
                    />
                  </div>
                  <div>
                    <label>Group</label>
                    <select
                      className={styles.select}
                      value={editor.groupId || ''}
                      onChange={(event) => setEditor((prev) => ({ ...prev, groupId: event.target.value || null }))}
                    >
                      <option value="">Không group</option>
                      {groupsForLanguage.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label>Mô tả</label>
                  <input
                    className={styles.input}
                    value={editor.description}
                    onChange={(event) => setEditor((prev) => ({ ...prev, description: event.target.value }))}
                    placeholder="Mô tả style prompt và mục tiêu dùng"
                  />
                </div>

                <div>
                  <label>Nội dung Prompt</label>
                  <textarea
                    className={styles.textarea}
                    value={editor.content}
                    onChange={(event) => setEditor((prev) => ({ ...prev, content: event.target.value }))}
                    placeholder="Nhập template prompt..."
                  />
                  <div className={styles.charCount}>{editor.content.length} ký tự</div>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>

      <Button
        variant="secondary"
        iconOnly
        className={styles.floatingBackButton}
        onClick={onBack}
        title="Quay lại"
      >
        <ArrowLeft size={18} />
      </Button>

      {toast && (
        <div className={`${styles.toast} ${styles[`toast_${toast.type}`]}`}>
          {toast.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
