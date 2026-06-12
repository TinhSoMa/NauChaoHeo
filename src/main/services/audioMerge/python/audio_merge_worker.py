import json
import gc
import numpy as np
import subprocess
import sys
import os
import struct


def emit(event: dict) -> None:
    try:
        line = json.dumps(event, ensure_ascii=True)
    except Exception as exc:
        line = json.dumps({
            "event": "worker_emit_error",
            "success": False,
            "error": f"emit serialization failed: {exc}",
        }, ensure_ascii=True)
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def decode_to_pcm(path: str, ffmpeg_path: str, sample_rate: int, channels: int) -> bytes:
    cmd = [
        ffmpeg_path, "-y",
        "-i", path,
        "-f", "s16le",
        "-ar", str(sample_rate),
        "-ac", str(channels),
        "pipe:1",
    ]
    startupinfo = None
    if sys.platform == "win32":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            startupinfo=startupinfo,
        )
        stdout, stderr = proc.communicate()
        if proc.returncode != 0:
            error_msg = stderr.decode("utf-8", errors="replace")[:200]
            raise RuntimeError(
                f"ffmpeg decode failed (exit={proc.returncode}): {error_msg}"
            )
        return stdout
    except FileNotFoundError:
        raise RuntimeError(f"ffmpeg not found at: {ffmpeg_path}")


def encode_pcm(
    pcm_bytes: bytes,
    output_path: str,
    ffmpeg_path: str,
    codec_args: list[str],
    sample_rate: int,
    channels: int,
) -> None:
    cmd = [
        ffmpeg_path, "-y",
        "-f", "s16le",
        "-ar", str(sample_rate),
        "-ac", str(channels),
        "-i", "pipe:0",
    ] + codec_args + [output_path]
    startupinfo = None
    if sys.platform == "win32":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    try:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            startupinfo=startupinfo,
        )
        stdout, stderr = proc.communicate(input=pcm_bytes)
        if proc.returncode != 0:
            error_msg = stderr.decode("utf-8", errors="replace")[:200]
            raise RuntimeError(
                f"ffmpeg encode failed (exit={proc.returncode}): {error_msg}"
            )
    except FileNotFoundError:
        raise RuntimeError(f"ffmpeg not found at: {ffmpeg_path}")


def main() -> None:
    try:
        raw = sys.stdin.buffer.read().decode("utf-8").strip()
        payload = json.loads(raw)
    except Exception as e:
        emit({"event": "error", "message": f"Cannot parse stdin JSON: {e}"})
        sys.exit(1)

    files = payload.get("files", [])
    output_path = payload.get("outputPath", "")
    sample_rate = int(payload.get("sampleRate", 24000))
    channels = int(payload.get("channels", 1))
    codec_args = payload.get("codecArgs", ["-c:a", "pcm_s16le"])
    total_duration_ms = int(payload.get("totalDurationMs", 0))
    ffmpeg_path = payload.get("ffmpegPath", "ffmpeg")

    if not files:
        emit({"event": "error", "message": "No files provided"})
        sys.exit(1)

    if not output_path:
        emit({"event": "error", "message": "No outputPath provided"})
        sys.exit(1)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    total_samples = max(1, int(total_duration_ms * sample_rate / 1000))
    emit({
        "event": "start",
        "total": len(files),
        "totalDurationMs": total_duration_ms,
        "totalSamples": total_samples,
        "sampleRate": sample_rate,
        "channels": channels,
    })

    canvas = np.zeros(total_samples, dtype=np.float32)
    decoded_count = 0

    for i, f in enumerate(files):
        path = f.get("path", "")
        start_ms = int(f.get("startMs", 0))

        if not path or not os.path.exists(path):
            emit({
                "event": "progress",
                "current": i + 1,
                "total": len(files),
                "warning": f"File not found: {path}",
            })
            continue

        try:
            pcm = decode_to_pcm(path, ffmpeg_path, sample_rate, channels)
        except Exception as e:
            emit({
                "event": "progress",
                "current": i + 1,
                "total": len(files),
                "error": str(e),
                "file": path,
            })
            continue

        if len(pcm) == 0:
            emit({
                "event": "progress",
                "current": i + 1,
                "total": len(files),
                "warning": f"Empty audio: {path}",
            })
            continue

        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        offset = int(start_ms * sample_rate / 1000)
        end = min(offset + len(audio), total_samples)
        usable = end - offset
        if usable > 0:
            canvas[offset:end] += audio[:usable]

        decoded_count += 1
        emit({"event": "progress", "current": i + 1, "total": len(files)})

        if i > 0 and i % 100 == 0:
            gc.collect()

    if decoded_count == 0:
        emit({"event": "error", "message": "No audio files were successfully decoded"})
        del canvas
        gc.collect()
        sys.exit(1)

    canvas = np.clip(canvas, -1.0, 1.0)
    pcm_out = (canvas * 32767.0).astype(np.int16).tobytes()

    emit({
        "event": "encoding",
        "outputPath": output_path,
    })

    try:
        encode_pcm(pcm_out, output_path, ffmpeg_path, codec_args, sample_rate, channels)
    except Exception as e:
        emit({"event": "error", "message": f"Encode failed: {e}"})
        del canvas, pcm_out
        gc.collect()
        sys.exit(1)

    del canvas, pcm_out
    gc.collect()

    emit({"event": "done", "outputPath": output_path})


if __name__ == "__main__":
    main()
