/**
 * GeminiChatSettings - Cau hinh ket noi Gemini qua giao dien web
 * Bao gom chuc nang Auto-parse tu raw input
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Cookie,
  Globe,
  Hash,
  Shield,
  MessageSquare,
  Info,
  Clipboard,
  Sparkles,
  Save,
  RotateCcw,
  ArrowLeft
} from 'lucide-react';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import styles from './Settings.module.css';

interface GeminiChatSettingsProps {
  onBack: () => void;
}

export function GeminiChatSettings({ onBack }: GeminiChatSettingsProps) {
  // State cho raw input (de dan va auto-parse)
  const [rawInput, setRawInput] = useState<string>('');
  
  // State cho cac truong da parse
  const [cookie, setCookie] = useState<string>('');
  const [blLabel, setBlLabel] = useState<string>('');
  const [fSid, setFSid] = useState<string>('');
  const [atToken, setAtToken] = useState<string>('');
  const [convId, setConvId] = useState<string>('');
  const [respId, setRespId] = useState<string>('');
  const [candId, setCandId] = useState<string>('');
  
  // State UI
  const [parseStatus, setParseStatus] = useState<string>('');
  const [saveStatus, setSaveStatus] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [currentConfigId, setCurrentConfigId] = useState<string | null>(null);

  // Load cau hinh hien tai khi mount
  useEffect(() => {
    const loadActiveConfig = async () => {
      try {
        setIsLoading(true);
        const result = await window.electronAPI.geminiChat.getActive();
        if (result.success && result.data) {
          const config = result.data;
          setCurrentConfigId(config.id);
          setCookie(config.cookie || '');
          setBlLabel(config.blLabel || '');
          setFSid(config.fSid || '');
          setAtToken(config.atToken || '');
          setConvId(config.convId || '');
          setRespId(config.respId || '');
          setCandId(config.candId || '');
          console.log('[GeminiChatSettings] Da tai cau hinh:', config.id);
        } else {
          console.log('[GeminiChatSettings] Khong co cau hinh nao');
        }
      } catch (error) {
        console.error('[GeminiChatSettings] Loi khi tai cau hinh:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadActiveConfig();
  }, []);

  // Ham tu dong parse du lieu tu raw input
  const handleAutoParse = useCallback(() => {
    if (!rawInput.trim()) {
      setParseStatus('Vui long dan du lieu vao o tren truoc');
      return;
    }

    let foundCount = 0;
    const text = rawInput;

    // Parse Cookie - ho tro nhieu dinh dang
    // 1. curl -b "cookie_string"
    const curlCookieMatch = text.match(/-b\s+\^?"([^"]+)\^?"/);
    if (curlCookieMatch && curlCookieMatch[1]) {
      setCookie(curlCookieMatch[1].trim());
      foundCount++;
    } else {
      // 2. Cookie: header format
      const cookieHeaderMatch = text.match(/Cookie:\s*(.+?)(?:\r?\n|$)/i);
      if (cookieHeaderMatch && cookieHeaderMatch[1]) {
        setCookie(cookieHeaderMatch[1].trim());
        foundCount++;
      } else {
        // 3. Tim chuoi chua __Secure-1PSID
        const securePsidMatch = text.match(/(__Secure-1PSID=[^;\s]+(?:;[^"]+)?)/);
        if (securePsidMatch && securePsidMatch[1]) {
          setCookie(securePsidMatch[1].trim());
          foundCount++;
        }
      }
    }

    // Parse BL_LABEL - tim bl=... trong URL (ho tro escape char ^)
    const blPatterns = [
      /[?&]bl=([^&\s^"]+)/,
      /bl=([^&\s^"]+)/,
    ];
    for (const pattern of blPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        setBlLabel(decodeURIComponent(match[1].replace(/\^/g, '')));
        foundCount++;
        break;
      }
    }

    // Parse F_SID - tim f.sid=... trong URL (ho tro escape char ^)
    const fsidPatterns = [
      /[?&]f\.sid=([^&\s^"]+)/,
      /f\.sid=([^&\s^"]+)/,
    ];
    for (const pattern of fsidPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        setFSid(match[1].replace(/\^/g, ''));
        foundCount++;
        break;
      }
    }

    // Parse AT_TOKEN - tim at=... trong body (ho tro URL encoded)
    const atPatterns = [
      // URL encoded format: at=...%3A... (co the co escape ^)
      /[&?]at=([^&\s^"]+)/,
      /at=([^&\s^"]+)/,
      /"at":\s*"([^"]+)"/,
    ];
    for (const pattern of atPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        try {
          // Decode URL encoded value va loai bo escape chars
          let atValue = match[1].replace(/\^/g, '');
          atValue = decodeURIComponent(atValue);
          setAtToken(atValue);
          foundCount++;
        } catch {
          setAtToken(match[1].replace(/\^/g, ''));
          foundCount++;
        }
        break;
      }
    }

    // Parse Conversation IDs tu f.req JSON (ho tro URL encoded)
    // Tim c_ pattern (URL encoded: c_... hoac %22c_...%22)
    const convPatterns = [
      /%22(c_[a-zA-Z0-9]+)%22/,
      /["']?(c_[a-zA-Z0-9]+)["']?/,
    ];
    for (const pattern of convPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        setConvId(match[1]);
        foundCount++;
        break;
      }
    }

    // Tim r_ pattern
    const respPatterns = [
      /%22(r_[a-zA-Z0-9]+)%22/,
      /["']?(r_[a-zA-Z0-9]+)["']?/,
    ];
    for (const pattern of respPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        setRespId(match[1]);
        foundCount++;
        break;
      }
    }

    // Tim rc_ pattern
    const candPatterns = [
      /%22(rc_[a-zA-Z0-9]+)%22/,
      /["']?(rc_[a-zA-Z0-9]+)["']?/,
    ];
    for (const pattern of candPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        setCandId(match[1]);
        foundCount++;
        break;
      }
    }

    if (foundCount > 0) {
      setParseStatus(`Da tim thay ${foundCount} truong. Vui long kiem tra va chinh sua neu can.`);
    } else {
      setParseStatus('Khong tim thay du lieu hop le. Vui long kiem tra lai noi dung da dan.');
    }
  }, [rawInput]);

  // Ham luu vao database
  const handleSave = useCallback(async () => {
    if (!cookie.trim()) {
      setSaveStatus('Vui long nhap Cookie');
      return;
    }

    try {
      setIsLoading(true);
      setSaveStatus('Dang luu...');

      const configData = {
        name: 'default',
        cookie,
        blLabel,
        fSid,
        atToken,
        convId,
        respId,
        candId,
      };

      let result;
      if (currentConfigId) {
        // Cap nhat cau hinh hien tai
        result = await window.electronAPI.geminiChat.update(currentConfigId, configData);
      } else {
        // Tao cau hinh moi
        result = await window.electronAPI.geminiChat.create(configData);
        if (result.success && result.data) {
          setCurrentConfigId(result.data.id);
        }
      }

      if (result.success) {
        setSaveStatus('Da luu cau hinh thanh cong!');
        console.log('[GeminiChatSettings] Da luu cau hinh:', result.data);
        
        // Clear status sau 3 giay
        setTimeout(() => setSaveStatus(''), 3000);
      } else {
        setSaveStatus(`Loi: ${result.error || 'Khong the luu cau hinh'}`);
      }
    } catch (error) {
      console.error('[GeminiChatSettings] Loi khi luu:', error);
      setSaveStatus(`Loi: ${String(error)}`);
    } finally {
      setIsLoading(false);
    }
  }, [cookie, blLabel, fSid, atToken, convId, respId, candId, currentConfigId]);

  // Ham reset
  const handleReset = useCallback(() => {
    setRawInput('');
    setCookie('');
    setBlLabel('');
    setFSid('');
    setAtToken('');
    setConvId('');
    setRespId('');
    setCandId('');
    setParseStatus('');
    setSaveStatus('');
    setCurrentConfigId(null);
  }, []);

  return (
    <div className={styles.detailContainer}>
      <div className={styles.detailHeader}>
        <Button 
          variant="secondary"
          iconOnly
          onClick={onBack}
          title="Quay lại"
        >
          <ArrowLeft size={20} />
        </Button>
        <div className={styles.detailTitle}>Gemini Chat (Web)</div>
      </div>
      
      <div className={styles.detailContent}>
        <div className={styles.section}>
          {/* Auto-parse section */}
          <div className={styles.row} style={{ display: 'block' }}>
            <div className={styles.label} style={{ marginBottom: 8 }}>
              <span className={styles.labelText} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Clipboard size={18} />
                Dán dữ liệu để tự động phân tích
              </span>
              <span className={styles.labelDesc}>
                Dán nội dung từ DevTools (Headers, URL, Body) vào đây. Hệ thống sẽ tự động tách các thông số.
              </span>
            </div>
            <textarea
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder="Dán nội dung từ DevTools vào đây...&#10;Ví dụ: Copy toàn bộ Headers, URL hoặc Payload từ request StreamGenerate"
              rows={5}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border-color)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                fontFamily: 'monospace',
                fontSize: '0.85em',
                resize: 'vertical',
              }}
            />
            <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
              <Button onClick={handleAutoParse} variant="primary">
                <Sparkles size={16} />
                Tự động phân tích
              </Button>
              {parseStatus && (
                <span style={{ 
                  fontSize: '0.9em', 
                  color: parseStatus.includes('tìm thấy') ? 'var(--color-success)' : 'var(--color-warning)' 
                }}>
                  {parseStatus}
                </span>
              )}
            </div>
          </div>

          <div className={styles.divider} style={{ margin: '24px 0', borderTop: '2px dashed var(--border-color)' }} />

          {/* Cookie */}
          <div className={styles.row} style={{ display: 'block' }}>
            <div className={styles.label} style={{ marginBottom: 8 }}>
              <span className={styles.labelText} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Cookie size={18} />
                Nhóm Định danh (Cookie)
              </span>
              <span className={styles.labelDesc}>
                Cookie xác thực từ trình duyệt. Chứa __Secure-1PSID, __Secure-3PSID và các mã bảo mật khác.
              </span>
            </div>
            <textarea
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              placeholder="__Secure-1PSID=...; __Secure-3PSID=..."
              rows={3}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border-color)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                fontFamily: 'monospace',
                fontSize: '0.85em',
                resize: 'vertical',
              }}
            />
          </div>

          <div className={styles.divider} style={{ margin: '20px 0', borderTop: '1px solid var(--border-color)' }} />

          {/* BL_LABEL */}
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Globe size={18} />
                BL_LABEL (Build Label)
              </span>
              <span className={styles.labelDesc}>
                Số hiệu phiên bản server Gemini. Lấy từ URL tham số bl=
              </span>
            </div>
            <Input
              value={blLabel}
              onChange={(e) => setBlLabel(e.target.value)}
              placeholder="boq_assistant-bard-web-server_20260114.02_p1"
            />
          </div>

          {/* F_SID */}
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Hash size={18} />
                F_SID (Session ID)
              </span>
              <span className={styles.labelDesc}>
                ID phiên làm việc. Lấy từ URL tham số f.sid=
              </span>
            </div>
            <Input
              value={fSid}
              onChange={(e) => setFSid(e.target.value)}
              placeholder="3363005882250450321"
            />
          </div>

          <div className={styles.divider} style={{ margin: '20px 0', borderTop: '1px solid var(--border-color)' }} />

          {/* AT_TOKEN */}
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Shield size={18} />
                AT_TOKEN (Action Token/SNlM0e)
              </span>
              <span className={styles.labelDesc}>
                Mã xác thực hành động. Thay đổi theo phiên làm việc. Lấy từ Body request hoặc cuối URL.
              </span>
            </div>
            <Input
              value={atToken}
              onChange={(e) => setAtToken(e.target.value)}
              placeholder="APwZiaoy65HsGUeSUvXYtP3x7tjV:1768919013678"
            />
          </div>

          <div className={styles.divider} style={{ margin: '20px 0', borderTop: '1px solid var(--border-color)' }} />

          {/* Conversation context */}
          <div className={styles.row} style={{ display: 'block' }}>
            <div className={styles.label} style={{ marginBottom: 12 }}>
              <span className={styles.labelText} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <MessageSquare size={18} />
                Ngữ cảnh cuộc trò chuyện
              </span>
              <span className={styles.labelDesc}>
                Các ID này nằm trong tham số f.req để Gemini nhớ lịch sử chat. Giữ nguyên trong suốt một cuộc chat.
              </span>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingLeft: 12, borderLeft: '3px solid var(--color-primary-500)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ minWidth: 100, fontWeight: 500, color: 'var(--text-secondary)' }}>c_ (Conv ID)</span>
                <Input
                  value={convId}
                  onChange={(e) => setConvId(e.target.value)}
                  placeholder="c_a859b4357153da9f"
                  style={{ flex: 1 }}
                />
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ minWidth: 100, fontWeight: 500, color: 'var(--text-secondary)' }}>r_ (Resp ID)</span>
                <Input
                  value={respId}
                  onChange={(e) => setRespId(e.target.value)}
                  placeholder="r_ef70dfe2509b430b"
                  style={{ flex: 1 }}
                />
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ minWidth: 100, fontWeight: 500, color: 'var(--text-secondary)' }}>rc_ (Cand ID)</span>
                <Input
                  value={candId}
                  onChange={(e) => setCandId(e.target.value)}
                  placeholder="rc_824a3f26d3d9d70a"
                  style={{ flex: 1 }}
                />
              </div>
            </div>
          </div>

          {/* Info Box */}
          <div style={{
            marginTop: 20,
            padding: 16,
            borderRadius: 8,
            background: 'var(--color-primary-500)10',
            border: '1px solid var(--color-primary-500)40',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, marginBottom: 8, color: 'var(--color-primary-500)' }}>
              <Info size={18} />
              Hướng dẫn lấy thông tin
            </div>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: '0.9em', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <li><strong>Cookie</strong>: DevTools → Network → Chọn request → Tab Headers → Cookie</li>
              <li><strong>BL_LABEL, F_SID</strong>: Xem trong URL của request StreamGenerate (tham số bl=, f.sid=)</li>
              <li><strong>AT_TOKEN</strong>: Trong Payload/Body của request (tham số at=)</li>
              <li><strong>c_, r_, rc_</strong>: Trong nội dung f.req của request (dạng JSON)</li>
            </ul>
          </div>
        </div>

        {/* Save bar */}
        <div className={styles.saveBar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
            {saveStatus && (
              <span style={{
                fontSize: '0.9em',
                color: saveStatus.includes('thanh cong') ? 'var(--color-success)' :
                       saveStatus.includes('Loi') ? 'var(--color-error)' : 'var(--text-secondary)'
              }}>
                {saveStatus}
              </span>
            )}
            {isLoading && (
              <span style={{ fontSize: '0.9em', color: 'var(--text-secondary)' }}>
                Dang xu ly...
              </span>
            )}
          </div>
          <Button onClick={handleReset} variant="secondary" disabled={isLoading}>
            <RotateCcw size={16} />
            Dat lai
          </Button>
          <Button onClick={handleSave} variant="primary" disabled={isLoading}>
            <Save size={16} />
            {isLoading ? 'Dang luu...' : 'Luu cau hinh'}
          </Button>
        </div>
      </div>
    </div>
  );
}
