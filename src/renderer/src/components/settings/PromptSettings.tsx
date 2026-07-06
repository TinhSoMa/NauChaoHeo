import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Edit2,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Subtitles,
  Trash2,
  RotateCcw,
} from 'lucide-react';
import { Button } from '../common/Button';
import { BracketTextarea } from './BracketTextarea';
import styles from './PromptSettings.module.css';

type PromptType = 'translation' | 'summary' | 'caption';
type PromptFunction = PromptType;
type GroupFilter = '__all__' | '__ungrouped__' | string;
type EditorMode = 'new-family' | 'new-version' | 'edit-family';
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

const FUNCTION_META: Record<PromptFunction, { label: string; icon: typeof Sparkles; description: string }> = {
  translation: { label: 'Dịch truyện', icon: BookOpen, description: 'Áp dụng cho luồng dịch chương truyện.' },
  summary: { label: 'Tóm tắt', icon: Sparkles, description: 'Áp dụng cho bước tạo tóm tắt chương.' },
  caption: { label: 'Phụ đề (Bước 3)', icon: Subtitles, description: 'Áp dụng cho dịch phụ đề trong tab Phụ đề.' },
};

const LANGUAGE_NAMES: Record<string, string> = {
  zh: 'Tiếng Trung',
  vi: 'Tiếng Việt',
  en: 'Tiếng Anh',
  ja: 'Tiếng Nhật',
  ko: 'Tiếng Hàn',
  fr: 'Tiếng Pháp',
  de: 'Tiếng Đức',
  es: 'Tiếng Tây Ban Nha',
  pt: 'Tiếng Bồ Đào Nha',
  ru: 'Tiếng Nga',
  ar: 'Tiếng Ả Rập',
  th: 'Tiếng Thái',
  hi: 'Tiếng Hindi',
};

function formatLanguageCode(code: string): string {
  return LANGUAGE_NAMES[code.toLowerCase()] || code.toUpperCase();
}

function formatBucket(bucket: string): string {
  const parts = bucket.split('->');
  if (parts.length === 2) {
    return `${formatLanguageCode(parts[0])} → ${formatLanguageCode(parts[1])}`;
  }
  return bucket;
}

function toLanguageBucket(sourceLang: string, targetLang: string): string {
  return `${sourceLang.trim().toLowerCase()}->${targetLang.trim().toLowerCase()}`;
}

function toPromptRecord(row: any): PromptRecord {
  return {
    id: String(row.id),
    name: String(row.name || 'Chưa đặt tên'),
    description: row.description ? String(row.description) : '',
    sourceLang: String(row.sourceLang || 'zh').toLowerCase(),
    targetLang: String(row.targetLang || 'vi').toLowerCase(),
    content: typeof row.content === 'string' ? row.content : '',
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
    latestName: String(row.latestName || 'Chưa đặt tên'),
    latestVersion: Number(row.latestVersion || 1),
    latestUpdatedAt: Number(row.latestUpdatedAt || Date.now()),
  };
}

