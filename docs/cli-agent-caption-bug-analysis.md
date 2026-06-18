# CLI Agent Caption Translation Bug Analysis

## Triệu chứng (Log)

```
[CaptionTranslator] Dịch batch 1 (100 dòng) [transport: cli_agent]
[TextSplitter] Sử dụng default prompt (markdown), format: json
[TextSplitter] Đã lưu prompt debug: ...\step3_prompt_batch_1.txt
[CaptionTranslator] Retry cooldown 1000ms
[CaptionTranslator] Dịch batch 1 (100 dòng) [transport: cli_agent]    ← retry #1
...
[CaptionTranslator] Retry cooldown 1000ms
[CaptionTranslator] Dịch batch 1 (100 dòng) [transport: cli_agent]    ← retry #2
...
[CaptionTranslator] Retry cooldown 1000ms
                                                                    ← chuyển sang batch 2
[CaptionHandlers] Translate batch #2/32: 100 entries
...
```

**Pattern:** Mỗi batch retry 3 lần, nhưng KHÔNG có output/error nào giữa `Đã lưu prompt debug` và `Retry cooldown`. Agent không hề được spawn thành công.

---

## Nguyên nhân 1: Binary Resolution Mismatch

### Registry khai báo `bin` khác tên file thực tế

File **`src/main/cliAgentScan/registry.ts`** (lines 21-24):
```typescript
{
  id: 'opencode',
  name: 'OpenCode',
  bin: 'opencode-cli',          // ← tên lý thuyết
  fallbackBins: ['opencode'],   // ← tên thực tế trên Windows
  // ...
},
```

### File thực tế trên ổ đĩa:

```
C:\Users\congt\AppData\Roaming\npm\
  opencode          (296 bytes)  - không có extension
  opencode.cmd      (148 bytes)  - npm CMD shim ← cái này dùng được
  opencode.ps1      (496 bytes)  - npm PowerShell shim
```

**Không có** file nào tên `opencode-cli.*` cả.

### Detection (`detection.ts`) làm đúng — resolve qua fallbackBins + resolveOnPath

File **`src/main/cliAgentScan/detection.ts`** (lines 200-209):
```typescript
  } else {
    const binsToTry = [def.bin, ...(def.fallbackBins || [])];
    // binsToTry = ['opencode-cli', 'opencode']
    for (const bin of binsToTry) {
      const r = resolveOnPath(bin);
      // Lần 1: resolveOnPath('opencode-cli') → null (không tìm thấy)
      // Lần 2: resolveOnPath('opencode') → 'C:\Users\...\opencode.cmd' (tìm thấy)
      if (r) {
        resolvedPath = r;  // ← path đầy đủ: 'C:\Users\...\npm\opencode.cmd'
        foundBin = bin;
        break;
      }
    }
  }
```

Hàm `resolveOnPath` (lines 55-68):
```typescript
export function resolveOnPath(bin: string): string | null {
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map((e) => e.trim().toLowerCase())
    : [''];
  const dirs = resolvePathDirs();
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, bin + ext);
      if (existsSync(full)) return full;
      // dir = 'C:\Users\congt\AppData\Roaming\npm'
      // full = 'C:\Users\congt\AppData\Roaming\npm\opencode.cmd' → tồn tại!
    }
  }
  return null;
}
```

### Provider (`cliAgentProvider.ts`) làm sai — không resolve, dùng raw `enabled.bin`

File **`src/main/services/caption/providers/cliAgentProvider.ts`** (lines 30-33):
```typescript
  // Resolve binary path
  const entry = config[enabled.id];
  const customBin = entry?.customBinPath?.trim();
  const bin = customBin || enabled.bin;
  // enabled.bin = 'opencode-cli'
  // customBin = undefined (người dùng không cấu hình custom bin)
  // → bin = 'opencode-cli'
```

Sau đó `bin` được truyền thẳng vào `spawnWithStdin` (line 42):
```typescript
const result = await spawnWithStdin(bin, prompt, signal, modelToUse);
// spawnWithStdin('opencode-cli', ...)
```

Trong `spawnWithStdin` (line 66-71):
```typescript
const invocation = createCommandInvocation(bin, args);
// createCommandInvocation('opencode-cli', [...])
// → command = 'opencode-cli', args = [...] (không có extension .cmd/.bat)
// → không wrap bằng cmd /c, giữ nguyên

const child = spawn(invocation.command, invocation.args, {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env },
  signal,
});
// spawn('opencode-cli', [...])
// → ENOENT: opencode-cli không tồn tại trên PATH
// → Windows spawn() không tìm thấy opencode-cli.exe / opencode-cli.cmd / opencode-cli.bat
// → child 'error' event được emit
```

Hàm `createCommandInvocation` (detection.ts lines 76-87):
```typescript
export function createCommandInvocation(command: string, args: string[]): CommandInvocation {
  if (process.platform === 'win32' && /\.(bat|cmd)$/i.test(command)) {
    // 'opencode-cli' không khớp regex /\.(bat|cmd)$/i → không wrap
    // → trả về { command: 'opencode-cli', args: [...] }
  }
  return { command, args };
}
```

### Kết quả

`spawn('opencode-cli', [...])` → **ENOENT** → `child.on('error')` fires → Promise rejects → catch ở `call()` line 48:
```typescript
      return { success: false, error: `[${enabled.name}] ${err.message}` };
      // error = '[OpenCode] spawn opencode-cli ENOENT' (hoặc tương tự)
```

Nhưng CaptionTranslator không log cái error string này ra console — nó chỉ lưu vào `batchResult` và retry. Vì vậy user chỉ thấy `Retry cooldown` mà không thấy error message.

