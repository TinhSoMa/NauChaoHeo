# Gemini WebApi Service (Standalone)

## Scope
This module provides a standalone backend service for `gemini_webapi` + `browser-cookie3`.
It is library-only in this phase and is **not integrated** into existing caption/story/chat flows.

## Cookie Source Policy
1. Primary: SQLite `gemini_chat_config` with columns `"__Secure-1PSID"` and `"__Secure-1PSIDTS"` (active row first).
2. Fallback: `AppSettings.geminiWebApiCookieFallback`.
3. If cookie is missing/invalid, service can refresh from browser (`chrome -> edge`) and persist back.

## Public API
- `healthCheck()`
- `getCookieStatus()`
- `refreshCookieFromBrowser(options?)`
- `generateContent(request)`
- `shutdown()`

## Runtime
Python runtime is resolved with preference for `py -3.12`, then fallback candidates.
Required Python modules:
- `gemini_webapi`
- `browser_cookie3`

## Smoke Usage (main process)
```ts
import { getGeminiWebApiRuntime } from '../geminiWebApi';

const service = getGeminiWebApiRuntime();

const health = await service.healthCheck();
console.log('health', health);

const result = await service.generateContent({
  prompt: 'xin chao',
  forceCookieRefresh: false,
  timeoutMs: 90000,
});

console.log(result);
await service.shutdown();
```

## Notes
- Secrets are masked in logs.
- The service does not expose raw cookie values in API result payloads.
- Worker protocol is JSON-over-stdio with one JSON object per line.

## Continue Previous Conversation
Use `conversationKey` to reuse chat context. The service stores metadata in-memory per key and account.

```ts
const first = await service.generateContent({
  prompt: 'Tóm tắt chương 1',
  accountConfigId: 'acc-a',
  conversationKey: 'story-batch-001',
  resetConversation: true,
  useChatSession: true,
});

const second = await service.generateContent({
  prompt: 'Dịch tiếp chương 2 theo cùng văn phong',
  accountConfigId: 'acc-a',
  conversationKey: 'story-batch-001',
  useChatSession: true,
});
```
