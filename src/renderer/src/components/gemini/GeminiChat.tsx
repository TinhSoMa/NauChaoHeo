/**
 * GeminiChat - Component chat truc tiep voi Gemini Web API
 * Ho tro nhieu session chat (project)
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Send, Loader2, Trash2, Copy, Check, Plus, MessageSquare, RefreshCw } from 'lucide-react';
import { Button } from '../common/Button';
import { useProjectContext } from '../../context/ProjectContext';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ChatSession {
  id: string;
  name: string;
  isActive: boolean;
  convId?: string;
  respId?: string;
  candId?: string;
}



export function GeminiChat() {
  const { projectId, paths } = useProjectContext();
  const hasLoadedRef = useRef(false);
  const saveTimeoutRef = useRef<number | null>(null);

  // State quan ly session
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  
  // Context settings
  const [useContext, setUseContext] = useState(true);

  // State quan ly chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  // Ref de scroll xuong cuoi
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const getChatFileName = (sessionId: string) => `chat-${sessionId}.json`;

  const loadChatMessages = async (sessionId: string) => {
    if (!projectId) return;

    try {
      const res = await window.electronAPI.project.readFeatureFile({
        projectId,
        feature: 'gemini',
        fileName: getChatFileName(sessionId)
      });

      if (res?.success && res.data) {
        const saved = JSON.parse(res.data) as ChatMessage[];
        setMessages(saved);
      } else {
        setMessages([]);
      }
    } catch (err) {
      console.error('[GeminiChat] Loi tai log chat:', err);
      setMessages([]);
    } finally {
      hasLoadedRef.current = true;
    }
  };

  const saveChatMessages = async (sessionId: string, currentMessages: ChatMessage[]) => {
    if (!projectId) return;

    await window.electronAPI.project.writeFeatureFile({
      projectId,
      feature: 'gemini',
      fileName: getChatFileName(sessionId),
      content: currentMessages
    });
  };

  // Load danh sach sessions khi khoi dong
  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (!projectId || !paths || !activeSessionId) return;
    hasLoadedRef.current = false;
    loadChatMessages(activeSessionId);
  }, [projectId, paths, activeSessionId]);

  useEffect(() => {
    if (!projectId || !paths || !activeSessionId || !hasLoadedRef.current) return;

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      saveChatMessages(activeSessionId, messages);
    }, 500);

    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [projectId, paths, activeSessionId, messages]);

  // Scroll xuong cuoi khi co tin nhan moi
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Tu dong resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [inputValue]);

  // Load danh sach sessions tu database
  const loadSessions = async () => {
    setIsLoadingSessions(true);
    try {
      const result = await window.electronAPI.geminiChat.getAll();
      if (result.success && result.data) {
        const sessionList: ChatSession[] = result.data.map((config) => ({
          id: config.id,
          name: config.name || `Session ${config.id.substring(0, 8)}`,
          isActive: config.isActive,
          convId: config.convId,
          respId: config.respId,
          candId: config.candId,
        }));
        setSessions(sessionList);

        // Tu dong chon session dang active hoac session dau tien
        const active = sessionList.find(s => s.isActive) || sessionList[0];
        if (active) {
          setActiveSessionId(active.id);
        }
      }
    } catch (err) {
      console.error('[GeminiChat] Loi load sessions:', err);
      setError('Khong the tai danh sach session');
    } finally {
      setIsLoadingSessions(false);
    }
  };

  // Chon session
  const handleSelectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    // Xoa tin nhan cu khi chuyen session (vi khong luu lich su local)
    setMessages([]);
    setError(null);
  }, []);

  // Tao session moi
  const handleCreateSession = async () => {
    try {
      const name = `Chat ${new Date().toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}`;
      const result = await window.electronAPI.geminiChat.create({
        name,
        cookie: '', // Nguoi dung can cap nhat sau
      });
      if (result.success && result.data) {
        await loadSessions();
        setActiveSessionId(result.data.id);
        setMessages([]);
      }
    } catch (err) {
      console.error('[GeminiChat] Loi tao session:', err);
      setError('Khong the tao session moi');
    }
  };

  // Ham gui tin nhan
  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading || !activeSessionId) return;

    const userMessage: ChatMessage = {
      id: `msg_${Date.now()}_user`,
      role: 'user',
      content: inputValue.trim(),
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setError(null);
    setIsLoading(true);

    try {
      // Chuan bi context
      const currentSession = sessions.find(s => s.id === activeSessionId);
      
      let context;
      if (useContext && currentSession?.convId) {
          context = {
              conversationId: currentSession.convId,
              responseId: currentSession.respId || "",
              choiceId: currentSession.candId || ""
          };
      }
      // Neu useContext = false hoac khong co context cu, context = undefined -> Backend tu tao moi

      console.log('Sending with context:', context);

      // Goi Gemini Web API thong qua IPC
      const result = await window.electronAPI.geminiChat.sendMessage(userMessage.content, activeSessionId, context);
      
      if (result.success && result.data) {
        const assistantMessage: ChatMessage = {
          id: `msg_${Date.now()}_assistant`,
          role: 'assistant',
          content: result.data.text,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, assistantMessage]);

        // Cap nhat context moi vao DB va State
        if (result.data.context) {
            const newContext = result.data.context;
            console.log('Received new context:', newContext);
            
            // 1. Cap nhat DB
            window.electronAPI.geminiChat.update(activeSessionId, {
                convId: newContext.conversationId,
                respId: newContext.responseId,
                candId: newContext.choiceId
            });

            // 2. Cap nhat State Sessions
            setSessions(prev => prev.map(s => {
                if (s.id === activeSessionId) {
                    return {
                        ...s,
                        convId: newContext.conversationId,
                        respId: newContext.responseId,
                        candId: newContext.choiceId
                    };
                }
                return s;
            }));
        }

      } else {
        setError(result.error || 'Loi khi goi Gemini Web API');
      }
    } catch (err) {
      console.error('[GeminiChat] Loi:', err);
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [inputValue, isLoading, activeSessionId]);

  // Xu ly phim Enter
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

  // Xoa lich su chat (chi trong UI)
  const handleClearChat = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  // Copy noi dung tin nhan
  const handleCopy = useCallback((id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  // Tim session dang active
  const activeSession = sessions.find(s => s.id === activeSessionId);

  return (
    <div className="flex h-full bg-background">
      {/* Sidebar - Danh sach Sessions */}
      <div className="w-64 border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-text-primary">Sessions</h2>
            <div className="flex gap-1">
              <button
                onClick={loadSessions}
                className="p-1.5 rounded-lg hover:bg-surface text-text-secondary"
                title="Lam moi"
              >
                <RefreshCw size={16} />
              </button>
              <button
                onClick={handleCreateSession}
                className="p-1.5 rounded-lg hover:bg-surface text-text-secondary"
                title="Tao session moi"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
          <p className="text-xs text-text-secondary">
            Chon hoac tao session chat
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {isLoadingSessions ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-text-secondary" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-8 text-text-secondary text-sm">
              Chua co session nao.
              <br />
              Hay tao session moi!
            </div>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => handleSelectSession(session.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg mb-1 text-left transition-colors ${
                  activeSessionId === session.id
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-surface text-text-primary'
                }`}
              >
                <MessageSquare size={16} />
                <span className="truncate text-sm">{session.name}</span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Chat Gemini</h1>
            <p className="text-sm text-text-secondary mt-1">
              {activeSession ? activeSession.name : 'Chon mot session de bat dau'}
            </p>
            {activeSession?.convId && (
                <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs bg-surface-hover px-2 py-1 rounded border border-border text-text-secondary font-mono">
                        ID: {activeSession.convId}
                    </span>
                    <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer select-none">
                        <input 
                            type="checkbox" 
                            checked={useContext} 
                            onChange={(e) => setUseContext(e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary"
                        />
                        Tiep tuc chat (Giu context)
                    </label>
                </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {activeSessionId && (
              <Button variant="secondary" onClick={handleClearChat} title="Xoa lich su chat">
                <Trash2 size={18} />
                Xoa chat
              </Button>
            )}
          </div>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {!activeSessionId ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <MessageSquare size={40} className="text-primary" />
              </div>
              <h2 className="text-xl font-semibold text-text-primary mb-2">
                Chon session de bat dau
              </h2>
              <p className="text-text-secondary max-w-md">
                Chon mot session tu danh sach ben trai hoac tao moi de bat dau chat voi Gemini.
              </p>
            </div>
          ) : messages.length === 0 && !error ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <MessageSquare size={40} className="text-primary" />
              </div>
              <h2 className="text-xl font-semibold text-text-primary mb-2">
                Bat dau tro chuyen voi Gemini
              </h2>
              <p className="text-text-secondary max-w-md">
                Nhap cau hoi hoac yeu cau cua ban vao o phia duoi. Gemini se phan hoi ngay lap tuc.
              </p>
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-3 group relative ${
                      message.role === 'user'
                        ? 'bg-primary text-text-invert'
                        : 'bg-surface border border-border text-text-primary'
                    }`}
                  >
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                      {message.content}
                    </pre>
                    
                    {/* Copy button */}
                    <button
                      onClick={() => handleCopy(message.id, message.content)}
                      className={`absolute top-2 right-2 p-1.5 rounded-lg transition-opacity ${
                        message.role === 'user' 
                          ? 'bg-white/20 hover:bg-white/30 text-white'
                          : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                      } opacity-0 group-hover:opacity-100`}
                      title="Sao chep"
                    >
                      {copiedId === message.id ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-surface border border-border rounded-2xl px-4 py-3">
                <div className="flex items-center gap-2 text-text-secondary">
                  <Loader2 size={18} className="animate-spin" />
                  <span>Dang suy nghi...</span>
                </div>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700">
              <strong>Loi:</strong> {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-border p-4">
          <div className="flex items-end gap-3 max-w-4xl mx-auto">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={activeSessionId ? "Nhap tin nhan cua ban... (Enter de gui, Shift+Enter de xuong dong)" : "Chon session de bat dau chat..."}
                rows={1}
                className="w-full px-4 py-3 pr-12 rounded-xl border border-border bg-surface text-text-primary placeholder:text-text-secondary resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                disabled={isLoading || !activeSessionId}
              />
            </div>
            <Button
              variant="primary"
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || isLoading || !activeSessionId}
              className="h-12 px-6"
            >
              {isLoading ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <Send size={20} />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