export function PromptSettings() {
  const [loading, setLoading] = useState(true);

  const [families, setFamilies] = useState<PromptFamilyRecord[]>([]);
  const [groups, setGroups] = useState<PromptGroupRecord[]>([]);

  const [translationFamilyId, setTranslationFamilyId] = useState<string>('');
  const [summaryFamilyId, setSummaryFamilyId] = useState<string>('');
  const [captionFamilyId, setCaptionFamilyId] = useState<string>('');
  const [hasAssignmentChanges, setHasAssignmentChanges] = useState(false);

  const [selectedGroupFilter, setSelectedGroupFilter] = useState<GroupFilter>(GROUP_ALL);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string>('');
  const [versions, setVersions] = useState<PromptRecord[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');

  const [systemPrompt, setSystemPrompt] = useState('');
  const [originalSystemPrompt, setOriginalSystemPrompt] = useState('');
  const [hasSystemPromptChanges, setHasSystemPromptChanges] = useState(false);

  const [groupDraftName, setGroupDraftName] = useState('');
  const [groupDraftBucket, setGroupDraftBucket] = useState('zh->vi');
  const [showGroupModal, setShowGroupModal] = useState(false);

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
  const [versionRefreshKey, setVersionRefreshKey] = useState(0);
  const [systemCollapsed, setSystemCollapsed] = useState(true);
  const [userCollapsed, setUserCollapsed] = useState(false);
  const selectedFamilyIdRef = useRef('');

  const showToast = useCallback((message: string, type: ToastType) => {
    setToast({ message, type });
    window.setTimeout(() => setToast((prev) => (prev?.message === message ? null : prev)), 3200);
  }, []);

  const familiesByType = useMemo(() => ({
    translation: families.filter((f) => f.promptType === 'translation'),
    summary: families.filter((f) => f.promptType === 'summary'),
    caption: families.filter((f) => f.promptType === 'caption'),
  }), [families]);

  const selectedFamily = useMemo(
    () => families.find((f) => f.familyId === selectedFamilyId) || null,
    [families, selectedFamilyId]
  );

  const activeVersion = useMemo(
    () => versions.find((v) => v.id === selectedVersionId) || null,
    [versions, selectedVersionId]
  );

  const familyList = useMemo(() => {
    const bucket = selectedFamily?.languageBucket || '';
    const filtered = families.filter((f) => {
      if (selectedGroupFilter === GROUP_ALL) return true;
      if (bucket && f.languageBucket !== bucket) return false;
      if (selectedGroupFilter === GROUP_UNGROUPED) return !f.groupId;
      if (selectedGroupFilter) return f.groupId === selectedGroupFilter;
      return true;
    });
    return filtered.sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt);
  }, [families, selectedFamily, selectedGroupFilter]);

  const availableBuckets = useMemo(() => {
    const buckets = new Set(groups.map((g) => g.languageBucket));
    const current = selectedFamily?.languageBucket || 'zh->vi';
    buckets.add(current);
    return [...buckets].sort();
  }, [groups, selectedFamily]);

  const selectFamily = useCallback((familyId: string) => {
    setSelectedFamilyId(familyId);
    const family = families.find((f) => f.familyId === familyId);
    if (!family) return;
    setEditor((prev) => ({
      ...prev,
      promptType: family.promptType,
      sourceLang: family.sourceLang,
      targetLang: family.targetLang,
      groupId: family.groupId,
    }));
  }, [families]);

  const loadData = useCallback(async (preferredFamilyId?: string) => {
    setLoading(true);
    try {
      const sysPromptRaw = await window.electronAPI.deepSeek.getSystemPrompt();
      const sysPrompt = sysPromptRaw?.success ? (sysPromptRaw.data ?? '') : '';
      setSystemPrompt(sysPrompt);
      setOriginalSystemPrompt(sysPrompt);

      const [hierarchy, settingsRes] = await Promise.all([
        window.electronAPI.prompt.getHierarchy(),
        window.electronAPI.appSettings.getAll(),
      ]);

      const normalizedFamilies = Array.isArray(hierarchy?.families) ? hierarchy.families.map(toFamilyRecord) : [];
      const normalizedGroups = Array.isArray(hierarchy?.groups)
        ? hierarchy.groups.map((g: any) => ({ id: String(g.id), languageBucket: String(g.languageBucket), name: String(g.name) }))
        : [];

      setFamilies(normalizedFamilies);
      setGroups(normalizedGroups);

      const targetId = preferredFamilyId || selectedFamilyIdRef.current;
      if (targetId && normalizedFamilies.some((f: PromptFamilyRecord) => f.familyId === targetId)) {
        setSelectedFamilyId(targetId);
      } else if (normalizedFamilies.length > 0) {
        setSelectedFamilyId(normalizedFamilies[0].familyId);
      }

      if (settingsRes.success && settingsRes.data) {
        const s = settingsRes.data;
        setTranslationFamilyId(s.translationPromptFamilyId || '');
        setSummaryFamilyId(s.summaryPromptFamilyId || '');
        setCaptionFamilyId(s.captionPromptFamilyId || '');
      }

      setHasAssignmentChanges(false);
    } catch (error) {
      console.error('[PromptSettings] load failed:', error);
      showToast('Không thể tải Prompt Library.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => { selectedFamilyIdRef.current = selectedFamilyId; }, [selectedFamilyId]);

  useEffect(() => {
    if (!selectedFamilyId) {
      setVersions([]);
      setSelectedVersionId('');
      return;
    }
    let disposed = false;
    const load = async () => {
      try {
        const rows = await window.electronAPI.prompt.getVersions(selectedFamilyId);
        if (disposed) return;
        const next = Array.isArray(rows) ? rows.map(toPromptRecord) : [];
        setVersions(next);
        const preferred = next.find((v) => v.isLatest) || next[0] || null;
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
        console.error('[PromptSettings] load versions failed:', error);
        if (!disposed) showToast('Không thể tải danh sách version.', 'error');
      }
    };
    void load();
    return () => { disposed = true; };
  }, [selectedFamilyId, showToast, versionRefreshKey]);

  useEffect(() => {
    if (!selectedFamilyId) return;
    if (!familyList.some((f) => f.familyId === selectedFamilyId)) {
      setSelectedFamilyId(familyList[0]?.familyId || '');
    }
  }, [familyList, selectedFamilyId]);

  useEffect(() => {
    setHasSystemPromptChanges(systemPrompt !== originalSystemPrompt);
  }, [systemPrompt, originalSystemPrompt]);

  const handleSaveSystemPrompt = useCallback(async () => {
    try {
      const res = await window.electronAPI.deepSeek.setSystemPrompt(systemPrompt);
      if (!res.success) {
        showToast('Lưu System Prompt thất bại.', 'error');
        return;
      }
      setOriginalSystemPrompt(systemPrompt);
      setHasSystemPromptChanges(false);
      showToast('Đã lưu System Prompt.', 'success');
    } catch (error) {
      console.error('[PromptSettings] save system prompt failed:', error);
      showToast('Lưu System Prompt thất bại.', 'error');
    }
  }, [systemPrompt, showToast]);

  const handleResetSystemPrompt = useCallback(async () => {
    try {
      const resetRaw = await window.electronAPI.deepSeek.resetSystemPrompt();
      if (!resetRaw.success) {
        showToast('Reset System Prompt thất bại.', 'error');
        return;
      }
      const defaultPrompt = resetRaw.data ?? '';
      setSystemPrompt(defaultPrompt);
      setOriginalSystemPrompt(defaultPrompt);
      showToast('Đã reset System Prompt về mặc định.', 'success');
    } catch (error) {
      console.error('[PromptSettings] reset system prompt failed:', error);
      showToast('Reset System Prompt thất bại.', 'error');
    }
  }, [showToast]);

  const handleAssignmentChange = useCallback((func: PromptFunction, value: string) => {
    if (func === 'translation') setTranslationFamilyId(value);
    if (func === 'summary') setSummaryFamilyId(value);
    if (func === 'caption') setCaptionFamilyId(value);
    setHasAssignmentChanges(true);
  }, []);

  const handleSaveAssignments = useCallback(async () => {
    try {
      const resolveId = (familyId: string) => families.find((f) => f.familyId === familyId)?.latestPromptId || null;
      await window.electronAPI.appSettings.update({
        translationPromptFamilyId: translationFamilyId || null,
        summaryPromptFamilyId: summaryFamilyId || null,
        captionPromptFamilyId: captionFamilyId || null,
        translationPromptId: resolveId(translationFamilyId),
        summaryPromptId: resolveId(summaryFamilyId),
        captionPromptId: resolveId(captionFamilyId),
      });
      setHasAssignmentChanges(false);
      showToast('Đã lưu ánh xạ prompt.', 'success');
    } catch (error) {
      console.error('[PromptSettings] save assignments failed:', error);
      showToast('Lưu ánh xạ thất bại.', 'error');
    }
  }, [captionFamilyId, families, showToast, summaryFamilyId, translationFamilyId]);

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
      if (created?.familyId) {
        await loadData(created.familyId);
        selectFamily(created.familyId);
        setVersionRefreshKey((k) => k + 1);
      }
      showToast('Đã tạo family prompt mới.', 'success');
    } catch (error) {
      console.error('[PromptSettings] create family failed:', error);
      showToast('Tạo family thất bại.', 'error');
    }
  }, [editor, loadData, selectFamily, showToast]);

  const handleCreateVersion = useCallback(async () => {
    if (!selectedVersionId) {
      showToast('Chọn một version làm base.', 'error');
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
      if (created?.familyId) {
        await loadData(created.familyId);
        selectFamily(created.familyId);
        setVersionRefreshKey((k) => k + 1);
      }
      showToast('Đã tạo version mới.', 'success');
    } catch (error) {
      console.error('[PromptSettings] create version failed:', error);
      showToast('Tạo version thất bại.', 'error');
    }
  }, [editor, loadData, selectFamily, selectedVersionId, showToast]);

  const handleUpdateVersion = useCallback(async () => {
    if (!activeVersion) {
      showToast('Không có version được chọn.', 'error');
      return;
    }
    if (!editor.name.trim() || !editor.content.trim()) {
      showToast('Tên và nội dung prompt là bắt buộc.', 'error');
      return;
    }
    try {
      await window.electronAPI.prompt.updateInPlace(activeVersion.id, {
        name: editor.name.trim(),
        description: editor.description.trim() || undefined,
        sourceLang: editor.sourceLang,
        targetLang: editor.targetLang,
        content: editor.content,
        promptType: editor.promptType,
        groupId: editor.groupId || null,
      });
      await loadData();
      setVersionRefreshKey((k) => k + 1);
      showToast('Đã cập nhật version.', 'success');
    } catch (error) {
      console.error('handleUpdateVersion error:', error);
      showToast('Cập nhật version thất bại.', 'error');
    }
  }, [activeVersion, editor, loadData, setVersionRefreshKey, showToast]);

  const handleDeleteVersion = useCallback(async () => {
    if (!activeVersion) {
      showToast('Không có version được chọn.', 'error');
      return;
    }
    if (!window.confirm(`Xóa phiên bản v${activeVersion.version} - ${activeVersion.name}?`)) return;
    try {
      await window.electronAPI.prompt.delete(activeVersion.id);
      await loadData();
      setVersionRefreshKey((k) => k + 1);
      showToast('Đã xóa version.', 'success');
    } catch (error) {
      console.error('[PromptSettings] delete version failed:', error);
      showToast('Xóa phiên bản thất bại.', 'error');
    }
  }, [activeVersion, loadData, setVersionRefreshKey, showToast]);

  const handlePrepareNewFamily = useCallback(() => {
    const ctx = selectedFamily || familyList[0] || null;
    const src = ctx?.sourceLang || 'zh';
    const dst = ctx?.targetLang || 'vi';
    setEditorMode('new-family');
    setSelectedFamilyId('');
    setVersions([]);
    setSelectedVersionId('');
    setEditor({
      promptType: 'translation',
      name: '',
      description: '',
      sourceLang: src,
      targetLang: dst,
      groupId: null,
      content: '',
    });
  }, [selectedFamily, familyList]);

  const handleCreateGroup = useCallback(async () => {
    if (!groupDraftName.trim()) {
      showToast('Nhập tên nhóm.', 'error');
      return;
    }
    try {
      await window.electronAPI.prompt.createGroup({
        languageBucket: groupDraftBucket,
        name: groupDraftName.trim(),
      });
      setGroupDraftName('');
      setShowGroupModal(false);
      await loadData();
      showToast('Đã tạo group mới.', 'success');
    } catch (error) {
      console.error('[PromptSettings] create group failed:', error);
      showToast('Tạo group thất bại.', 'error');
    }
  }, [groupDraftName, groupDraftBucket, loadData, showToast]);

  const handleDeleteGroup = useCallback(async (groupId: string, groupName: string) => {
    if (!window.confirm(`Xoá nhóm "${groupName}"? Các prompt trong nhóm sẽ được chuyển về "General".`)) return;
    try {
      await window.electronAPI.prompt.deleteGroup(groupId);
      await loadData();
      showToast('Đã xoá nhóm.', 'success');
    } catch (error) {
      console.error('[PromptSettings] delete group failed:', error);
      showToast('Xoá nhóm thất bại.', 'error');
    }
  }, [loadData, showToast]);

  const renderAssignmentBar = () => {
    const renderBadge = (func: PromptFunction, value: string, onChange: (v: string) => void) => {
      const meta = FUNCTION_META[func];
      const Icon = meta.icon;
      const isCaptionFallback = func === 'caption' && familiesByType.caption.length === 0;
      const source = isCaptionFallback ? families : familiesByType[func];
      const options = source.slice().sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt);
      const isAssigned = value && options.some((f) => f.familyId === value);

      return (
        <div className={styles.assignBadge}>
          <Icon size={14} />
          <span className={styles.assignLabel}>{meta.label}</span>
          <select
            className={styles.assignSelect}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">—</option>
            {options.map((f) => (
              <option key={f.familyId} value={f.familyId}>
                {f.latestName} v{f.latestVersion}
              </option>
            ))}
          </select>
          {isAssigned && <Check size={12} className={styles.assignCheck} />}
        </div>
      );
    };

    return (
      <div className={styles.assignmentBar}>
        <div className={styles.assignBarLabel}>Gán prompt cho chức năng:</div>
        <div className={styles.assignBadges}>
          {renderBadge('caption', captionFamilyId, (v) => handleAssignmentChange('caption', v))}
          {renderBadge('translation', translationFamilyId, (v) => handleAssignmentChange('translation', v))}
          {renderBadge('summary', summaryFamilyId, (v) => handleAssignmentChange('summary', v))}
        </div>
        <div className={styles.assignBarActions}>
          {hasAssignmentChanges && (
            <span className={styles.pendingWarning}>
              <AlertCircle size={14} /> Chưa lưu
            </span>
          )}
          <Button variant="primary" size="sm" onClick={handleSaveAssignments} disabled={!hasAssignmentChanges}>
            <Save size={14} /> Lưu
          </Button>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.content}>
          <div className={styles.loadingState}>
            <RefreshCw size={34} className={styles.spinning} />
            <p>Đang tải thư viện prompt...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={`${styles.content} ${styles.mainLayout}`}>
        {/* Left column — prompt list */}
        <aside className={styles.leftPane}>
          <div className={styles.leftPaneHeader}>
            <span className={styles.leftPaneTitle}>Bộ prompt</span>
            <Button variant="primary" size="sm" onClick={handlePrepareNewFamily}>
              <Plus size={14} /> Mới
            </Button>
          </div>

          <div className={styles.filterRow}>
            <select
              className={styles.filterSelect}
              value={selectedGroupFilter}
              onChange={(e) => setSelectedGroupFilter(e.target.value as GroupFilter)}
            >
              <option value={GROUP_ALL}>Tất cả</option>
              <option value={GROUP_UNGROUPED}>Chưa nhóm</option>
              {groups.filter((g) => selectedGroupFilter === GROUP_ALL || g.languageBucket === (selectedFamily?.languageBucket || 'zh->vi')).map((g) => (
                <option key={g.id} value={g.id}>{g.name} — {g.languageBucket}</option>
              ))}
            </select>
            <button
              type="button"
              className={styles.groupManageBtn}
              onClick={() => { setGroupDraftBucket(selectedFamily?.languageBucket || 'zh->vi'); setShowGroupModal(true); }}
              title="Quản lý nhóm"
            >
              <Edit2 size={14} />
            </button>
          </div>

          <div className={styles.promptList}>
            {familyList.length === 0 && (
              <div className={styles.emptyState}>Chưa có bộ prompt nào.</div>
            )}
            {familyList.map((family) => {
              const active = family.familyId === selectedFamilyId;
              const isCaption = captionFamilyId === family.familyId;
              const isTranslation = translationFamilyId === family.familyId;
              const isSummary = summaryFamilyId === family.familyId;
              const assignedTo = [isCaption && 'Capt', isTranslation && 'Dịch', isSummary && 'Tóm'].filter(Boolean);

              return (
                <button
                  key={family.familyId}
                  type="button"
                  className={`${styles.promptCard} ${active ? styles.promptCardActive : ''}`}
                  onClick={() => selectFamily(family.familyId)}
                >
                  <div className={styles.promptCardHeader}>
                    <strong>{family.latestName}</strong>
                    <span className={styles.versionBadge}>v{family.latestVersion}</span>
                  </div>
                  <div className={styles.promptCardMeta}>
                    <span className={`${styles.promptTypeBadge} ${styles[`promptType_${family.promptType}`]}`}>{family.promptType}</span>
                    <span>{family.groupName || 'Chưa nhóm'}</span>
                  </div>
                  <div className={styles.promptCardFooter}>
                    <span className={styles.promptCardTime}>
                      {new Date(family.latestUpdatedAt).toLocaleDateString()}
                    </span>
                    {assignedTo.length > 0 && (
                      <span className={styles.assignedBadge}>
                        {assignedTo.join(', ')}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Right column — editor */}
        <section className={styles.rightPane}>
          {!selectedFamily && editorMode !== 'new-family' ? (
            <div className={styles.emptyState}>Chọn một bộ prompt để xem chi tiết.</div>
          ) : (
            <>
              {/* Top row: name, type, lang, group */}
              <div className={styles.editorTopRow}>
                <div className={styles.editorNameGroup}>
                  <input
                    className={styles.input}
                    value={editor.name}
                    onChange={(e) => setEditor((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Tên prompt"
                  />
                  <select
                    className={styles.select}
                    value={editor.promptType}
                    onChange={(e) => setEditor((prev) => ({ ...prev, promptType: e.target.value as PromptType }))}
                  >
                    <option value="caption">phụ đề</option>
                    <option value="translation">dịch truyện</option>
                    <option value="summary">tóm tắt</option>
                  </select>
                </div>
                <div className={styles.editorLangGroup}>
                  <select
                    className={styles.select}
                    value={editor.sourceLang}
                    onChange={(e) => setEditor((prev) => ({ ...prev, sourceLang: e.target.value }))}
                  >
                    {Object.entries(LANGUAGE_NAMES).map(([code, label]) => (
                      <option key={code} value={code}>{label} ({code})</option>
                    ))}
                  </select>
                  <span className={styles.langArrow}>→</span>
                  <select
                    className={styles.select}
                    value={editor.targetLang}
                    onChange={(e) => setEditor((prev) => ({ ...prev, targetLang: e.target.value }))}
                  >
                    {Object.entries(LANGUAGE_NAMES).map(([code, label]) => (
                      <option key={code} value={code}>{label} ({code})</option>
                    ))}
                  </select>
                  <select
                    className={styles.select}
                    value={editor.groupId || ''}
                    onChange={(e) => setEditor((prev) => ({ ...prev, groupId: e.target.value || null }))}
                  >
                    <option value="">Không nhóm</option>
                    {groups.filter((g) => g.languageBucket === toLanguageBucket(editor.sourceLang, editor.targetLang)).map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* System Prompt section */}
              <div className={`${styles.sectionCard}${systemCollapsed ? ` ${styles.sectionCardCollapsed}` : ''}`}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionHeaderLeft}>
                    <button
                      type="button"
                      className={styles.collapseBtn}
                      onClick={() => setSystemCollapsed((v) => !v)}
                    >
                      {systemCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <span className={styles.sectionTitle}>System Prompt</span>
                  </div>
                  <div className={styles.sectionActions}>
                    {!systemCollapsed && hasSystemPromptChanges && (
                      <Button variant="primary" size="sm" onClick={handleSaveSystemPrompt}>
                        <Save size={14} /> Lưu System Prompt
                      </Button>
                    )}
                    {!systemCollapsed && (
                      <Button variant="secondary" size="sm" onClick={handleResetSystemPrompt} title="Reset về mặc định">
                        <RotateCcw size={14} /> Mặc định
                      </Button>
                    )}
                  </div>
                </div>
                {!systemCollapsed && (
                  <textarea
                    className={styles.textareaSystem}
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="System prompt cho DeepSeek..."
                  />
                )}
              </div>

              {/* User Prompt section */}
              <div className={`${styles.sectionCard}${userCollapsed ? ` ${styles.sectionCardCollapsed}` : ''}`}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionHeaderLeft}>
                    <button
                      type="button"
                      className={styles.collapseBtn}
                      onClick={() => setUserCollapsed((v) => !v)}
                    >
                      {userCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <span className={styles.sectionTitle}>User Prompt</span>
                    {versions.length > 0 && !userCollapsed && (
                      <div className={styles.versionInline}>
                        <span className={styles.versionLabel}>Phiên bản:</span>
                        <select
                          className={styles.select}
                          value={selectedVersionId}
                          onChange={(e) => {
                            const ver = versions.find((v) => v.id === e.target.value);
                            if (!ver) return;
                            setSelectedVersionId(ver.id);
                            setEditor({
                              promptType: ver.promptType,
                              name: ver.name,
                              description: ver.description || '',
                              sourceLang: ver.sourceLang,
                              targetLang: ver.targetLang,
                              groupId: ver.groupId,
                              content: ver.content || '',
                            });
                          }}
                        >
                          {versions.map((ver) => (
                            <option key={ver.id} value={ver.id}>
                              v{ver.version} — {ver.name} {ver.isLatest ? '(mới nhất)' : ''} — {new Date(ver.updatedAt).toLocaleDateString()}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {editor.content.length > 0 && !userCollapsed && (
                      <span className={styles.charCount}>{editor.content.length} ký tự</span>
                    )}
                  </div>
                  {!userCollapsed && (
                    <div className={styles.sectionActions}>
                      <select
                        className={styles.select}
                        value={editorMode}
                        onChange={(e) => setEditorMode(e.target.value as EditorMode)}
                      >
                        <option value="edit-family">Chỉnh sửa phiên bản hiện tại</option>
                        <option value="new-version">Tạo phiên bản mới</option>
                        <option value="new-family">Tạo bộ prompt mới</option>
                      </select>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => {
                          if (editorMode === 'new-family') void handleCreateFamily();
                          else if (editorMode === 'edit-family') void handleUpdateVersion();
                          else void handleCreateVersion();
                        }}
                      >
                        <Save size={14} />
                        {editorMode === 'new-family' ? 'Tạo bộ mới' : editorMode === 'edit-family' ? 'Cập nhật' : 'Lưu'}
                      </Button>
                      <Button variant="danger" size="sm" onClick={handleDeleteVersion} disabled={!activeVersion}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  )}
                </div>
                {!userCollapsed && (
                  <>
                    <div className={styles.editorDesc}>
                      <input
                        className={styles.input}
                        value={editor.description}
                        onChange={(e) => setEditor((prev) => ({ ...prev, description: e.target.value }))}
                        placeholder="Mô tả phong cách prompt..."
                      />
                    </div>
                    <BracketTextarea
                      value={editor.content}
                      onChange={(val) => setEditor((prev) => ({ ...prev, content: val }))}
                      placeholder="Nội dung prompt..."
                    />
                  </>
                )}
              </div>


            </>
          )}
        </section>
      </div>

      {/* Assignment bar */}
      {renderAssignmentBar()}

      {/* Group modal */}
      {showGroupModal && (
        <div className={styles.modalOverlay} onClick={() => setShowGroupModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>Quản lý nhóm</h3>
            <div className={styles.modalBody}>
              <div className={styles.modalRow}>
                <input
                  className={styles.input}
                  placeholder="Tên nhóm mới"
                  value={groupDraftName}
                  onChange={(e) => setGroupDraftName(e.target.value)}
                />
                <select
                  className={styles.select}
                  value={groupDraftBucket}
                  onChange={(e) => setGroupDraftBucket(e.target.value)}
                  style={{ width: 110 }}
                >
                  {availableBuckets.map((b) => (
                    <option key={b} value={b}>{formatBucket(b)}</option>
                  ))}
                </select>
                <Button variant="primary" size="sm" onClick={handleCreateGroup}>
                  <Plus size={14} /> Tạo
                </Button>
              </div>
              <div className={styles.groupList}>
                {availableBuckets.length === 0 && (
                  <span className={styles.emptyState}>Chưa có nhóm nào.</span>
                )}
                {availableBuckets.map((bucket) => {
                  const bucketGroups = groups.filter((g) => g.languageBucket === bucket);
                  if (bucketGroups.length === 0) return null;
                  return (
                    <div key={bucket} className={styles.groupBucketSection}>
                      <div className={styles.groupBucketHeader}>{formatBucket(bucket)}</div>
                      {bucketGroups.map((g) => (
                        <div key={g.id} className={styles.groupRow}>
                          <span>{g.name}</span>
                          <div className={styles.groupRowActions}>
                            <span className={styles.groupRowCode}>{g.languageBucket}</span>
                            <button
                              type="button"
                              className={styles.groupDeleteBtn}
                              onClick={() => handleDeleteGroup(g.id, g.name)}
                              title="Xoá nhóm"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className={styles.modalFooter}>
              <Button variant="secondary" size="sm" onClick={() => setShowGroupModal(false)}>Đóng</Button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`${styles.toast} ${styles[`toast_${toast.type}`]}`}>
          {toast.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