---

## Nguyên nhân 2: Model fallthrough đến Gemini default

File **`src/main/cliAgentProvider.ts`** (lines 36-39):
```typescript
const modelToUse = (selection?.model)
  || entry?.selectedModel
  || model        // ← model param từ captionTranslator.ts, là GEMINI_MODELS.FLASH_3_0
  || (enabled.models && enabled.models.length > 0 ? enabled.models[0].id : undefined);
```

File **`src/main/services/caption/captionTranslator.ts`** (line 738):
```typescript
  const {
    entries,
    targetLanguage = 'Vietnamese',
    model = GEMINI_MODELS.FLASH_3_0,   // ← default là Gemini model
    // ...
  } = options;
```

Khi người dùng không chọn model trong SearchableModelSelect (Step 3):
- `selection?.model` = undefined
- `entry?.selectedModel` = undefined  
- `model` = `'gemini-2.0-flash-exp'` (GEMINI_MODELS.FLASH_3_0)
- `enabled.models` = `[]` (sau khi xóa hardcode, opencode lấy live model từ scan, nhưng provider dùng raw def nên `enabled.models` là undefined)

→ `modelToUse = 'gemini-2.0-flash-exp'`

Sau đó trong `spawnWithStdin` (lines 62-65):
```typescript
    const args: string[] = [];
    if (model) {
      args.push('--model', model);
      // → args = ['--model', 'gemini-2.0-flash-exp']
    }
```

OpenCode CLI với `--model` flag không hỗ trợ model ID của Gemini → agent có thể crash hoặc ignore.

Tuy nhiên, lỗi này KHÔNG phải là nguyên nhân chính gây ra triệu chứng trong log (vì `spawn('opencode-cli', ...)` đã ENOENT trước khi `--model` kịp gây lỗi).

---

## Nguyên nhân 3: Error bị swallow

File **`src/main/services/caption/providers/cliAgentProvider.ts`** (lines 41-49):
```typescript
      try {
        const result = await spawnWithStdin(bin, prompt, signal, modelToUse);
        return { success: true, data: result };
      } catch (err: any) {
        if (err.message === 'STOP_REQUESTED' || signal?.aborted) {
          return { success: false, error: 'STOP_REQUESTED', errorCode: 'STOP_REQUESTED' };
        }
        return { success: false, error: `[${enabled.name}] ${err.message}` };
      }
```

Error message được wrap thành `[{tên agent}] {message}` và trả về trong object `{ success: false, error: string }`.

CaptionTranslator nhận được `{ success: false, error: '[OpenCode] spawn opencode-cli ENOENT' }`.

File **`src/main/services/caption/captionTranslator.ts`** (lines 345-352):
```typescript
    if (!response.success || typeof response.data !== 'string') {
      return {
        success: false,
        translatedTexts: [],
        error: response.error || 'Không có response',
        transport: provider.transport,
      };
    }
```

Sau đó batch result được retry 3 lần (lines 1906-1918):
```typescript
  const totalAttempts = Math.max(1, 2 + 1); // 1 lần đầu + 2 lần retry
  // ...
  while (attempt < totalAttempts) {
    // ...
    if (isRetryAttempt) {
      const cooldown = queueGapMs;
      console.log(`[CaptionTranslator] Retry cooldown ${cooldown}ms`); // ← log duy nhất
      await new Promise((resolve) => setTimeout(resolve, cooldown));
    }
    // → gọi lại translateBatch → provider.call → spawn → ENOENT lần nữa
  }
```

Không có `console.log` nào in ra error message từ provider trong vòng lặp này. Error chỉ được lưu vào `batchResult` và có thể được log ở nơi khác (CaptionHandlers), nhưng log đó không hiển thị error detail.

---

## Tóm tắt 3 nguyên nhân

| # | Nguyên nhân | File | Dòng |
|---|---|---|---|
| 1 | **Binary resolution mismatch**: `enabled.bin = 'opencode-cli'` nhưng trên Windows chỉ có `opencode.cmd`. Provider dùng raw `enabled.bin` không qua `resolveOnPath`/`fallbackBins`. | `cliAgentProvider.ts` | 33 |
| 2 | **Model fallthrough**: `model` param default là `GEMINI_MODELS.FLASH_3_0`, khi user không chọn model sẽ fall thành model ID Gemini. | `cliAgentProvider.ts` + `captionTranslator.ts` | 36-39, 738 |
| 3 | **Error bị swallow**: ENOENT được catch và trả về object, nhưng CaptionTranslator không log error string ra console trong vòng retry. | `cliAgentProvider.ts` + `captionTranslator.ts` | 48, 345-352, 1933-1938 |

## Fix

1. **Binary resolution**: dùng `resolveOnPath` + `fallbackBins` giống `detectSingleAgent`:
   ```typescript
   function resolveAgentBin(agent: CliAgentDef, customBin?: string): string | null {
     if (customBin?.trim()) {
       const p = customBin.trim();
       return existsSync(p) ? p : null;
     }
     const binsToTry = [agent.bin, ...(agent.fallbackBins || [])];
     for (const b of binsToTry) {
       const r = resolveOnPath(b);
       if (r) return r;
     }
     return null;
   }
   ```

2. **Model resolution**: không fallthrough đến `model` param (Gemini default):
   ```typescript
   const modelToUse = selection?.model || entry?.selectedModel || undefined;
   ```
   Chỉ dùng model từ selection hoặc per-agent config. Không dùng `model` param (vốn là Gemini model ID). `undefined` → không pass `--model`.

3. **Error logging**: log error message vào console trước khi retry để user thấy lý do.
