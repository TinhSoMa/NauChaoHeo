import json
import os
import sqlite3
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List

SPACY_MODEL_NAME = "xx_ent_wiki_sm"


def safe_json(data: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(data, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def safe_err(message: str) -> None:
    sys.stderr.write(message + "\n")
    sys.stderr.flush()


class MemoryStore:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                namespace TEXT NOT NULL,
                project_id TEXT NOT NULL,
                feature TEXT NOT NULL,
                chapter_id TEXT,
                chapter_index INTEGER,
                chapter_title TEXT,
                source_text TEXT NOT NULL,
                translated_text TEXT NOT NULL,
                memory_text TEXT NOT NULL,
                entities_json TEXT NOT NULL,
                metadata_json TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
            """
        )
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_memories_namespace_chapter ON memories(namespace, chapter_index, created_at)"
        )
        self.conn.commit()

    def add_memory(self, payload: Dict[str, Any], entities: List[str], memory_text: str) -> int:
        metadata = payload.get("metadata") or {}
        self.conn.execute(
            """
            INSERT INTO memories (
                namespace, project_id, feature, chapter_id, chapter_index, chapter_title,
                source_text, translated_text, memory_text, entities_json, metadata_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(payload.get("namespace") or "").strip(),
                str(payload.get("projectId") or "").strip(),
                str(payload.get("feature") or "").strip(),
                str(metadata.get("chapterId") or ""),
                int(metadata.get("chapterIndex")) if metadata.get("chapterIndex") is not None else None,
                str(metadata.get("chapterTitle") or ""),
                str(payload.get("sourceText") or ""),
                str(payload.get("translatedText") or ""),
                memory_text,
                json.dumps(entities, ensure_ascii=False),
                json.dumps(metadata, ensure_ascii=False),
                int(time.time() * 1000),
            ),
        )
        self.conn.commit()
        return 1

    def clear_namespace(self, namespace: str) -> int:
        cur = self.conn.execute("DELETE FROM memories WHERE namespace = ?", (namespace,))
        self.conn.commit()
        return int(cur.rowcount or 0)

    def get_stats(self, namespace: str) -> Dict[str, Any]:
        total_memories = self.conn.execute(
            "SELECT COUNT(*) AS count FROM memories WHERE namespace = ?", (namespace,)
        ).fetchone()["count"]
        total_namespaces = self.conn.execute(
            "SELECT COUNT(DISTINCT namespace) AS count FROM memories"
        ).fetchone()["count"]
        rows = self.conn.execute(
            "SELECT entities_json FROM memories WHERE namespace = ? ORDER BY created_at DESC LIMIT 20",
            (namespace,),
        ).fetchall()
        recent_entities: List[str] = []
        for row in rows:
            try:
                for entity in json.loads(row["entities_json"] or "[]"):
                    if entity not in recent_entities:
                        recent_entities.append(entity)
            except Exception:
                continue
        return {
            "namespace": namespace,
            "totalMemories": int(total_memories or 0),
            "totalNamespaces": int(total_namespaces or 0),
            "recentEntities": recent_entities[:20],
        }

    def get_candidates(self, namespace: str, max_chapter_index: int | None) -> List[sqlite3.Row]:
        if max_chapter_index is None:
            return self.conn.execute(
                "SELECT * FROM memories WHERE namespace = ? ORDER BY chapter_index DESC, created_at DESC LIMIT 500",
                (namespace,),
            ).fetchall()
        return self.conn.execute(
            """
            SELECT * FROM memories
            WHERE namespace = ?
              AND (chapter_index IS NULL OR chapter_index < ?)
            ORDER BY chapter_index DESC, created_at DESC
            LIMIT 500
            """,
            (namespace, max_chapter_index),
        ).fetchall()


class WorkerRuntime:
    def __init__(self) -> None:
        self.mem0_ok = False
        self.spacy_ok = False
        self.spacy_model_ok = False
        self.provider_configured = False
        self.backend = "unavailable"
        self.python_version = sys.version.split()[0]
        self.nlp = None
        self.loaded_spacy_model = None
        self.store = MemoryStore(os.environ.get("MEMORY_CONTEXT_STORE_PATH", "memory_context.sqlite3"))
        self._init_modules()

    def _init_modules(self) -> None:
        try:
            import mem0  # type: ignore  # noqa: F401

            self.mem0_ok = True
        except Exception:
            self.mem0_ok = False

        try:
            import spacy  # type: ignore

            self.spacy_ok = True
            try:
                self.nlp = spacy.load(SPACY_MODEL_NAME)
                self.spacy_model_ok = True
                self.loaded_spacy_model = getattr(self.nlp, "meta", {}).get("name") or SPACY_MODEL_NAME
            except Exception:
                self.spacy_model_ok = False
                self.nlp = None
                self.loaded_spacy_model = None
        except Exception:
            self.spacy_ok = False
            self.spacy_model_ok = False
            self.nlp = None
            self.loaded_spacy_model = None

        self.provider_configured = bool(
            os.environ.get("MEM0_API_KEY")
            or os.environ.get("OPENAI_API_KEY")
            or os.environ.get("GOOGLE_API_KEY")
            or os.environ.get("MEMORY_CONTEXT_PROVIDER")
        )

        if self.mem0_ok and self.spacy_ok and self.spacy_model_ok:
            self.backend = "local_fallback"
        else:
            self.backend = "unavailable"

    def health(self) -> Dict[str, Any]:
        warning = None
        if not self.mem0_ok or not self.spacy_ok or not self.spacy_model_ok:
            warning = (
                "Thiếu dependency Python cho memory context. Cài: "
                "pip install mem0ai[nlp] && python -m spacy download xx_ent_wiki_sm"
            )
        elif not self.provider_configured:
            warning = "Provider Mem0 chưa cấu hình. V1 đang dùng backend local fallback cho search/add."
        return {
            "pythonOk": True,
            "mem0Ok": self.mem0_ok,
            "spacyOk": self.spacy_ok,
            "spacyModelOk": self.spacy_model_ok,
            "providerConfigured": self.provider_configured,
            "backend": self.backend,
            "warning": warning,
            "details": {
                "pythonVersion": self.python_version,
                "storePath": self.store.db_path,
                "spacyModelName": SPACY_MODEL_NAME,
                "spacyLoadedModel": self.loaded_spacy_model,
                "modules": {"mem0": self.mem0_ok, "spacy": self.spacy_ok, SPACY_MODEL_NAME: self.spacy_model_ok},
                "providerConfigured": self.provider_configured,
                "backend": self.backend,
            },
        }

    def extract_entities(self, text: str) -> List[str]:
        cleaned = (text or "").strip()
        if not cleaned:
            return []
        entities: List[str] = []
        if self.nlp is not None:
            try:
                doc = self.nlp(cleaned[:5000])
                for ent in doc.ents:
                    value = ent.text.strip()
                    if len(value) >= 2 and value not in entities:
                        entities.append(value)
            except Exception as exc:
                safe_err(f"[mem0_context_worker] entity extraction failed: {exc}")
        if entities:
            return entities[:24]
        tokens = []
        for token in cleaned.replace("\n", " ").split():
            normalized = token.strip(".,!?;:\"'()[]{}")
            if len(normalized) >= 3 and normalized[0].isupper():
                tokens.append(normalized)
        deduped: List[str] = []
        for token in tokens:
            if token not in deduped:
                deduped.append(token)
        return deduped[:24]

    def build_memory_text(self, payload: Dict[str, Any], entities: List[str]) -> str:
        metadata = payload.get("metadata") or {}
        chapter_title = str(metadata.get("chapterTitle") or "").strip()
        chapter_label = ""
        chapter_index = metadata.get("chapterIndex")
        if chapter_index is not None:
            chapter_label = f"Chapter {chapter_index}"
        if chapter_title:
            chapter_label = f"{chapter_label}: {chapter_title}" if chapter_label else chapter_title
        glossary = ", ".join(entities[:8])
        translated = " ".join(str(payload.get("translatedText") or "").split())
        if len(translated) > 500:
            translated = translated[:500].rstrip() + "..."
        parts = []
        if chapter_label:
            parts.append(f"[{chapter_label}]")
        if glossary:
            parts.append(f"Entities: {glossary}")
        if translated:
            parts.append(f"Translation: {translated}")
        return "\n".join(parts)

    def score_candidate(self, query_text: str, query_entities: List[str], row: sqlite3.Row, current_chapter_index: int | None) -> float:
        haystack = f"{row['memory_text']} {row['source_text']} {row['translated_text']}".lower()
        query_tokens = [token for token in query_text.lower().split() if len(token) >= 2]
        overlap = Counter(query_tokens)
        lexical_score = 0.0
        for token, count in overlap.items():
            if token in haystack:
                lexical_score += 1.0 + (0.15 * min(count, 3))
        row_entities = []
        try:
            row_entities = json.loads(row["entities_json"] or "[]")
        except Exception:
            row_entities = []
        entity_score = 0.0
        row_entities_lower = {str(entity).lower() for entity in row_entities}
        for entity in query_entities:
            if entity.lower() in row_entities_lower:
                entity_score += 4.0
            elif entity.lower() in haystack:
                entity_score += 2.0
        recency_score = 0.0
        row_index = row["chapter_index"]
        if current_chapter_index is not None and isinstance(row_index, int):
            distance = max(1, current_chapter_index - row_index)
            recency_score = min(2.5, 12.0 / distance)
        return lexical_score + entity_score + recency_score

    def search_context(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        health = self.health()
        if self.backend == "unavailable":
            return {
                "memories": [],
                "promptContext": "",
                "debug": [],
                "namespace": str(payload.get("namespace") or ""),
                "warning": health.get("warning"),
            }

        metadata = payload.get("metadata") or {}
        current_chapter_index = metadata.get("chapterIndex")
        if current_chapter_index is not None:
            current_chapter_index = int(current_chapter_index)
        namespace = str(payload.get("namespace") or "").strip()
        query_text = str(payload.get("queryText") or "")
        query_entities = self.extract_entities(query_text)
        top_k = max(1, min(20, int(payload.get("topK") or 5)))
        candidates = self.store.get_candidates(namespace, current_chapter_index)
        scored_items = []
        for row in candidates:
            score = self.score_candidate(query_text, query_entities, row, current_chapter_index)
            if score <= 0:
                continue
            try:
                entities = json.loads(row["entities_json"] or "[]")
            except Exception:
                entities = []
            scored_items.append(
                {
                    "memory": row["memory_text"],
                    "score": round(score, 3),
                    "entities": entities[:8],
                    "chapterId": row["chapter_id"],
                    "chapterIndex": row["chapter_index"],
                }
            )
        scored_items.sort(key=lambda item: (-float(item["score"]), int(item.get("chapterIndex") or 0) * -1))
        top_items = scored_items[:top_k]
        prompt_lines = [
            "Translation Memory Context:",
        ]
        for index, item in enumerate(top_items, start=1):
            prompt_lines.append(f"{index}. {item['memory']}")
        prompt_context = "\n".join(prompt_lines) if top_items else ""
        return {
            "memories": [item["memory"] for item in top_items],
            "promptContext": prompt_context,
            "debug": top_items,
            "namespace": namespace,
            "warning": health.get("warning"),
        }

    def add_translation_memory(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        health = self.health()
        if self.backend == "unavailable":
            return {
                "storedCount": 0,
                "entities": [],
                "namespace": str(payload.get("namespace") or ""),
                "warning": health.get("warning"),
            }
        combined_text = f"{payload.get('sourceText') or ''}\n{payload.get('translatedText') or ''}"
        entities = self.extract_entities(combined_text)
        memory_text = self.build_memory_text(payload, entities)
        stored_count = self.store.add_memory(payload, entities, memory_text)
        return {
            "storedCount": stored_count,
            "entities": entities,
            "namespace": str(payload.get("namespace") or ""),
            "warning": health.get("warning"),
        }


def main() -> None:
    runtime = WorkerRuntime()
    for raw_line in sys.stdin:
        envelope: Dict[str, Any] | None = None
        line = raw_line.strip()
        if not line:
            continue
        try:
            envelope = json.loads(line)
            request_id = envelope.get("requestId")
            command = envelope.get("command")
            payload = envelope.get("payload") or {}
            if command == "shutdown":
                safe_json({"requestId": request_id, "success": True, "data": {"ok": True}})
                break
            if command == "health":
                safe_json({"requestId": request_id, "success": True, "data": runtime.health()})
                continue
            if command == "search_context":
                safe_json({"requestId": request_id, "success": True, "data": runtime.search_context(payload)})
                continue
            if command == "add_translation_memory":
                safe_json({"requestId": request_id, "success": True, "data": runtime.add_translation_memory(payload)})
                continue
            if command == "clear_namespace":
                namespace = str(payload.get("namespace") or "")
                cleared_count = runtime.store.clear_namespace(namespace)
                safe_json(
                    {
                        "requestId": request_id,
                        "success": True,
                        "data": {"namespace": namespace, "clearedCount": cleared_count},
                    }
                )
                continue
            if command == "stats":
                namespace = str(payload.get("namespace") or "")
                safe_json({"requestId": request_id, "success": True, "data": runtime.store.get_stats(namespace)})
                continue
            safe_json({"requestId": request_id, "success": False, "error": f"Unsupported command: {command}"})
        except Exception as exc:
            safe_json(
                {
                    "requestId": envelope.get("requestId") if isinstance(envelope, dict) else None,
                    "success": False,
                    "error": str(exc),
                }
            )


if __name__ == "__main__":
    main()
