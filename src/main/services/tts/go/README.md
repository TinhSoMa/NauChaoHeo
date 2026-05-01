# Edge TTS Go Worker (Scaffold)

This folder is the Phase 1 scaffold for replacing the Python Edge worker.

Current status:
- `main.go` implements stdin/stdout JSON-line protocol compatibility only.
- Synthesis logic is intentionally not implemented yet.
- The app still runs Python worker as fallback unless a built `edge_tts_worker.exe` is present.

Planned next steps:
1. Implement mp3/wav synthesis paths.
2. Implement timeout, proxy, and concurrency parity.
3. Add benchmark and A/B rollout.
