import asyncio
import json
import os
import subprocess
import sys
from typing import Any, Dict, List

import aiohttp
import edge_tts
import re

try:
    from edge_tts.communicate import (
        connect_id,
        date_to_string,
        get_headers_and_data,
        mkssml,
        ssml_headers_plus_data,
    )
    from edge_tts.constants import SEC_MS_GEC_VERSION, WSS_HEADERS, WSS_URL
    from edge_tts.data_classes import TTSConfig
    from edge_tts.drm import DRM

    DIRECT_WAV_PRIMITIVES_OK = True
    DIRECT_WAV_PRIMITIVES_ERROR = ""
except Exception as exc:
    DIRECT_WAV_PRIMITIVES_OK = False
    DIRECT_WAV_PRIMITIVES_ERROR = str(exc)


DEFAULT_WAV_MODE = "auto"
DEFAULT_ITEM_CONCURRENCY = 4
MIN_ITEM_CONCURRENCY = 1
MAX_ITEM_CONCURRENCY = 32
DIRECT_WAV_FORMAT = "riff-24khz-16bit-mono-pcm"


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


def parse_wav_mode(value: Any) -> str:
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"auto", "direct", "convert"}:
            return lowered
    return DEFAULT_WAV_MODE


def normalize_item_concurrency(value: Any) -> int:
    try:
        num = int(value)
    except Exception:
        return DEFAULT_ITEM_CONCURRENCY
    if num < MIN_ITEM_CONCURRENCY:
        return MIN_ITEM_CONCURRENCY
    if num > MAX_ITEM_CONCURRENCY:
        return MAX_ITEM_CONCURRENCY
    return num


def should_try_direct_wav(output_format: str, wav_mode: str) -> bool:
    if output_format != "wav":
        return False
    return wav_mode in {"auto", "direct"}


def build_speech_config_request(output_format: str) -> str:
    return (
        f"X-Timestamp:{date_to_string()}\r\n"
        "Content-Type:application/json; charset=utf-8\r\n"
        "Path:speech.config\r\n\r\n"
        '{"context":{"synthesis":{"audio":{"metadataoptions":{'
        '"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"'
        "},"
        f'"outputFormat":"{output_format}"'
        "}}}}\r\n"
    )


async def synthesize_wav_bytes_direct(
    text: str,
    voice: str,
    rate: str,
    volume: str,
    proxy: str | None,
) -> bytes:
    if not DIRECT_WAV_PRIMITIVES_OK:
        raise RuntimeError(f"Direct WAV primitives unavailable: {DIRECT_WAV_PRIMITIVES_ERROR}")

    safe_text = sanitize_text(text)
    tts_config = TTSConfig(
        voice=voice,
        rate=rate,
        volume=volume,
        pitch="+0Hz",
        boundary="SentenceBoundary",
    )
    connection_id = connect_id()
    ws_url = (
        f"{WSS_URL}&ConnectionId={connection_id}"
        f"&Sec-MS-GEC={DRM.generate_sec_ms_gec()}"
        f"&Sec-MS-GEC-Version={SEC_MS_GEC_VERSION}"
    )
    timeout = aiohttp.ClientTimeout(total=None, connect=None, sock_connect=10, sock_read=60)
    audio_parts: List[bytes] = []

    async with aiohttp.ClientSession(trust_env=True, timeout=timeout) as session:
        async with session.ws_connect(
            ws_url,
            compress=15,
            proxy=proxy,
            headers=DRM.headers_with_muid(WSS_HEADERS),
        ) as websocket:
            await websocket.send_str(build_speech_config_request(DIRECT_WAV_FORMAT))
            await websocket.send_str(
                ssml_headers_plus_data(connect_id(), date_to_string(), mkssml(tts_config, safe_text))
            )

            async for received in websocket:
                if received.type == aiohttp.WSMsgType.TEXT:
                    encoded_data = received.data.encode("utf-8")
                    split = encoded_data.find(b"\r\n\r\n")
                    if split < 0:
                        continue
                    parameters, _ = get_headers_and_data(encoded_data, split)
                    path = parameters.get(b"Path")
                    if path == b"turn.end":
                        break
                    continue

                if received.type == aiohttp.WSMsgType.BINARY:
                    raw = received.data
                    if len(raw) < 2:
                        continue
                    header_length = int.from_bytes(raw[:2], "big")
                    if header_length > len(raw):
                        raise RuntimeError("Invalid Edge binary frame header length")
                    parameters, data = get_headers_and_data(raw, header_length)
                    if parameters.get(b"Path") != b"audio":
                        continue
                    if isinstance(data, (bytes, bytearray)) and len(data) > 0:
                        audio_parts.append(bytes(data))
                    continue

                if received.type == aiohttp.WSMsgType.ERROR:
                    detail = str(received.data) if received.data else "unknown websocket error"
                    raise RuntimeError(f"Edge websocket error: {detail}")

    merged = b"".join(audio_parts)
    if len(merged) == 0:
        raise RuntimeError("Direct WAV returned empty audio stream")
    return merged


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


