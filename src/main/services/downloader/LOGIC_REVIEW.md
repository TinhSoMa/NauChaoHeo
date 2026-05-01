# Downloader Logic Review (UI -> IPC -> Service)

## Single Source of Truth
- `resolveDownloadIntent` (`src/shared/downloader/resolvedDownloadIntent.ts`) is the normalized resolver for:
  - `downloadVideo=false` => clear format/audio/merge/separate.
  - `mergeAudio=true` => force `downloadSeparateAudio=false`.
  - `downloadSubtitle=false` => no `subtitleLangs` and no `convertSubs`.
  - `allowPlaylist=true` + explicit selection => validate indexes and fail early if empty.

## High-Risk Mismatches Fixed
- P0/P1: Manual subtitle language selection was overridden by `all` because language toggling set `downloadAllSubs=true`.
  - Fixed by switching to `setDownloadAllSubs(false)` in manual toggle flow.
- P1: UI and service had divergent handling for selected video-only format + merge audio.
  - Fixed by making `buildArgs` add non-playlist fallback (`format+bestaudio/.../format`) directly.
- P1: Duplicate option resolution in single/multi could drift.
  - Fixed by routing both through `resolveDownloadIntent`.

## Truth Table Coverage (Focused)
- Dimensions covered in automated tests:
  - `downloadVideo` precedence
  - `mergeAudio` vs `downloadSeparateAudio`
  - `downloadSubtitle` + `downloadAllSubs` + `selectedSubLangs`
  - `allowPlaylist` + explicit `selectedPlaylistIndexes`
  - `buildArgs` with merge fallback and playlist item normalization

## Acceptance Checks
- Each resolver case has deterministic `DownloadOptions` output.
- `buildArgs` keeps fallback safety for explicit format under merge.
- Playlist index selection rejects empty explicit selection with clear error.
