# NauChaoHeo (v1.7.0)

Electron + Vite + React 19 desktop app (TypeScript). Vietnamese personal tool for AI-assisted subtitle translation, video processing, downloading, TTS, and ebook/story translation.

## Architecture

- **3 Electron layers**: `src/main/` (Node), `src/preload/` (contextBridge), `src/renderer/` (React 19)
- **Path aliases**: `@/` = `src/renderer/src/`, `@shared/` = `src/shared/`
- **Entrypoints**: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`
- **State**: React Router v7 (HashRouter) + Zustand
- **Styling**: Tailwind CSS v4 (`@tailwindcss/postcss`) with CSS-variable theming (light/dark in `src/renderer/src/styles/globals.css`)
- **Database**: single `nauchaoheo.db` at `app.getPath('userData')`, shared via `getDatabase()` from `src/main/database/schema.ts:421`. All `*Database.ts` modules import `getDatabase()`. `index.ts` is empty. `migrations.ts` is empty — no migration framework.
- **App init flow**: `app.whenReady()` → `initDatabase()` → `AppSettingsService.initialize()` → `registerAllHandlers()` → `tryImportDevKeys()`
- **AI services**: `gemini/` (API keys), `geminiWebApi/` (cookie-based, Python bridge), `chatGemini/` (chat-specific), `grokUi/` (Python bridge)
- **Current branch**: `feat/update-capcut-token`

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | `chcp 65001 && electron-vite dev` (UTF-8) |
| `npm run build` | `electron-vite build` |
| `npm run start` / `preview` | `electron-vite preview` |
| `npm run build:win` | Full pipeline: prep yt-dlp → aria2c → Go worker → Python runtime → build → electron-builder (NSIS) |
| `npm run build:{mac,linux}` | `npm run build && electron-builder --{mac,linux}` |
| `npm run build:go-worker` | Compile `src/main/services/tts/go/main.go` → `resources/tts/go/edge_tts_worker.exe` |
| `npm run prepare:{python-runtime,yt-dlp,aria2c}` | PS1 scripts to fetch bundled tools |
| `npm run test:extension` | `node --test tests/extension/*.test.mjs` |
| `npm run test:extension:background` | `node --test tests/extension/background.logic.test.mjs` |
| `npm run bench:{edge-tts-worker,rotation-queue}` | Benchmark scripts |
| `npm test` | Prints hint to use `test:extension` |

**No lint, typecheck, or formatter scripts exist.**

## Testing

- **Node.js built-in test runner** (`node:test` + `node:assert/strict`). Tests use `.mjs` (ESM).
- Chrome API mocked via `tests/extension/harness/mock-chrome.mjs`
- **Only extension tests are runnable** — there are no tests for the Electron app.
- `src/main/services/downloader/__tests__/downloadIntent.test.ts` is TypeScript with no configured runner.
- Focused command: `npm run test:extension:background`

## Service Workers (External Processes)

All Python workers communicate via **stdin/stdout JSON-line protocol**. Bundled Python runtime at `resources/python/win32-x64/runtime/`.

| Worker | Source | Packaged to |
|---|---|---|
| `gemini_webapi_worker.py` | `src/main/services/geminiWebApi/python/` | `resources/geminiWebApi/python/` |
| `grok_ui_worker.py` | `src/main/services/grokUi/python/` | `resources/grokUi/python/` |
| `edge_tts_worker.py` | `src/main/services/tts/python/` | `resources/tts/python/` |
| `ebooklib_story_worker.py` | `src/main/services/story/python/` | `resources/story/python/` |
| `mem0_context_worker.py` | `src/main/services/memoryContext/python/` | `resources/memoryContext/python/` |
| `edge_tts_worker.exe` (Go) | `src/main/services/tts/go/` | `resources/tts/go/` (scaffold, not functional) |

## Config & Secrets

- **Gemini API keys**: `gemini_keys.json` (gitignored) or `resources/api-keys.example.json`
- **App model ID (runtime)**: `com.veo3promptbuilder` — set in `src/main/index.ts:18`
- **App ID (electron-builder)**: `com.tinhsoma.nauchaoheo` — set in `electron-builder.yml:2`
- **Native addon**: `better-sqlite3` must be in `asarUnpack` (already configured in `electron-builder.yml:22`)
- **Extensions**: 5 projects in `extension/` dir — EbookExtension, NovelSub, qidian (MV3), qidian_old, tiktok

## Conventions

- Vietnamese comments, variable names, and descriptions throughout.
- CJS config files: `tailwind.config.cjs`, `postcss.config.cjs` (inside `src/renderer/`, not root).
- **Renderer tsconfig** (`tsconfig.json`): `strict`, `noUnusedLocals`, `noUnusedParameters`, `moduleResolution: "bundler"`, `noEmit: true`.
- **Main/preload tsconfig** (`tsconfig.main.json`): `module: "Node16"`, `moduleResolution: "node16"` — imports must include `.js` extension.
- `electron.vite.config.ts` at root is the main build config.
- `check` script not required for v4 tailwindcss.
- `README (2).md` is an unrelated Mem0 project — not this project's documentation.
- `NewPromt.md` + `newpromt.json` are the subtitle translation system prompt.
- `.claude/skills/` has 4 custom Claude skill files; `.code-review-graph/graph.db` is a knowledge graph (MCP).