async def process_item(item: Dict[str, Any], job: Dict[str, Any], wav_mode: str) -> Dict[str, Any]:
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
            direct_error: str | None = None
            if should_try_direct_wav(output_format, wav_mode):
                try:
                    wav_bytes = await synthesize_wav_bytes_direct(
                        safe_text,
                        voice=job.get("voice"),
                        rate=job.get("rate"),
                        volume=job.get("volume"),
                        proxy=proxy,
                    )
                    with open(output_path, "wb") as f:
                        f.write(wav_bytes)
                    if not looks_like_wav(output_path):
                        raise RuntimeError("Direct WAV output is not valid WAV data.")
                except Exception as exc:
                    direct_error = str(exc)
                    if wav_mode == "direct":
                        raise RuntimeError(f"Direct WAV failed: {direct_error}")

            if not os.path.exists(output_path) or os.path.getsize(output_path) <= 0:
                mp3_bytes = await synthesize_mp3_bytes(communicate)
                if len(mp3_bytes) == 0:
                    if direct_error:
                        raise RuntimeError(f"Audio stream is empty after direct WAV fallback: {direct_error}")
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


async def process_job(
    job: Dict[str, Any],
    timeout_ms: int | None,
    wav_mode: str,
    item_concurrency: int,
) -> List[Dict[str, Any]]:
    items = job.get("items", [])

    async def run_one(item: Dict[str, Any]) -> Dict[str, Any]:
        try:
            if timeout_ms:
                return await asyncio.wait_for(process_item(item, job, wav_mode), timeout_ms / 1000)
            return await process_item(item, job, wav_mode)
        except Exception as exc:
            message = str(exc)
            emit(
                {
                    "event": "progress",
                    "index": item.get("index"),
                    "filename": item.get("filename"),
                    "proxyId": job.get("proxyId"),
                    "success": False,
                    "error": message,
                }
            )
            return {
                "index": item.get("index"),
                "success": False,
                "error": message,
            }

    if item_concurrency <= 1 or len(items) <= 1:
        results: List[Dict[str, Any]] = []
        for item in items:
            results.append(await run_one(item))
        return results

    semaphore = asyncio.Semaphore(item_concurrency)

    async def run_guarded(item: Dict[str, Any]) -> Dict[str, Any]:
        async with semaphore:
            return await run_one(item)

    return await asyncio.gather(*[run_guarded(item) for item in items])


async def main() -> None:
    raw = read_stdin_utf8()
    payload = json.loads(raw) if raw.strip() else {}
    jobs = payload.get("jobs", [])
    timeout_ms = payload.get("timeoutMs")
    wav_mode = parse_wav_mode(payload.get("wavMode"))
    item_concurrency = normalize_item_concurrency(payload.get("itemConcurrency"))

    sys.stderr.write(
        f"[edge_tts_worker] jobs={len(jobs)} timeoutMs={timeout_ms} "
        f"wavMode={wav_mode} itemConcurrency={item_concurrency}\n"
    )
    sys.stderr.flush()

    tasks = []
    for job in jobs:
        tasks.append(process_job(job, timeout_ms, wav_mode, item_concurrency))

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
