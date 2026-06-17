import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ExternalLink, CheckCircle2, XCircle, Loader2, Cpu, Settings2, Save } from 'lucide-react';
import { Button } from '../common/Button';
import sharedStyles from './Settings.module.css';
import styles from './CliAgentScanPanel.module.css';

interface DetectedCliAgent {
  id: string;
  name: string;
  bin: string;
  fallbackBins?: string[];
  versionArgs: string[];
  homepage?: string;
  available: boolean;
  path: string | null;
  version: string | null;
  error?: string;
}

interface CliAgentConfigEntry {
  customBinPath: string | null;
  env: Record<string, string>;
  enabled: boolean;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function CliAgentScanPanel() {
  const [agents, setAgents] = useState<DetectedCliAgent[]>([]);
  const [config, setConfig] = useState<Record<string, CliAgentConfigEntry>>({});
  const [scanning, setScanning] = useState(true);
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<{ id: string; ok: boolean } | null>(null);
  const isMounted = useRef(true);

  const handleScan = useCallback(async () => {
    setScanning(true);
    try {
      const [result, cfg] = await Promise.all([
        window.electronAPI.cliAgentScan.scan(),
        window.electronAPI.cliAgentScan.getConfig(),
      ]);
      if (!isMounted.current) return;
      setAgents(result);
      setConfig(cfg);
      setLastScanAt(Date.now());
    } catch (err) {
      console.error('[CLI Agent Scan] Failed:', err);
    } finally {
      if (isMounted.current) setScanning(false);
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    void handleScan();
    return () => { isMounted.current = false; };
  }, [handleScan]);

  const handleToggle = useCallback((agentId: string, enabled: boolean) => {
    setConfig((prev) => ({
      ...prev,
      [agentId]: { ...prev[agentId], customBinPath: prev[agentId]?.customBinPath ?? null, env: prev[agentId]?.env ?? {}, enabled },
    }));
  }, []);

  const handleCustomPath = useCallback((agentId: string, value: string) => {
    setConfig((prev) => ({
      ...prev,
      [agentId]: {
        ...prev[agentId],
        customBinPath: value || null,
        env: prev[agentId]?.env ?? {},
        enabled: prev[agentId]?.enabled ?? true,
      },
    }));
  }, []);

  const handleSaveConfig = useCallback(async (agentId: string) => {
    setSavingId(agentId);
    setSaveMsg(null);
    try {
      const entry = config[agentId];
      if (!entry) return;
      await window.electronAPI.cliAgentScan.updateConfig(agentId, entry);
      setSaveMsg({ id: agentId, ok: true });
    } catch {
      setSaveMsg({ id: agentId, ok: false });
    } finally {
      setSavingId(null);
      setTimeout(() => setSaveMsg(null), 2000);
    }
  }, [config]);

  const availableCount = agents.filter((a) => a.available).length;

  const getAgentConfig = (id: string): CliAgentConfigEntry =>
    config[id] ?? { customBinPath: null, env: {}, enabled: true };

  return (
    <div className={sharedStyles.detailContainer}>
      <div className={sharedStyles.detailHeader}>
        <div className={sharedStyles.detailTitle}>CLI Agents</div>
      </div>

      <div className={sharedStyles.detailContent}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarInfo}>
            <Cpu size={18} />
            <span>Quét các CLI coding agent có trên PATH</span>
          </div>
          <div className={styles.toolbarActions}>
            {lastScanAt && (
              <span className={styles.lastScanText}>
                Lần cuối: {formatTime(lastScanAt)}
              </span>
            )}
            <span className={styles.count}>
              {scanning ? '?' : availableCount} / {agents.length} có sẵn
            </span>
            <Button variant="secondary" onClick={handleScan} disabled={scanning}>
              {scanning ? <Loader2 size={16} className={styles.spin} /> : <RefreshCw size={16} />}
              {scanning ? 'Đang quét...' : 'Quét lại'}
            </Button>
          </div>
        </div>

        <div className={sharedStyles.section}>
          {scanning && agents.length === 0 ? (
            <div className={styles.loadingState}>
              <Loader2 size={32} className={styles.spin} />
              <span>Đang quét CLI agents...</span>
            </div>
          ) : (
            <div className={styles.list}>
              {agents.map((agent) => {
                const cfg = getAgentConfig(agent.id);
                const isExpanded = expandedId === agent.id;
                const isSaving = savingId === agent.id;
                const showSaveMsg = saveMsg && saveMsg.id === agent.id;
                return (
                  <div key={agent.id} className={styles.card}>
                    <div className={styles.cardIcon}>
                      <Cpu size={20} />
                    </div>
                    <div className={styles.cardBody}>
                      <div className={styles.cardTop}>
                        <div className={styles.cardNameRow}>
                          <span className={styles.cardName}>{agent.name}</span>
                          {agent.available && (
                            <span className={styles.versionBadge}>{agent.version || '?'}</span>
                          )}
                        </div>
                        <div className={styles.cardStatus}>
                          <label className={styles.toggle}>
                            <input
                              type="checkbox"
                              checked={cfg.enabled}
                              onChange={(e) => handleToggle(agent.id, e.target.checked)}
                            />
                            <span className={`${styles.toggleTrack} ${cfg.enabled ? styles.toggleTrackActive : ''}`}>
                              <span className={`${styles.toggleKnob} ${cfg.enabled ? styles.toggleKnobActive : ''}`} />
                            </span>
                          </label>
                          <button
                            className={styles.expandBtn}
                            onClick={() => setExpandedId(isExpanded ? null : agent.id)}
                            title="Cấu hình"
                          >
                            <Settings2 size={14} />
                          </button>
                        </div>
                      </div>

                      <div className={styles.cardBottom}>
                        <span className={styles.binBadge}>{agent.bin}</span>
                        {agent.available ? (
                          <span className={styles.statusAvailable}>
                            <CheckCircle2 size={14} />
                            Available
                          </span>
                        ) : (
                          <span className={styles.statusMissing}>
                            <XCircle size={14} />
                            {agent.error === 'Disabled in config' ? 'Disabled' : 'Not found'}
                          </span>
                        )}
                        {!agent.available && agent.error !== 'Disabled in config' && agent.homepage && (
                          <a
                            href={agent.homepage}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.installLink}
                          >
                            <ExternalLink size={12} />
                            Install
                          </a>
                        )}
                      </div>

                      {agent.path && (
                        <div className={styles.pathText} title={agent.path}>
                          {agent.path}
                        </div>
                      )}

                      {agent.error && agent.error !== 'Disabled in config' && (
                        <div className={styles.errorText}>{agent.error}</div>
                      )}

                      {isExpanded && (
                        <div className={styles.configSection}>
                          <div className={styles.configRow}>
                            <label className={styles.configLabel}>Custom bin path</label>
                            <input
                              className={styles.configInput}
                              type="text"
                              placeholder={agent.bin}
                              value={cfg.customBinPath || ''}
                              onChange={(e) => handleCustomPath(agent.id, e.target.value)}
                            />
                          </div>
                          <div className={styles.configActions}>
                            <Button
                              variant="primary"
                              onClick={() => handleSaveConfig(agent.id)}
                              disabled={isSaving}
                            >
                              {isSaving ? <Loader2 size={14} className={styles.spin} /> : <Save size={14} />}
                              Lưu
                            </Button>
                            {showSaveMsg && (
                              <span className={saveMsg.ok ? styles.saveOk : styles.saveFail}>
                                {saveMsg.ok ? 'Đã lưu' : 'Lỗi'}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
