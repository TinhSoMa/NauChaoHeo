# NauChaoHeo (v1.7.0)

Electron + Vite + React 19 desktop app (TypeScript). Vietnamese personal tool for AI-assisted subtitle translation, video processing, downloading, TTS, and ebook/story translation.

## Architecture

- **3 Electron layers**: `src/main/` (Node), `src/preload/` (contextBridge), `src/renderer/` (React 19)
- **Path aliases**: `@/` = `src/renderer/src/`, `@shared/` = `src/shared/`
- **Entrypoints**: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`
- **State**: React Router v7 (HashRouter) + Zustand
- **Styling**: Tailwind CSS v4 (`@tailwindcss/postcss`) with CSS-variable theming (light/dark in `globals.css`)
- **Database**: single `nauchaoheo.db` at `app.getPath('userData')`, shared via `getDatabase()` from `src/main/database/schema.ts:421`. No migration framework — `migrations.ts` and `index.ts` are empty. Schema has inline legacy migration logic.
- **App init flow**: `app.whenReady()` → `initDatabase()` → `AppSettingsService.initialize()` → `registerAllHandlers()` (from `src/main/ipc/index.ts:29`) → `tryImportDevKeys()` → `createDashboardWindow()` (from `src/main/windowManager.ts`)

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | `chcp 65001 && electron-vite dev` (UTF-8) |
| `npm run build` | `electron-vite build` |
| `npm run start` / `preview` | `electron-vite preview` |
| `npm run postinstall` | `electron-rebuild -f -w better-sqlite3` (runs automatically on install) |
| `npm run build:win` | Prep yt-dlp → aria2c → Go worker → Python runtime → `electron-vite build` → `electron-rebuild` → `electron-builder --win` (NSIS) |
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
- **Only extension tests are runnable** — no tests exist for the Electron app.
- `src/main/services/downloader/__tests__/downloadIntent.test.ts` is TypeScript with no configured runner.

## Service Workers (External Processes)

All Python workers communicate via **stdin/stdout JSON-line protocol**. Bundled Python runtime at `resources/python/win32-x64/runtime/`. Worker source files are copied into `resources/` at build time (see `electron-builder.yml:51-78`).

| Worker | Source |
|---|---|
| `gemini_webapi_worker.py` | `src/main/services/geminiWebApi/python/` |
| `grok_ui_worker.py` | `src/main/services/grokUi/python/` |
| `edge_tts_worker.py` | `src/main/services/tts/python/` |
| `ebooklib_story_worker.py` | `src/main/services/story/python/` |
| `mem0_context_worker.py` | `src/main/services/memoryContext/python/` |
| `audio_merge_worker.py` | `src/main/services/audioMerge/python/` |
| `edge_tts_worker.exe` (Go) | `src/main/services/tts/go/` (scaffold, not functional) |

## Config & Secrets

- **Gemini API keys**: `gemini_keys.json` (gitignored) or `resources/api-keys.example.json`
- **App model ID (runtime)**: `com.veo3promptbuilder` — set in `src/main/index.ts:19`
- **App ID (electron-builder)**: `com.tinhsoma.nauchaoheo` — set in `electron-builder.yml:2`
- **Native addon**: `better-sqlite3` must be in `asarUnpack` (configured in `electron-builder.yml:22`)
- **Extensions**: 5 projects in `extension/` dir — EbookExtension, NovelSub, qidian (MV3), qidian_old, tiktok

## Conventions

- Vietnamese comments, variable names, and descriptions throughout.
- CJS config files: `tailwind.config.cjs`, `postcss.config.cjs` (inside `src/renderer/`, not root).
- **Renderer tsconfig** (`tsconfig.json`): `strict`, `noUnusedLocals`, `noUnusedParameters`, `moduleResolution: "bundler"`, `noEmit: true`.
- **Main/preload tsconfig** (`tsconfig.main.json`): `module: "Node16"`, `moduleResolution: "node16"` — imports must include `.js` extension.
- `electron.vite.config.ts` at root is the main build config. Renderer also has its own `vite.config.ts` (standalone, not used by `electron-vite`).
- `NewPromt.md` + `newpromt.json` are the subtitle translation system prompt.
