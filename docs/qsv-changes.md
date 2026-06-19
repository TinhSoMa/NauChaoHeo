# Thay đổi liên quan đến QSV (iGPU)

## 1. PixelFormat cho QSV khi có thumbnail

**File:** `src/main/services/caption/videoRenderer.ts:199`

```typescript
// Trước
pixelFormat: 'nv12',

// Sau
pixelFormat: context?.thumbnailEnabled ? 'yuv420p' : 'nv12',
```

**Lý do:** QSV encode cần `yuv420p` khi concat với thumbnail pipeline. Output từ concat là `yuv420p`, nếu QSV nhận `nv12` mà concat output là `yuv420p`, FFmpeg phải auto-convert → gây lỗi negotiation.

---

## 2. `setsar=1` cho concat video

**File:** `src/main/services/caption/videoRenderer.ts` — hàm `ensureVideoLabelForConcat`

```typescript
// Trước — concat trực tiếp
[thumb_label][main_label]concat=n=2:v=1:a=0

// Sau — normalize SAR trước concat
[thumb_label]scale=WxH,setsar=1,format=yuv420p[v_thumb_norm]
[main_label]scale=WxH,setsar=1,format=yuv420p[v_main_norm]
[v_thumb_norm][v_main_norm]concat=n=2:v=1:a=0
```

**Lý do:** Hai input concat có SAR khác nhau (`1:1` vs `1719:1720`) → FFmpeg reject concat. `setsar=1` chuẩn hóa cả 2 input về SAR `1:1`.

---

## 3. Crop + Thumbnail split support

**File:** `src/main/services/caption/hardsub/filterBuilder.ts`

Thêm `cropOutputLabel` + `split=2` sau crop filter khi thumbnail enabled và không có separate input:

```typescript
// Khi crop + thumbnail enabled
[crop_src]split=2[v_cropped][v_cropped_thumb]
// v_cropped → main pipeline
// v_cropped_thumb → thumbnail pipeline
```

**File:** `src/main/services/caption/hardsub/portraitFilterBuilder.ts`

Tương tự cho portrait mode:

```typescript
[portrait_crop_src]split=2[portrait_crop_src][portrait_crop_thumb]
```

**File:** `src/main/services/caption/hardsub/types.ts`

Thêm fields:
- `VideoFilterBuildOutput.cropOutputLabel?: string`
- `VideoFilterBuildInput.thumbnailEnabled?: boolean`
- `VideoFilterBuildInput.thumbnailHasSeparateInput?: boolean`
- `InlineThumbnailVideoFilterBuildInput.isSourceCropped?: boolean`

**Lý do:** Khi crop enabled, thumbnail cần scale từ crop rect thay vì source gốc. `split=2` tạo 2 nhánh từ crop output: 1 cho main pipeline, 1 cho thumbnail.
