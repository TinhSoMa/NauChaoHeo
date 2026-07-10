# NauChaoHeo (v1.7.1)

Electron + Vite + React 19 desktop app (TypeScript). Vietnamese personal tool for AI-assisted subtitle translation, video processing, downloading, TTS, and ebook/story translation.

## TypeScript (three separate configs)

| Config | For | Key constraint |
|---|---|---|
| `tsconfig.json` | Renderer | `moduleResolution: "bundler"`, `noEmit`, imports omit `.js` |
| `tsconfig.main.json` | Main + Preload + Shared | `composite: true`, `module: "Node16"`, imports **must** include `.js` |
| `tsconfig.node.json` | Vite config only | `composite: true`, minimal |

- **Three separate tsc checks**: `npx tsc -p tsconfig.main.json --noEmit` (main/preload/shared), `npx tsc --noEmit` (renderer), `npx tsc -p tsconfig.node.json --noEmit` (vite config). All must pass.
- `composite: true` on `tsconfig.main.json` generates `.d.ts` in `dist/main/`. After editing shared types, rebuild main first: `npx tsc -p tsconfig.main.json`, else renderer resolves stale `.d.ts`.
- `noUnusedLocals` / `noUnusedParameters` are on — TS errors on unused imports/vars.
- **No lint, no formatter, no CI.** Only TypeScript checks. No pre-commit hooks.

## Architecture

- **3 Electron layers**: `src/main/` (Node), `src/preload/` (contextBridge), `src/renderer/` (React 19)
- **Path aliases**: `@/` = `src/renderer/src/`, `@shared/` = `src/shared/`
- **IPC wiring**: handlers in `src/main/ipc/` registered via `registerAllHandlers()`; preload exposes 21 per-domain API files under `window.electronAPI.*` via `contextBridge`
- **Router**: React Router v7 **HashRouter** (not BrowserRouter)
- **Database**: better-sqlite3, `nauchaoheo.db` at `app.getPath('userData')`, managed via `getDatabase()` in `src/main/database/schema.ts`. Native addon needs `asarUnpack` and `postinstall rebuild`.
- **State**: Zustand (one store file visible at `src/renderer/src/stores/`)
- **Python workers**: stdin/stdout JSON-line protocol, scripts at `src/main/services/*/python/`, bundled via `electron-builder.yml:51-78`. Embedded Python runtime at `resources/python/`.
- **Go TTS worker**: source at `src/main/services/tts/go/`, built to `resources/tts/go/edge_tts_worker.exe`. Default is NOT bundled — run `npm run build:go-worker` if TTS fails.
- **Shared types**: `src/shared/types/` used by all layers via `@shared/types/`
- **Tailwind CSS v4**: `@import "tailwindcss"` + `@config` in CSS (v3 `@tailwind` directives do NOT work)
- **Theming**: CSS custom properties, light "Ocean Breeze" / dark "Deep Ocean"

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start dev (requires `chcp 65001` UTF-8 on Windows) |
| `npm run build:win` | Full Windows build: prepare tools → build → electron-rebuild → electron-builder |
| `npm run prepare:{python-runtime,yt-dlp,aria2c,go-worker}` | Fetch/bundle external tools |
| `npm run test:extension` | `node --test tests/extension/*.test.mjs` |
| `npm run test:extension:background` | `node --test tests/extension/background.logic.test.mjs` |
| `npx tsc -p tsconfig.main.json --noEmit` | Typecheck main/preload/shared |
| `npx tsc --noEmit` | Typecheck renderer |
| `npm run build:go-worker` | Requires Go toolchain (`go` in PATH or `D:/Program Files/Go/bin/go.exe`) |
| `npm run bench:rotation-queue` | `npx tsc -p tsconfig.main.json && node dist/main/.../queueBenchmark.js` |

## Testing

- Node.js built-in runner (`node:test`), ESM `.mjs` files.
- Only extension tests exist — Chrome API mocked via `tests/extension/harness/mock-chrome.mjs`.
- Real test suite: `tests/extension/` (root `test/` is gitignored ad-hoc Python scripts, not tests).

## Gotchas

- **No real project README.** `README (2).md` is the unrelated Mem0 project readme. `NewPromt.md` is the subtitle translation system prompt.
- **`project/` is a nested git repo** (separate `.git/` inside), not a submodule. Git operations on root may behave unexpectedly there.
- **`extension/` (root) contains 5 independent Chrome extensions** (EbookExtension, NovelSub, qidian ×2, tiktok) — separate from the Electron app. Not built or tested by npm scripts.
- **`ts_errors.txt`** at root is a stale artifact from a past session, not a build output.
- **`.opencode/`, `.claude/skills/`, `.kilo/`** are AI coding tool config directories (OpenCode, Claude Code, KiloCode). Not app code.
- **DeepSeek** has its own database table (`deepseek_config`) and IPC handlers (`deepseekHandlers.ts`), separate from Gemini/OpenRouter. Default model: `deepseek-v4-flash`.
- **Per-scope proxy config** (caption, story, chat, tts, other scopes) with Webshare API integration. Non-obvious multi-layered proxy system.
- **`postinstall`** runs `electron-rebuild -f -w better-sqlite3` for native addon — this is required after `npm install`.
- **Renderer vite config** at `src/renderer/vite.config.ts` (separate from `electron.vite.config.ts` at root).
