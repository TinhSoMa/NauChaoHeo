# Phân tích lỗi FFmpeg Concat + PixFmt trong Video Rendering Pipeline

## 1. Lỗi #1 — Pixel Format Mismatch (Concat Input)

### Error
```
[Parsed_concat_31 @ ...] Failed to configure output pad on Parsed_concat_31
[aost#0:1/aac @ ...] Task finished with error code: -22 (Invalid argument)
```

### Root Cause
Thumbnail inline concat nhận 2 input video với **pixel format khác nhau**:
- Thumbnail: `yuv420p` (từ `format=yuv420p` trong thumbnail pipeline)
- Main video: `nv12` (từ HW decoder `-hwaccel auto`)

FFmpeg concat filter yêu cầu tất cả input stream (cùng loại) phải có **cùng parameters**: width, height, pixel format. Khi không match → `Failed to configure output pad`.

### Fix
**File:** `videoRenderer.ts` — Thêm hàm `ensureVideoLabelForConcat()`

```typescript
// Trước: post-concat format normalization
[thumb][main]concat=n=2:v=1:a=0[raw]
[raw]format=yuv420p,setsar=1[out]

// Sau: pre-concat normalization trên từng input
[thumb]format=yuv420p[v_thumb_norm]
[main]format=yuv420p[v_main_norm]
[v_thumb_norm][v_main_norm]concat=n=2:v=1:a=0[raw]
[raw]setsar=1[out]
```

Loại bỏ `format=yuv420p` khỏi post-concat (chỉ giữ `setsar=1`), chuyển thành normalize mỗi input trước concat.

---

## 2. Lỗi #2 — Split Output Orphaned (Filter Graph Topology)

### Error
```
Error binding filtergraph inputs/outputs: Invalid argument
```

### Root Cause
Khi `crop` active + `thumbnailEnabled`, filter builder thêm `split=2` sau crop để tạo `[v_cropped_thumb]` cho thumbnail. Nhưng output thứ 2 của `split` không được kết nối khi:
- **Thumbnail disabled** (`thumbnailEnabled=false`) — không ai dùng `[v_cropped_thumb]`
- **Thumbnail dùng seek input riêng** (`thumbnailInputSeeked=true`) — thumbnail dùng crop riêng trên seek input, bỏ qua `[v_cropped_thumb]`
- **Preview path** — không có concat, không ai consume `[v_cropped_thumb]`

→ FFmpeg báo lỗi vì `split` output pad không được kết nối.

### Fix (2 phases)

**Phase 1:** Thêm `thumbnailEnabled` guard
- **Files:** `types.ts`, `filterBuilder.ts`, `portraitFilterBuilder.ts`
- Chỉ thêm `split=2` khi `thumbnailEnabled = true`

**Phase 2:** Thêm `thumbnailHasSeparateInput` guard
- **Files:** `types.ts`, `filterBuilder.ts`, `portraitFilterBuilder.ts`, `videoRenderer.ts`
- Chỉ thêm `split=2` khi `thumbnailEnabled = true` **VÀ** `thumbnailHasSeparateInput = false`
- `thumbnailHasSeparateInput = options.thumbnailTimeSec != null` (cùng logic với `thumbnailInputSeeked`)

### Điều kiện split=2 được thêm
| thumbnailEnabled | thumbnailHasSeparateInput | crop | split=2 |
|---|---|---|---|
| false | — | — | No |
| true | false | true | **Yes** → `[v_cropped_thumb]` dùng trong thumbnail pipeline |
| true | true | true | No → thumbnail dùng crop riêng trên seek input |
| true | false | false | No → không cần split |

---

## 3. Lỗi #3 — Concat Output Pad Fail (sau khi đã fix format)

### Error
```
[Parsed_concat_33/35 @ ...] Failed to configure output pad on Parsed_concat_33/35
[vost#0:0/h264_qsv @ ...] Terminating thread with return code -22 (Invalid argument)
[aost#0:1/aac @ ...] Terminating thread with return code -22
```

### Khác biệt với lỗi #1
- Lỗi #1 chỉ `aost#0:1/aac` (audio encoder fail secondary)
- Lỗi #3 có thêm `vost#0:0/h264_qsv` (video encoder **QSV** fail)
- Index concat thay đổi (31 → 33/35) do filter graph khác

