/**
 * SessionContextManager
 * 
 * Centralized management of Gemini Web API session context (conversation memory).
 * Consolidates session tracking previously scattered across UI and service layers.
 */

export interface SessionContext {
  conversationId: string;
  responseId: string;
  choiceId: string;
}

export class SessionContextManager {
  private currentContext: SessionContext | null = null;

  /**
   * Get the current active session context
   */
  getCurrentContext(): SessionContext | null {
    return this.currentContext ? { ...this.currentContext } : null;
  }

  /**
   * Update session context with new values
   */
  updateContext(newContext: Partial<SessionContext>): void {
    if (!this.currentContext) {
      this.currentContext = {
        conversationId: '',
        responseId: '',
        choiceId: ''
      };
    }

    this.currentContext = {
      ...this.currentContext,
      ...newContext
    };

    console.log('[SessionContextManager] Context updated:', this.currentContext);
  }

  /**
   * Set complete context (replaces current)
   */
  setContext(context: SessionContext | null): void {
    this.currentContext = context ? { ...context } : null;
    console.log('[SessionContextManager] Context set:', this.currentContext);
  }

  /**
   * Reset/clear the session context (start new conversation)
   */
  resetSession(): void {
    this.currentContext = null;
    console.log('[SessionContextManager] Session reset');
  }

  /**
   * Parse session context from Gemini API response (Fetch mode)
   * Extracts conversationId, responseId, choiceId from response array structure
   */
  parseFromFetchResponse(responseText: string): SessionContext {
    const newContext: SessionContext = {
      conversationId: '',
      responseId: '',
      choiceId: ''
    };

    try {
      const lines = responseText.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith(")]}'")) continue;
        if (/^\d+$/.test(trimmed)) continue;

        try {
          const parsed = JSON.parse(trimmed);
          if (!Array.isArray(parsed) || parsed.length === 0) continue;

          for (const payloadItem of parsed) {
            if (!Array.isArray(payloadItem) || payloadItem.length < 3) continue;
            if (payloadItem[0] !== 'wrb.fr') continue;
            if (typeof payloadItem[2] !== 'string') continue;

            const innerData = JSON.parse(payloadItem[2]);
            if (!Array.isArray(innerData)) continue;

            // innerData[1] = [conversationId, responseId]
            if (Array.isArray(innerData[1])) {
              if (innerData[1][0] && !newContext.conversationId) {
                newContext.conversationId = String(innerData[1][0]);
              }
              if (innerData[1][1] && !newContext.responseId) {
                newContext.responseId = String(innerData[1][1]);
              }
            }

            // innerData[4][0][0] = choiceId
            if (Array.isArray(innerData[4]) && innerData[4].length > 0) {
              const candidate = innerData[4][0];
              if (Array.isArray(candidate) && candidate[0] && !newContext.choiceId) {
                newContext.choiceId = String(candidate[0]);
              }
            }
          }
        } catch {
          // Skip invalid JSON lines
          continue;
        }
      }

      const contextSummary = {
        conversationId: newContext.conversationId ? `${String(newContext.conversationId).slice(0, 24)}...` : '',
        responseIdLength: newContext.responseId ? String(newContext.responseId).length : 0,
        choiceId: newContext.choiceId ? `${String(newContext.choiceId).slice(0, 24)}...` : ''
      };
      console.log('[SessionContextManager] Đã parse ngữ cảnh (tóm tắt):', contextSummary);
    } catch (error) {
      console.error('[SessionContextManager] Failed to parse fetch response:', error);
    }

    return newContext;
  }

  /**
   * Parse session context from Gemini API streaming response
   * Extracts conversationId, responseId, choiceId from stream chunks
   */
  parseFromStreamResponse(responseText: string): SessionContext {
    const newContext: SessionContext = {
      conversationId: '',
      responseId: '',
      choiceId: ''
    };

    try {
      const lines = responseText.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        // Remove ")]}'" prefix if exists
        const cleanedLine = line.replace(/^\)\]\}'\n?/, '').trim();
        if (!cleanedLine || cleanedLine.length < 2) continue;

        try {
          const parsed = JSON.parse(cleanedLine);
          if (!Array.isArray(parsed) || parsed.length === 0) continue;

          for (const payloadItem of parsed) {
            if (!Array.isArray(payloadItem) || payloadItem.length < 3) continue;
            if (payloadItem[0] !== 'wrb.fr') continue;
            if (typeof payloadItem[2] !== 'string') continue;

            const innerData = JSON.parse(payloadItem[2]);
            if (!Array.isArray(innerData)) continue;

            if (Array.isArray(innerData[1])) {
              if (innerData[1][0] && !newContext.conversationId) {
                newContext.conversationId = String(innerData[1][0]);
              }
              if (innerData[1][1] && !newContext.responseId) {
                newContext.responseId = String(innerData[1][1]);
              }
            }

            if (Array.isArray(innerData[4]) && innerData[4].length > 0) {
              const candidate = innerData[4][0];
              if (Array.isArray(candidate) && candidate[0] && !newContext.choiceId) {
                newContext.choiceId = String(candidate[0]);
              }
            }
          }
        } catch (parseError) {
          // Skip invalid JSON lines
          continue;
        }
      }

      console.log('[SessionContextManager] Parsed context from stream response:', newContext);
    } catch (error) {
      console.error('[SessionContextManager] Failed to parse stream response:', error);
    }

    return newContext;
  }

  /**
   * Check if we have a valid active session
   */
  hasActiveSession(): boolean {
    return this.currentContext !== null && 
           this.currentContext.conversationId !== '';
  }

  /**
   * Format context for request payload
   */
  formatForRequest(): [string, string, string] {
    if (!this.currentContext) {
      return ['', '', ''];
    }

    return [
      this.currentContext.conversationId,
      this.currentContext.responseId,
      this.currentContext.choiceId
    ];
  }
}

// Singleton instance
let instance: SessionContextManager | null = null;

export function getSessionContextManager(): SessionContextManager {
  if (!instance) {
    instance = new SessionContextManager();
  }
  return instance;
}
