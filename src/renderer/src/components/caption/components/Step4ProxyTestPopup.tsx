import { useEffect } from 'react';
import type { TTSTestProxyResponse } from '@shared/types/caption';
import styles from './Step4ProxyTestPopup.module.css';

type Step4ProxyTestPopupProps = {
  visible: boolean;
  busy: boolean;
  text: string;
  outputDir: string;
  error?: string;
  result: TTSTestProxyResponse | null;
  onClose: () => void;
  onTextChange: (value: string) => void;
  onRun: () => void;
};

function shortenMiddle(value: string, maxLength = 72): string {
  const safe = String(value || '');
  if (safe.length <= maxLength) return safe;
  const head = Math.max(8, Math.floor((maxLength - 3) / 2));
  const tail = Math.max(8, maxLength - 3 - head);
  return `${safe.slice(0, head)}...${safe.slice(-tail)}`;
}

export function Step4ProxyTestPopup(props: Step4ProxyTestPopupProps) {
  useEffect(() => {
    if (!props.visible) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !props.busy) {
        event.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [props.busy, props.onClose, props.visible]);

  if (!props.visible) {
    return null;
  }

  const tested = props.result?.tested || 0;
  const passed = props.result?.passed || 0;
  const failed = props.result?.failed || 0;

  return (
    <div className={styles.overlay} onClick={() => !props.busy && props.onClose()}>
      <div className={styles.card} onClick={(event) => event.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>Step4 Proxy TTS Test</div>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={props.onClose}
            disabled={props.busy}
          >
            Dong
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.group}>
            <label className={styles.label}>Noi dung test cho moi proxy</label>
            <textarea
              className={styles.textarea}
              rows={2}
              value={props.text}
              onChange={(event) => props.onTextChange(event.target.value)}
              disabled={props.busy}
              placeholder="Kiem thu am thanh"
            />
          </div>

          <div className={styles.group}>
            <div className={styles.label}>Thu muc output goc</div>
            <div className={styles.value} title={props.outputDir || ''}>
              {props.outputDir || '(chua co output dir)'}
            </div>
          </div>

          {props.result && (
            <div className={styles.summary}>
              <span>Tested: {tested}</span>
              <span className={styles.ok}>Passed: {passed}</span>
              <span className={failed > 0 ? styles.fail : ''}>Failed: {failed}</span>
              <span title={props.result.runDir}>Run dir: {shortenMiddle(props.result.runDir, 56)}</span>
            </div>
          )}

          {props.error && <div className={styles.error}>{props.error}</div>}

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Proxy</th>
                  <th>Status</th>
                  <th>Elapsed</th>
                  <th>Audio</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {!props.result && (
                  <tr>
                    <td colSpan={6} className={styles.muted}>Chua co ket qua. Bam "Test tat ca proxy" de bat dau.</td>
                  </tr>
                )}
                {props.result?.results.map((row, index) => (
                  <tr key={`${row.proxyId}_${index}`}>
                    <td>{index + 1}</td>
                    <td title={`${row.proxyLabel} (${row.proxyType})`}>
                      {row.proxyLabel} ({row.proxyType})
                    </td>
                    <td className={row.success ? styles.ok : styles.fail}>{row.success ? 'OK' : 'Fail'}</td>
                    <td>{typeof row.elapsedMs === 'number' ? `${(row.elapsedMs / 1000).toFixed(2)}s` : '--'}</td>
                    <td title={row.audioPath || ''}>{row.audioPath ? shortenMiddle(row.audioPath) : '--'}</td>
                    <td title={row.error || ''}>{row.error ? shortenMiddle(row.error, 80) : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={props.onRun}
            disabled={props.busy || !props.outputDir.trim()}
          >
            {props.busy ? 'Dang test...' : 'Test tat ca proxy'}
          </button>
        </div>
      </div>
    </div>
  );
}
