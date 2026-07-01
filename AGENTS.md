# NauChaoHeo (v1.7.0)

Electron + Vite + React 19 desktop app (TypeScript). Vietnamese personal tool for AI-assisted subtitle translation, video processing, downloading, TTS, and ebook/story translation.

## Quick Start

- `npm run dev` — Start dev (UTF-8 required via `chcp 65001`)
- `npm run test:extension` — Run extension tests only

## Architecture

- **3 Electron layers**: `src/main/` (Node), `src/preload/` (contextBridge), `src/renderer/` (React 19)
- **Path aliases**: `@/` = `src/renderer/src/`, `@shared/` = `src/shared/`
- **State**: React Router v7 (HashRouter) + Zustand

## Build & Commands

| Command | Purpose |
|---|---|
| `npm run dev` | `chcp 65001 && electron-vite dev` (UTF-8) |
| `npm run build:win` | Full Windows build: prepare tools → build → electron-rebuild → electron-builder |
| `npm run prepare:{python-runtime,yt-dlp,aria2c,go-worker}` | Fetch/bundle external tools |
| `npm run bench:rotation-queue` | Runs `npx tsc -p tsconfig.main.json` first, then node benchmark |
| `npm run test:extension` | `node --test tests/extension/*.test.mjs` |

- **No lint, typecheck, or formatter scripts.** Use `npx tsc -p tsconfig.main.json` to compile check main/preload.

## Testing

- Node.js built-in test runner (`node:test`), ESM `.mjs` files.
- Only extension tests are runnable — Chrome API mocked via `tests/extension/harness/mock-chrome.mjs`.

## Key Constraints

- **Renderer tsconfig** (`tsconfig.json`): `moduleResolution: "bundler"`, `noEmit: true`, imports omit `.js`.
- **Main/preload tsconfig** (`tsconfig.main.json`): `module: "Node16"`, imports **must include `.js` extension**.
- **Native addon**: `better-sqlite3` in `asarUnpack` (see `electron-builder.yml:22`).
- **Database**: `nauchaoheo.db` at `app.getPath('userData')`, accessed via `getDatabase()` in `src/main/database/schema.ts:422`.
- **Python workers**: stdin/stdout JSON-line protocol. Source files copied at build time (see `electron-builder.yml:51-78`).
