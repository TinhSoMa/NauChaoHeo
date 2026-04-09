/**
 * TranslationSettings - Cau hinh dich thuat
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { ArrowLeft, Save, RotateCcw, Plus, Trash2, RefreshCw } from 'lucide-react';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import styles from './Settings.module.css';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_BATCH_SIZE,
  DEFAULT_RETRY_COUNT,
} from '../../config/captionConfig';

interface TranslationSettingsProps {
  onBack: () => void;
}

type ModelDraft = {
  modelId: string;
  name: string;
  label: string;
  description: string;
  enabled: boolean;
  source: 'seed' | 'manual' | 'google_sync';
  sortOrder: number;
};

type ModelFilter = 'all' | 'enabled' | 'disabled' | 'manual' | 'google_sync' | 'seed';

const MODEL_FILTER_OPTIONS: Array<{ value: ModelFilter; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'enabled', label: 'Đang bật' },
  { value: 'disabled', label: 'Đang tắt' },
  { value: 'manual', label: 'Manual' },
  { value: 'google_sync', label: 'Google' },
  { value: 'seed', label: 'Seed' },
];

const MODEL_SOURCE_LABELS: Record<ModelDraft['source'], string> = {
  seed: 'Seed',
  manual: 'Manual',
  google_sync: 'Google Sync',
};

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
};

function sortModels(models: ModelDraft[]): ModelDraft[] {
  return [...models].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder;
    }
    return a.modelId.localeCompare(b.modelId);
  });
}

export function TranslationSettings({ onBack }: TranslationSettingsProps) {
  const [defaultModel, setDefaultModel] = useState<string>(DEFAULT_GEMINI_MODEL);
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);
  const [retryCount, setRetryCount] = useState(DEFAULT_RETRY_COUNT);
  const [models, setModels] = useState<ModelDraft[]>([]);
  const [newModelId, setNewModelId] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [newModelLabel, setNewModelLabel] = useState('');
  const [newModelDescription, setNewModelDescription] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [modelFilter, setModelFilter] = useState<ModelFilter>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [modelsRes, defaultRes, appSettingsRes] = await Promise.all([
        window.electronAPI.gemini.getModels(),
        window.electronAPI.gemini.getDefaultModel(),
        window.electronAPI.appSettings.getAll(),
      ]);

      if (!modelsRes.success || !modelsRes.data) {
        throw new Error(modelsRes.error || 'Không tải được danh sách model');
      }

      const mappedModels: ModelDraft[] = modelsRes.data.map((model) => ({
        modelId: model.modelId,
        name: model.name,
        label: model.label,
        description: model.description || '',
        enabled: model.enabled,
        source: model.source,
        sortOrder: model.sortOrder,
      }));
      const sortedModels = sortModels(mappedModels);
      setModels(sortedModels);

      if (defaultRes.success && defaultRes.data) {
        setDefaultModel(defaultRes.data);
      } else {
        const fallbackDefault = sortedModels.find((item) => item.enabled)?.modelId || DEFAULT_GEMINI_MODEL;
        setDefaultModel(fallbackDefault);
      }

      if (appSettingsRes.success && appSettingsRes.data) {
        const settings = appSettingsRes.data as any;
        const loadedBatch = clamp(Number(settings.translationBatchSize), 10, 200);
        const loadedRetry = clamp(Number(settings.translationRetryCount), 0, 10);
        setBatchSize(Number.isFinite(Number(settings.translationBatchSize)) ? loadedBatch : DEFAULT_BATCH_SIZE);
        setRetryCount(Number.isFinite(Number(settings.translationRetryCount)) ? loadedRetry : DEFAULT_RETRY_COUNT);
      }
    } catch (loadError) {
      console.error('[TranslationSettings] Lỗi load settings:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Không thể tải dữ liệu settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSave = useCallback(() => {
    void (async () => {
      try {
        setSaving(true);
        setMessage(null);
        setError(null);

        const setDefaultResult = await window.electronAPI.gemini.setDefaultModel(defaultModel);
        if (!setDefaultResult.success) {
          throw new Error(setDefaultResult.error || 'Không thể lưu default model');
        }

        const normalizedBatchSize = clamp(batchSize, 10, 200);
        const normalizedRetryCount = clamp(retryCount, 0, 10);

        const saveAppSettingsRes = await window.electronAPI.appSettings.update({
          translationBatchSize: normalizedBatchSize,
          translationRetryCount: normalizedRetryCount,
        } as any);

        if (!saveAppSettingsRes.success) {
          throw new Error(saveAppSettingsRes.error || 'Không thể lưu batch/retry settings');
        }

        setBatchSize(normalizedBatchSize);
        setRetryCount(normalizedRetryCount);
        setMessage('Đã lưu cài đặt dịch thuật thành công.');
      } catch (saveError) {
        console.error('[TranslationSettings] Lỗi lưu settings:', saveError);
        setError(saveError instanceof Error ? saveError.message : 'Không thể lưu settings');
      } finally {
        setSaving(false);
      }
    })();
  }, [defaultModel, batchSize, retryCount]);

  const handleReset = useCallback(() => {
    setDefaultModel(DEFAULT_GEMINI_MODEL);
    setBatchSize(DEFAULT_BATCH_SIZE);
    setRetryCount(DEFAULT_RETRY_COUNT);
    setMessage(null);
    setError(null);
  }, []);

  const updateModelField = useCallback((modelId: string, patch: Partial<ModelDraft>) => {
    setModels((prev) => prev.map((item) => (
      item.modelId === modelId ? { ...item, ...patch } : item
    )));
  }, []);

  const handleAddModel = useCallback(() => {
    void (async () => {
      const modelId = newModelId.trim();
      const modelName = newModelName.trim();
      const modelLabel = newModelLabel.trim();

      if (!modelId || !modelName || !modelLabel) {
        setError('Vui lòng nhập đầy đủ Model ID, Name, Label trước khi thêm.');
        return;
      }

      setError(null);
      setMessage(null);

      const result = await window.electronAPI.gemini.createModel({
        modelId,
        name: modelName,
        label: modelLabel,
        description: newModelDescription.trim(),
      });

      if (!result.success || !result.data) {
        setError(result.error || 'Không thể thêm model mới.');
        return;
      }

      const createdModel = result.data;

      setModels((prev) => sortModels([
        ...prev,
        {
          modelId: createdModel.modelId,
          name: createdModel.name,
          label: createdModel.label,
          description: createdModel.description,
          enabled: createdModel.enabled,
          source: createdModel.source,
          sortOrder: createdModel.sortOrder,
        },
      ]));
      setNewModelId('');
      setNewModelName('');
      setNewModelLabel('');
      setNewModelDescription('');
      setMessage(`Đã thêm model ${createdModel.modelId}`);
    })();
  }, [newModelId, newModelName, newModelLabel, newModelDescription]);

  const handleUpdateModel = useCallback((modelId: string) => {
    void (async () => {
      const target = models.find((item) => item.modelId === modelId);
      if (!target) {
        return;
      }

      const result = await window.electronAPI.gemini.updateModel({
        modelId,
        patch: {
          name: target.name,
          label: target.label,
          description: target.description,
          sortOrder: target.sortOrder,
        },
      });

      if (!result.success || !result.data) {
        setError(result.error || `Không thể cập nhật model ${modelId}`);
        return;
      }

      setModels((prev) => sortModels(prev.map((item) => (
        item.modelId === modelId
          ? {
              ...item,
              name: result.data!.name,
              label: result.data!.label,
              description: result.data!.description,
              sortOrder: result.data!.sortOrder,
            }
          : item
      ))));
      setMessage(`Đã cập nhật model ${modelId}`);
      setError(null);
    })();
  }, [models]);

  const handleDeleteModel = useCallback((modelId: string) => {
    void (async () => {
      const shouldDelete = window.confirm(`Xóa model ${modelId}?`);
      if (!shouldDelete) {
        return;
      }

      const result = await window.electronAPI.gemini.deleteModel(modelId);
      if (!result.success) {
        setError(result.error || `Không thể xóa model ${modelId}`);
        return;
      }

      const next = models.filter((item) => item.modelId !== modelId);
      setModels(next);

      if (defaultModel === modelId) {
        const fallback = next.find((item) => item.enabled)?.modelId || DEFAULT_GEMINI_MODEL;
        setDefaultModel(fallback);
      }

      setMessage(`Đã xóa model ${modelId}`);
      setError(null);
    })();
  }, [models, defaultModel]);

  const handleToggleEnabled = useCallback((modelId: string, enabled: boolean) => {
    void (async () => {
      const result = await window.electronAPI.gemini.setModelEnabled({ modelId, enabled });
      if (!result.success) {
        setError(result.error || 'Không thể cập nhật trạng thái model');
        return;
      }

      setModels((prev) => prev.map((item) => (
        item.modelId === modelId ? { ...item, enabled } : item
      )));
      setError(null);
    })();
  }, []);

  const handleSyncModels = useCallback(() => {
    void (async () => {
      setSyncing(true);
      setError(null);
      setMessage(null);

      try {
        const result = await window.electronAPI.gemini.syncModelsFromGoogle();
        if (!result.success || !result.data) {
          throw new Error(result.error || 'Sync model thất bại');
        }

        await loadData();
        setMessage(`Sync thành công: ${result.data.syncedCount} model, bỏ qua ${result.data.skippedCount}.`);
      } catch (syncError) {
        setError(syncError instanceof Error ? syncError.message : 'Không thể sync model từ Google');
      } finally {
        setSyncing(false);
      }
    })();
  }, [loadData]);

  const modelStats = useMemo(() => {
    const total = models.length;
    const enabled = models.filter((item) => item.enabled).length;
    const disabled = total - enabled;
    const manual = models.filter((item) => item.source === 'manual').length;
    const google = models.filter((item) => item.source === 'google_sync').length;
    return { total, enabled, disabled, manual, google };
  }, [models]);

  const filteredModels = useMemo(() => {
    const keyword = modelSearch.trim().toLowerCase();

    return sortModels(models).filter((item) => {
      if (modelFilter === 'enabled' && !item.enabled) {
        return false;
      }
      if (modelFilter === 'disabled' && item.enabled) {
        return false;
      }
      if (modelFilter === 'manual' && item.source !== 'manual') {
        return false;
      }
      if (modelFilter === 'google_sync' && item.source !== 'google_sync') {
        return false;
      }
      if (modelFilter === 'seed' && item.source !== 'seed') {
        return false;
      }
      if (!keyword) {
        return true;
      }

      const haystack = `${item.modelId} ${item.name} ${item.label} ${item.description}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [models, modelFilter, modelSearch]);

  return (
    <div className={styles.detailContainer}>
      <div className={styles.detailHeader}>
        <Button variant="secondary" iconOnly onClick={onBack} title="Quay lại">
          <ArrowLeft size={20} />
        </Button>
        <div className={styles.detailTitle}>Dịch thuật</div>
      </div>
      
      <div className={styles.detailContent}>
        {loading ? (
          <div className={styles.section}>
            <div className={styles.row}>Đang tải dữ liệu model...</div>
          </div>
        ) : null}

        {message ? <div className={styles.settingsMessage}>{message}</div> : null}
        {error ? <div className={styles.settingsError}>{error}</div> : null}

        <div className={styles.section}>
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>AI Model</span>
              <span className={styles.labelDesc}>Model mặc định cho các tiến trình mới</span>
            </div>
            <select
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              className={styles.select}
            >
              {models.filter((item) => item.enabled).map((item) => (
                <option key={item.modelId} value={item.modelId}>{item.label}</option>
              ))}
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Batch Size</span>
              <span className={styles.labelDesc}>Số dòng caption xử lý trong một lần gọi API</span>
            </div>
            <Input
              type="number"
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              min={10}
              max={200}
              variant="small"
            />
          </div>

          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Retry Count</span>
              <span className={styles.labelDesc}>Số lần thử lại khi gặp lỗi API</span>
            </div>
            <Input
              type="number"
              value={retryCount}
              onChange={(e) => setRetryCount(Number(e.target.value))}
              min={0}
              max={10}
              variant="small"
            />
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.modelPanelHeader}>
            <div className={styles.modelPanelIntro}>
              <div className={styles.label}>
                <span className={styles.labelText}>Danh sách model Gemini</span>
                <span className={styles.labelDesc}>Quản lý tập trung model: tìm kiếm, lọc, chỉnh sửa, bật/tắt và đồng bộ từ Google</span>
              </div>
              <div className={styles.modelStatsRow}>
                <span className={styles.modelStatChip}>Tổng: {modelStats.total}</span>
                <span className={styles.modelStatChip}>Đang bật: {modelStats.enabled}</span>
                <span className={styles.modelStatChip}>Đang tắt: {modelStats.disabled}</span>
                <span className={styles.modelStatChip}>Manual: {modelStats.manual}</span>
                <span className={styles.modelStatChip}>Google: {modelStats.google}</span>
              </div>
            </div>
            <Button onClick={handleSyncModels} variant="secondary" disabled={syncing || saving}>
              <RefreshCw size={16} />
              {syncing ? 'Đang Sync...' : 'Sync Google'}
            </Button>
          </div>

          <div className={styles.modelToolbar}>
            <Input
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              placeholder="Tìm theo model id, tên, label hoặc mô tả"
              variant="small"
            />
            <div className={styles.modelFilterGroup}>
              {MODEL_FILTER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`${styles.modelFilterButton} ${modelFilter === option.value ? styles.modelFilterButtonActive : ''}`}
                  onClick={() => setModelFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.modelCreateBlock}>
            <div className={styles.modelCreateTitle}>Thêm model thủ công</div>
            <div className={styles.modelCreateRow}>
              <Input
                value={newModelId}
                onChange={(e) => setNewModelId(e.target.value)}
                placeholder="model id (vd: gemini-3.1-flash-preview)"
                variant="small"
              />
              <Input
                value={newModelName}
                onChange={(e) => setNewModelName(e.target.value)}
                placeholder="Tên model"
                variant="small"
              />
              <Input
                value={newModelLabel}
                onChange={(e) => setNewModelLabel(e.target.value)}
                placeholder="Label hiển thị"
                variant="small"
              />
              <Input
                value={newModelDescription}
                onChange={(e) => setNewModelDescription(e.target.value)}
                placeholder="Mô tả"
                variant="small"
              />
              <Button onClick={handleAddModel} variant="primary" disabled={saving || syncing}>
                <Plus size={16} />
                Thêm
              </Button>
            </div>
          </div>

          <div className={styles.modelList}>
            {filteredModels.length === 0 ? (
              <div className={styles.modelEmptyState}>
                Không tìm thấy model phù hợp với bộ lọc hiện tại.
              </div>
            ) : null}

            {filteredModels.map((item) => (
              <div key={item.modelId} className={styles.modelCard}>
                <div className={styles.modelCardHeader}>
                  <div className={styles.modelIdentity}>
                    <div className={styles.modelIdText}>{item.modelId}</div>
                    <div className={styles.modelNameText}>{item.name}</div>
                  </div>
                  <div className={styles.modelBadges}>
                    {defaultModel === item.modelId ? (
                      <span className={`${styles.modelBadge} ${styles.modelBadgeDefault}`}>Mặc định</span>
                    ) : null}
                    <span className={`${styles.modelBadge} ${item.enabled ? styles.modelBadgeEnabled : styles.modelBadgeDisabled}`}>
                      {item.enabled ? 'Đang bật' : 'Đang tắt'}
                    </span>
                    <span className={styles.modelSource}>{MODEL_SOURCE_LABELS[item.source]}</span>
                  </div>
                </div>

                <div className={styles.modelGrid}>
                  <Input
                    value={item.modelId}
                    disabled
                    variant="small"
                  />
                  <Input
                    value={item.name}
                    onChange={(e) => updateModelField(item.modelId, { name: e.target.value })}
                    variant="small"
                  />
                  <Input
                    value={item.label}
                    onChange={(e) => updateModelField(item.modelId, { label: e.target.value })}
                    variant="small"
                  />
                  <Input
                    value={item.description}
                    onChange={(e) => updateModelField(item.modelId, { description: e.target.value })}
                    variant="small"
                  />
                  <Input
                    type="number"
                    value={item.sortOrder}
                    onChange={(e) => updateModelField(item.modelId, { sortOrder: clamp(Number(e.target.value), 0, 9999) })}
                    min={0}
                    max={9999}
                    variant="small"
                  />
                </div>

                <div className={styles.modelActions}>
                  <label className={styles.modelToggle}>
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      onChange={(e) => handleToggleEnabled(item.modelId, e.target.checked)}
                    />
                    <span>{item.enabled ? 'Kích hoạt' : 'Đã tắt'}</span>
                  </label>
                  <div className={styles.modelActionButtons}>
                    <Button onClick={() => handleUpdateModel(item.modelId)} variant="secondary" disabled={saving || syncing}>
                      Lưu model
                    </Button>
                    <Button onClick={() => handleDeleteModel(item.modelId)} variant="secondary" disabled={saving || syncing}>
                      <Trash2 size={16} />
                      Xóa
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.saveBar}>
          <Button onClick={handleReset} variant="secondary">
            <RotateCcw size={16} />
            Đặt lại mặc định
          </Button>
          <Button onClick={handleSave} variant="primary" disabled={saving || syncing || loading}>
            <Save size={16} />
            {saving ? 'Đang lưu...' : 'Lưu cài đặt'}
          </Button>
        </div>
      </div>
    </div>
  );
}
