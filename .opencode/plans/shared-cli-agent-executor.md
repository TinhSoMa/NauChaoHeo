# Plan: Refactor CLI Agent Spawning into 1 Shared Executor

## Hiện trạng
Có **3 nơi** tự resolve agent binary + spawn process riêng:

| Nơi | File | resolve | spawn | stdin |
|---|---|---|---|---|
| Caption | `caption/providers/cliAgentProvider.ts` | `resolveAgentBin()` riêng + `createCliAgentProvider()` | `spawnWithStdin()` riêng | `child.stdin!.write()` |
| Story | `agentTranslation/spawner.ts` | `resolveAgent()` riêng | `spawn()` trực tiếp | `child.stdin?.write()` |
| **(Mới)** | **`cliAgentExecutor.ts`** | **`resolveAgentDef()` + `resolveAgentBin()` + `resolveAgentModel()`** | **`spawnAgentProcess()` + `execAgent()`** | **`writeStdin()`** |

## Các bước thực hiện

### Bước 1: Hoàn thiện `src/main/services/cliAgentExecutor.ts` ✓ (đã tạo)

File shared executor với các export:
- `resolveAgentDef(agentId?)` → tìm agent def từ AppSettings
- `resolveAgentBin(def, customBinPath?)` → resolve binary path
- `resolveAgentModel(def)` → resolve model từ AppSettings
- `spawnAgentProcess(bin, args, opts?)` → spawn process với cross-platform invocation
- `writeStdin(child, input)` → ghi stdin + end
- `execAgent(options)` → full flow: resolve + spawn + collect output + timeout

### Bước 2: Refactor `caption/providers/cliAgentProvider.ts`

**Xoá:**
- `resolveAgentBin()` function (duplicate)
- `spawnWithStdin()` function (duplicate)
- Import `existsSync`, `spawn`, `getAllCliAgentDefs`, `resolveOnPath`, `createCommandInvocation`, `AppSettingsService`, `CliAgentDef`

**Giữ:**
- `extractOpenCodeText()` — caption-specific JSON stream parser
- `createCliAgentProvider()` interface

**Thay:**
- `spawnWithStdin()` → `execAgent()` với args `['run', '--format', 'json']`
- Agent resolution → shared `execAgent()` tự xử lý

### Bước 3: Refactor `agentTranslation/spawner.ts`

**Xoá:**
- `resolveAgent()` method (duplicate)
- Import `getCliAgentDef`, `createCommandInvocation` (đã có trong shared)
- Import `AppSettingsService` (đã có trong shared)

**Giữ:**
- Event emitter pattern (`SpawnEvent`, `on('event')`)
- `cancel()` method
- `scanOutputDir()` method
- `getStatus()` method

**Thay:**
- `resolveAgent()` → gọi `resolveAgentDef()` + `resolveAgentBin()` + `resolveAgentModel()` từ shared
- Raw `spawn()` → `spawnAgentProcess()` từ shared
- `child.stdin?.write()` + `child.stdin?.end()` → `writeStdin()` từ shared
- `createCommandInvocation` → shared `spawnAgentProcess()` tự xử lý

### Bước 4: Verify agentTranslation/agentDetector.ts
- Đã dùng `cliAgentScan/registry` + `detection` → chỉ verify không lỗi

### Bước 5: Clean imports
- Các file gọi shared cần import từ `../cliAgentExecutor` hoặc `../../cliAgentExecutor`

### Bước 6: Build verify
- `npm run build` để kiểm tra lỗi TypeScript

## Không thay đổi
- `cliAgentScan/` (core registry + detection)
- IPC handlers interface
- Preload API interface
- Renderer UI (StoryTranslator, CaptionTranslator)
- Types (`agentTranslation.ts`, `global.d.ts`)
