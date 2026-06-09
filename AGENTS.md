# NauChaoHeo (v1.6.0)

Electron + Vite + React 19 desktop app (TypeScript). Vietnamese personal tool for AI-assisted subtitle translation, video processing, downloading, TTS, and ebook/story translation.

## Architecture

- **3 Electron layers**: `src/main/` (Node), `src/preload/` (contextBridge), `src/renderer/` (React 19)
- **Path aliases**: `@/` = `src/renderer/src/`, `@shared/` = `src/shared/`
- **Entrypoints**: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`
- **State**: React Router v7 (HashRouter) + Zustand
- **Styling**: Tailwind CSS v4 with CSS-variable-based theming

## Dev Commands

| Command | What it does |
|---|---|
| `npm run dev` | `chcp 65001 && electron-vite dev` (UTF-8) |
| `npm run build` | `electron-vite build` |
| `npm run build:win` | Full pipeline: prep yt-dlp → aria2c → Go worker → Python runtime → build → electron-builder (NSIS) |
| `npm run build:mac` / `build:linux` | Build then electron-builder (no prep scripts) |
| `npm run build:go-worker` | Compile `src/main/services/tts/go/main.go` → `resources/tts/go/edge_tts_worker.exe` |
| `npm run test:extension` | Node native test runner on `tests/extension/*.test.mjs` |

No lint, typecheck, or formatter scripts exist.

## Key Directories

| Path | Role |
|---|---|
| `src/main/services/caption/` | Subtitle translation, SRT/ASS parsing, hardsub video rendering (FFmpeg) |
| `src/main/services/gemini/` | Gemini API key rotation, model config, DB-backed key storage |
| `src/main/services/geminiWebApi/` | Cookie-based Gemini Web interaction (Python bridge) |
| `src/main/services/grokUi/` | Grok UI API (Python bridge) |
| `src/main/services/tts/` | Edge TTS — Python worker live, Go worker in scaffold |
| `src/main/services/story/` | Ebook/novel translation via ebooklib Python worker |
| `src/main/services/memoryContext/` | Mem0-based memory via Python worker |
| `src/main/services/downloader/` | yt-dlp + aria2c segmented downloader |
| `src/main/services/cutVideo/` | Video cut/split/merge, audio extract, CapCut auto-batch |
| `src/main/services/shared/universalRotationQueue/` | Configurable API key rotation + request queuing |
| `src/main/services/proxy/` | Rotating proxy manager + Webshare API integration |
| `src/main/database/` | SQLite via better-sqlite3 (5+ DBs for cookies, proxies, models, settings) |
| `extension/` | Browser extensions: Qidian Helper (MV3), TikTok Auto Follow Like |
| `tests/extension/` | Node test runner tests for extension background logic |
| `resources/` | Bundled tools: FFmpeg, yt-dlp, aria2c, Python runtime, fonts, icons |
| `scripts/` | PS1 scripts for preparing yt-dlp, aria2c, Python runtime; benchmark |

## Service Workers (External Processes)

All Python workers communicate via **stdin/stdout JSON-line protocol** (one JSON object per line). Bundled Python runtime required.

| Worker | Source | Packaged to |
|---|---|---|
| `gemini_webapi_worker.py` | `src/main/services/geminiWebApi/python/` | `resources/geminiWebApi/python/` |
| `grok_ui_worker.py` | `src/main/services/grokUi/python/` | `resources/grokUi/python/` |
| `edge_tts_worker.py` | `src/main/services/tts/python/` | `resources/tts/python/` |
| `ebooklib_story_worker.py` | `src/main/services/story/python/` | `resources/story/python/` |
| `mem0_context_worker.py` | `src/main/services/memoryContext/python/` | `resources/memoryContext/python/` |
| `edge_tts_worker.exe` (Go) | `src/main/services/tts/go/` | `resources/tts/go/` (scaffold, not fully functional) |

## Configuration & Secrets

- **Gemini API keys**: `gemini_keys.json` (gitignored) or `resources/api-keys.example.json` as template
- **App model ID**: `com.veo3promptbuilder` (Windows)
- **All DB files**: SQLite via better-sqlite3, created at runtime (no migrations on startup beyond schema init)

## Testing

- Uses **Node.js built-in test runner** (`node:test` + `node:assert/strict`)
- Extension tests only: `npm run test:extension`
- Chrome API mocked via `tests/extension/harness/mock-chrome.mjs`
- No test runner config file — tests run via `--test` flag
- `src/main/services/downloader/__tests__/downloadIntent.test.ts` is a TypeScript test (no runner configured)

## Conventions

- Vietnamese comments and descriptions throughout (variable names, service descriptions)
- CJS config files: `tailwind.config.cjs`, `postcss.config.cjs`
- Renderer config (Tailwind, PostCSS) lives inside `src/renderer/`, not project root
- Electron main process config is at `electron.vite.config.ts` (root)
- `README (2).md` is an unrelated Mem0 project README — not this project's documentation
- `NewPromt.md` is the subtitle translation system prompt sent to AI models
