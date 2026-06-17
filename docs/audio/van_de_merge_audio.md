# Phân tích vấn đề Audio Merge Step 6 — Final

## 1. Vấn đề cốt lõi

**FFmpeg `amix` không được thiết kế để mix >30–50 streams cùng lúc.**

Khi `amix=inputs=150`, FFmpeg phải:
1. Mở 150 file handles đồng thời
2. Decode 150 audio streams vào RAM cùng lúc
3. Mix sample-by-sample trên 150 buffers

→ RAM tràn → swap disk → CPU 100% → treo.

**Cách Python numpy xử lý khác hẳn:** decode từng file 1 → cộng vào 1 canvas duy nhất → giải phóng ngay. RAM không tăng theo số file.

## 2. Giải pháp Hybrid

| Giai đoạn | Công nghệ | Lý do |
|---|---|---|
| Batch merge (300 file/batch) | Python numpy worker | Decode tuần tự, 1 canvas, RAM ổn định |
| Final concat (≤21 batch output) | FFmpeg `adelay`+`amix` | Chỉ 21 inputs, `amix` chạy ổn |

## 3. Các thay đổi đã thực hiện

### Files restore từ git (commit `9fd8261`)

| File | Vai trò |
|---|---|
| `src/main/services/audioMerge/python/audio_merge_worker.py` | Python worker: decode → numpy canvas → encode |
| `src/main/services/audioMerge/pythonBridge.ts` | TS bridge: spawn Python subprocess, JSON protocol |
| `src/main/services/audioMerge/index.ts` | Re-export |

### `src/main/services/tts/audioMerger.ts` — 6 thay đổi

| # | Vị trí | Thay đổi |
|---|---|---|
| 1 | Line 20 | Thêm `import { runAudioMergeWorker }` |
| 2 | Line 24-28 | `computeBatchSize`: 300/250/200 (tăng so với 200/150/100 cũ) |
| 3 | Line 30 | `BATCH_CONCURRENCY = 1` (giảm từ 3) |
| 4 | Line 465-510 | `mergeSmallBatch` gọi Python worker, `totalDurationMs` dùng `getAudioDuration` thực tế |
| 5 | Line 826-878 | Vòng lặp `for...of` tuần tự thay `Promise.all`, thêm log overlap boundaries |
| 6 | Line 935-946 | Cleanup temp files trước success/failure branch (chạy cho cả 2) |

### `electron-builder.yml`

Thêm extra resources entry:
```yaml
  - from: src/main/services/audioMerge/python
    to: audioMerge/python
    filter:
      - "audio_merge_worker.py"
```

## 4. Flow xử lý sau fix

```
3.112 file audio gốc
        │
        ▼
Chia ~13 batch (300 file/batch mỗi batch)
        │
        ├── Batch 1 → Python numpy → temp_000.wav
        ├── Batch 2 → Python numpy → temp_001.wav
        │   ... (tuần tự, for...of)
        └── Batch 13 → Python numpy → temp_012.wav
        │
        ▼
FFmpeg adelay+amix (13 inputs) → merged_audio_final.wav
        │
        ▼
Cleanup temp files (xóa temp_*.wav)
        │
        ▼
padTailToTargetDuration
        │
        ▼
Done
```

## 5. Lưu ý

- **Timestamp:** Mỗi batch output là canvas từ `0 → totalDurationMs` (tính từ `baseStartMs=0`). `batchStartMs` = `batch[0].startMs` tuyệt đối. FFmpeg `adelay` = `batchStartMs` → đúng vị trí trên timeline.
- **Overlap:** Log boundaries giữa các batch để phát hiện overlap. Lý thuyết timeline không overlap vì caption tuần tự.
- **Cleanup:** Temp files được xoá sau final concat cho cả success và failure.
