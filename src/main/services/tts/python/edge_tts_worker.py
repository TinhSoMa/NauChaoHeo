import asyncio
import json
import os
import subprocess
import sys
from typing import Any, Dict, List

import edge_tts
import re


def emit(event: Dict[str, Any]) -> None:
    try:
        # Emit ASCII-safe JSON so Windows code pages never fail on Vietnamese chars.
        line = json.dumps(event, ensure_ascii=True)
    except Exception as exc:
        line = json.dumps(
            {
                "event": "worker_emit_error",
                "success": False,
                "error": f"emit serialization failed: {exc}",
            },
            ensure_ascii=True,
        )
    sys.stdout.buffer.write((line + "\n").encode("ascii"))
    sys.stdout.buffer.flush()


def sanitize_text(text: str) -> str:
    if not text:
        return ""
    # Remove lone surrogate code units to avoid UTF-8 encode errors.
    return re.sub(r"[\uD800-\uDFFF]", "", text)


def read_stdin_utf8() -> str:
    raw = sys.stdin.buffer.read()
    if not raw:
        return ""
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise RuntimeError(f"stdin is not valid UTF-8: {exc}") from exc


def looks_like_mp3(file_path: str) -> bool:
    try:
        with open(file_path, "rb") as f:
            head = f.read(3)
            if len(head) >= 3 and head == b"ID3":
                return True

        with open(file_path, "rb") as f:
            head2 = f.read(2)
            if len(head2) >= 2 and head2[0] == 0xFF and (head2[1] & 0xE0) == 0xE0:
                return True
    except Exception:
        return False
    return False


def looks_like_mp3_bytes(data: bytes) -> bool:
    if not data or len(data) < 2:
        return False
    if len(data) >= 3 and data[0:3] == b"ID3":
        return True
    return data[0] == 0xFF and (data[1] & 0xE0) == 0xE0


def looks_like_wav(file_path: str) -> bool:
    try:
        with open(file_path, "rb") as f:
            head = f.read(12)
            return len(head) >= 12 and head[0:4] == b"RIFF" and head[8:12] == b"WAVE"
    except Exception:
        return False


def convert_mp3_bytes_to_wav(mp3_bytes: bytes, output_wav: str) -> None:
    proc = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "mp3",
            "-i",
            "pipe:0",
            output_wav,
        ],
        input=mp3_bytes,
        capture_output=True,
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or b"ffmpeg failed").decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"Cannot convert mp3 bytes to wav: {detail}")


async def synthesize_mp3_bytes(communicate: edge_tts.Communicate) -> bytes:
    chunks: List[bytes] = []
    async for message in communicate.stream():
        if isinstance(message, dict) and message.get("type") == "audio":
            data = message.get("data")
            if isinstance(data, (bytes, bytearray)) and len(data) > 0:
                chunks.append(bytes(data))
    return b"".join(chunks)


async def process_item(item: Dict[str, Any], job: Dict[str, Any]) -> Dict[str, Any]:
    index = item.get("index")
    output_path = item.get("outputPath")
    proxy = job.get("proxyUrl")
    output_format = str(job.get("outputFormat") or "wav").lower()
    try:
        if output_format not in {"mp3", "wav"}:
            raise RuntimeError(f"Unsupported output format: {output_format}")
        if not output_path:
            raise RuntimeError("outputPath is required")

        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

        safe_text = sanitize_text(item.get("text", ""))
        communicate = edge_tts.Communicate(
            safe_text,
            voice=job.get("voice"),
            rate=job.get("rate"),
            volume=job.get("volume"),
            proxy=proxy,
        )
        if output_format == "mp3":
            await communicate.save(output_path)
            ok = os.path.exists(output_path) and os.path.getsize(output_path) > 0
            if not ok:
                raise RuntimeError("Audio file empty or not created.")
            if not looks_like_mp3(output_path):
                raise RuntimeError("Generated audio is not valid MP3 data.")
        else:
            mp3_bytes = await synthesize_mp3_bytes(communicate)
            if len(mp3_bytes) == 0:
                raise RuntimeError("Audio stream is empty.")
            if not looks_like_mp3_bytes(mp3_bytes):
                raise RuntimeError("Generated stream is not valid MP3 data.")
            convert_mp3_bytes_to_wav(mp3_bytes, output_path)
            if not os.path.exists(output_path) or os.path.getsize(output_path) <= 0:
                raise RuntimeError("Converted WAV file empty or not created.")
            if not looks_like_wav(output_path):
                raise RuntimeError("Converted audio is not valid WAV data.")
        emit({
            "event": "progress",
            "index": index,
            "filename": item.get("filename"),
            "proxyId": job.get("proxyId"),
            "success": True,
        })
        return {"index": index, "success": True}
    except Exception as exc:
        message = str(exc)
        emit({
            "event": "progress",
            "index": index,
            "filename": item.get("filename"),
            "proxyId": job.get("proxyId"),
            "success": False,
            "error": message,
        })
        return {"index": index, "success": False, "error": message}


async def process_job(job: Dict[str, Any], timeout_ms: int | None) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    for item in job.get("items", []):
        if timeout_ms:
            result = await asyncio.wait_for(process_item(item, job), timeout_ms / 1000)
        else:
            result = await process_item(item, job)
        results.append(result)
    return results


async def main() -> None:
    raw = read_stdin_utf8()
    payload = json.loads(raw) if raw.strip() else {}
    jobs = payload.get("jobs", [])
    timeout_ms = payload.get("timeoutMs")

    sys.stderr.write(f"[edge_tts_worker] jobs={len(jobs)} timeoutMs={timeout_ms}\n")
    sys.stderr.flush()

    tasks = []
    for job in jobs:
        tasks.append(process_job(job, timeout_ms))

    results: List[Dict[str, Any]] = []
    completed = await asyncio.gather(*tasks, return_exceptions=True)
    for idx, job_result in enumerate(completed):
        if isinstance(job_result, Exception):
            err = str(job_result)
            for item in jobs[idx].get("items", []):
                results.append({"index": item.get("index"), "success": False, "error": err})
            continue
        results.extend(job_result)

    emit({"event": "done", "results": results})


if __name__ == "__main__":
    asyncio.run(main())