### Nguyên nhân tiềm năng

#### a. Pixel Format không tương thích với QSV encode
Khi `thumbnailEnabled = true`:
- `isHeavyFilterPipelineForQsvDecode()` return `true` → **tắt** QSV decode (software decode)
- **QSV encode vẫn bật** với `pixelFormat: 'nv12'`
- Filter graph output: `yuv420p` (từ `format=yuv420p` trong `ensureVideoLabelForConcat`)
- `-pix_fmt nv12` yêu cầu encoder nhận `nv12`
- FFmpeg auto-insert `format` filter để convert `yuv420p` → `nv12`
- **Có thể auto-insertion thất bại với QSV path**, gây `vost#0:0/h264_qsv Terminating thread`

#### b. Dimension mismatch (ngay cả sau `scale`)
Dù đã thêm `scale` trong `ensureVideoLabelForConcat`, vẫn có thể xảy ra nếu:
- `outputWidth`/`outputHeight` khác giữa 2 call sites
- `ensureEven` rounding không đồng nhất

### Fix hiện tại
**File:** `videoRenderer.ts` — `ensureVideoLabelForConcat` giờ thêm `scale` + `format`:
```typescript
// Trước
`${ref}format=yuv420p[${outputLabelName}]`

// Sau
`${ref}scale=${width}:${height},format=yuv420p[${outputLabelName}]`
```

### Chưa xác định
Lỗi #3 vẫn xuất hiện với `h264_qsv` ngay cả sau khi thêm `scale`. Cần debug thêm:
1. Log full `-filter_complex` string trước khi chạy FFmpeg
2. Test với `hardwareAcceleration` tắt để so sánh (software encode `libx264`)
3. Kiểm tra xem QSV encoder có yêu cầu `hwupload` trước khi encode không
4. Thử thêm `format=nv12` hoặc `hwupload,format=nv12` vào cuối filter graph

---

## Tổng quan các file đã sửa

| File | Lỗi #1 | Lỗi #2 (P1) | Lỗi #2 (P2) | Lỗi #3 |
|---|---|---|---|---|
| `types.ts` | — | `thumbnailEnabled?` | `thumbnailHasSeparateInput?` | — |
| `filterBuilder.ts` | — | Guard `split=2` | Guard `!thumbnailHasSeparateInput` | — |
| `portraitFilterBuilder.ts` | — | Guard `split=2` | Guard `!thumbnailHasSeparateInput` | — |
| `videoRenderer.ts` | `ensureVideoLabelForConcat` | Pass `thumbnailEnabled` | Compute + pass `thumbnailHasSeparateInput` | Thêm `scale` vào `ensureVideoLabelForConcat` |

## Luồng dữ liệu filter graph (Landscape + crop + thumbnail)

```
[0:v] ── crop ──▶ [v_cropped] ── split ──▶ [v_cropped] ── scale ── ... ──▶ [v_out]
                    (nếu                                          format=yuv420p ──▶ [v_main_norm]
                     thumbnail
                     enabled
                     && no seek)          ──▶ [v_cropped_thumb] ── trim/freeze ── scale=outW:outH
                                            format=yuv420p ──▶ [v_thumb_norm]

[v_thumb_norm][v_main_norm] ── concat=n=2:v=1:a=0 ──▶ [v_out_inline_raw]
                                                         setsar=1 ──▶ [v_out_inline]

Audio:  [a_main] ── aformat=stereo,aresample=44100 ──▶ [a_main_concat]
          adelay=... ──▶ [a_out_inline]
```

## QSV Decode Decision Logic

```
isHeavyFilterPipelineForQsvDecode():
  renderMode === 'hardsub_portrait_9_16'
  || coverMode === 'copy_from_above'
  || hasLogo
  || thumbnailEnabled           ← TRUE khi thumbnail bật

→ heavyPipeline = true
→ enableQsvDecode = forceQsvDecode || !heavyPipeline
                   = forceQsvDecode || false
                   = false (trừ khi env CAPTION_QSV_DECODE=1)
→ QSV decode: OFF (software decode)
→ QSV encode: ON (h264_qsv, pixelFormat: nv12)
```
