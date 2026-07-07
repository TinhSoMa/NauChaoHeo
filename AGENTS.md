# NauChaoHeo (v1.7.1)

Electron + Vite + React 19 desktop app (TypeScript). Vietnamese personal tool for AI-assisted subtitle translation, video processing, downloading, TTS, and ebook/story translation.

## Quick Start

- `npm run dev` — Start dev (UTF-8 required via `chcp 65001`)
- `npm run test:extension` — Run extension tests only
- `npm run test:extension:background` — Run only background logic tests

## TypeScript

| Config | For | Key constraint |
|---|---|---|
| `tsconfig.json` | Renderer | `moduleResolution: "bundler"`, `noEmit: true`, imports omit `.js` |
| `tsconfig.main.json` | Main + Preload + Shared | `composite: true`, `module: "Node16"`, imports **must** include `.js` |
| `tsconfig.node.json` | Vite config (`electron.vite.config.ts`) | `composite: true`, minimal |

- **Three separate tsc checks**: `npx tsc -p tsconfig.main.json --noEmit` (main/preload/shared), `npx tsc --noEmit` (renderer), and `npx tsc -p tsconfig.node.json --noEmit` (Vite config). All must pass.
- `composite: true` on `tsconfig.main.json` generates `.d.ts` in `dist/main/`. When editing shared types, rebuild main first: `npx tsc -p tsconfig.main.json`, else the renderer resolves stale `.d.ts`.
- `noUnusedLocals` / `noUnusedParameters` are on — TS errors on unused imports/vars.

## Architecture

- **3 Electron layers**: `src/main/` (Node), `src/preload/` (contextBridge), `src/renderer/` (React 19 via `index.html` → `main.tsx`)
- **Path aliases**: `@/` = `src/renderer/src/`, `@shared/` = `src/shared/`
- **IPC wiring**: handlers in `src/main/ipc/` registered via `registerAllHandlers()`; preload exposes via per-domain API files (`deepseekApi.ts`, `geminiApi.ts`, etc.) using `contextBridge.exposeInMainWorld`
- **Database**: better-sqlite3, `nauchaoheo.db` at `app.getPath('userData')`, managed via `getDatabase()` in `src/main/database/schema.ts`
- **State**: React Router v7 (HashRouter) + Zustand
- **Python workers**: stdin/stdout JSON-line protocol, copied at build time (`electron-builder.yml:51-78`)
- **Shared types**: `src/shared/types/` used by all layers via `@shared/types/` alias
- **Tailwind CSS v4**: `@import "tailwindcss"` + `@config` in CSS (not classic `@tailwind` directives)
- **Theming**: CSS custom properties, light "Ocean Breeze" / dark "Deep Ocean"

## Build & Commands

| Command | Purpose |
|---|---|
| `npm run dev` | `chcp 65001 && npx electron-vite dev` (UTF-8 required) |
| `npm run build:win` | Full Windows build: prepare tools → build → electron-rebuild → electron-builder |
| `npm run prepare:{python-runtime,yt-dlp,aria2c,go-worker}` | Fetch/bundle external tools |
| `npm run test:extension` | `node --test tests/extension/*.test.mjs` |
| `npm run test:extension:background` | `node --test tests/extension/background.logic.test.mjs` |
| `npx tsc -p tsconfig.main.json --noEmit` | Typecheck main/preload/shared |
| `npx tsc --noEmit` | Typecheck renderer |
| `npm run build:go-worker` | Requires Go toolchain locally |

- **No lint, no formatter.** Only TypeScript compiler checks.
- **No CI, no pre-commit hooks.** Personal project.

## Testing

- Node.js built-in runner (`node:test`), ESM `.mjs` files.
- Only extension tests exist — Chrome API mocked via `tests/extension/harness/mock-chrome.mjs`.

## Key Facts

- `postinstall` runs `electron-rebuild -f -w better-sqlite3` for native addon.
- better-sqlite3 is in `asarUnpack` (`electron-builder.yml:22`).
- `electron.builder.yml` extraResources bundle python workers, ffmpeg, fonts, yt-dlp, aria2c, go TTS worker.
- DeepSeek has its own database table (`deepseek_config`) and IPC handlers (`deepseekHandlers.ts`), separate from Gemini/OpenRouter.
- `extension/` (root) contains 5 Chrome extension projects: EbookExtension, NovelSub, qidian (x2), tiktok — separate from the Electron app.
- `test/` (root) holds ad-hoc scripts, not the real test suite. Actual tests are in `tests/extension/`.
- `README (2).md` is a stale Mem0 project file, **not** the app README. Real documentation is in `HUONG_DAN_CAI_DAT.md` (Vietnamese).
- Proxy architecture: per-scope config (caption, story, chat, tts, other) with Webshare API integration.
