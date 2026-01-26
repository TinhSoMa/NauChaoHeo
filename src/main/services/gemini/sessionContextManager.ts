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
      // Remove ")]}'" prefix if exists
      const cleanedText = responseText.replace(/^\)\]\}'\n/, '');
      const parsed = JSON.parse(cleanedText);

      if (Array.isArray(parsed) && parsed.length > 0) {
        const innerData = parsed[0];
        if (Array.isArray(innerData) && innerData.length > 1) {
          // Index 1 contains conversation ID
          if (innerData[1]) {
            newContext.conversationId = String(innerData[1]);
          }

          // Index 4 contains candidates array
          if (Array.isArray(innerData[4]) && innerData[4].length > 0) {
            const candidate = innerData[4][0];
            if (Array.isArray(candidate) && candidate.length > 1) {
              // Index 1 contains response ID and choice ID
              if (Array.isArray(candidate[1])) {
                newContext.responseId = String(candidate[1][0] || '');
                newContext.choiceId = String(candidate[1][1] || '');
              }
            }
          }
        }
      }

      console.log('[SessionContextManager] Parsed context from fetch response:', newContext);
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
          if (Array.isArray(parsed) && parsed.length > 0) {
            const innerData = parsed[0];
            if (Array.isArray(innerData) && innerData.length > 1) {
              // Extract conversation ID
              if (innerData[1] && !newContext.conversationId) {
                newContext.conversationId = String(innerData[1]);
              }

              // Extract response ID and choice ID from candidates
              if (Array.isArray(innerData[4]) && innerData[4].length > 0) {
                const candidate = innerData[4][0];
                if (Array.isArray(candidate) && candidate.length > 1) {
                  if (Array.isArray(candidate[1])) {
                    if (candidate[1][0]) newContext.responseId = String(candidate[1][0]);
                    if (candidate[1][1]) newContext.choiceId = String(candidate[1][1]);
                  }
                }
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
