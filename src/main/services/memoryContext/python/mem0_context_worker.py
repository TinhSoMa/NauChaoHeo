import json
import os
import sqlite3
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List

SPACY_MODEL_NAME = "xx_ent_wiki_sm"
MAX_NOUN_RESULTS = 20
NOUN_BLACKLIST_PREFIXES = {
    "sư tôn",
    "sư phụ",
    "trưởng lão",
    "gia chủ",
    "tông chủ",
    "tộc nhân",
    "thành chủ",
    "bang chúng",
    "đại sư",
    "bọn người",
    "tên",
}
NOUN_BLACKLIST_SUFFIXES = {
    "muội muội",
    "tỷ tỷ",
    "sư tôn",
    "sư phụ",
    "trưởng lão",
    "gia chủ",
    "tông chủ",
}
NOUN_POSITION_PREFIXES = {
    "phía sau núi",
    "phía trước",
    "phía sau",
    "ở trong",
    "ở ngoài",
    "bên trong",
    "bên ngoài",
}
SENTENCE_CAPITALIZED_NOISE = {
    "Bỗng",
    "Bỗng nhiên",
    "Nhưng",
    "Rồi",
    "Khi",
    "Lúc",
    "Sau đó",
}


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
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS project_noun_index (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                namespace TEXT NOT NULL,
                normalized_value TEXT NOT NULL,
                canonical_value TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                aliases_json TEXT NOT NULL DEFAULT '[]',
                last_chapter_index INTEGER,
                chapter_id TEXT,
                updated_at INTEGER NOT NULL
            )
            """
        )
        self.conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_project_noun_unique
            ON project_noun_index(project_id, normalized_value)
            """
        )
        self.conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_project_noun_project_namespace
            ON project_noun_index(project_id, namespace, count DESC, updated_at DESC)
            """
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
        self.conn.execute("DELETE FROM project_noun_index WHERE namespace = ?", (namespace,))
        self.conn.commit()
        return int(cur.rowcount or 0)

    def get_stats(self, namespace: str, project_id: str | None = None, feature: str | None = None) -> Dict[str, Any]:
        total_memories = self.conn.execute(
            "SELECT COUNT(*) AS count FROM memories WHERE namespace = ?", (namespace,)
        ).fetchone()["count"]
        total_namespaces = self.conn.execute(
            "SELECT COUNT(DISTINCT namespace) AS count FROM memories"
        ).fetchone()["count"]
        rows = self.conn.execute(
            "SELECT entities_json, metadata_json FROM memories WHERE namespace = ? ORDER BY created_at DESC LIMIT 20",
            (namespace,),
        ).fetchall()
        recent_entities: List[str] = []
        recent_nouns: List[str] = []
        total_nouns = 0
        new_nouns_last_ingest = 0
        for row in rows:
            try:
                for entity in json.loads(row["entities_json"] or "[]"):
                    if entity not in recent_entities:
                        recent_entities.append(entity)
            except Exception:
                continue
            try:
                metadata = json.loads(row["metadata_json"] or "{}")
                nouns = metadata.get("nouns") or []
                total_nouns += len(nouns) if isinstance(nouns, list) else 0
                for noun in nouns:
                    value = str(noun.get("value") if isinstance(noun, dict) else noun or "").strip()
                    if value and value not in recent_nouns:
                        recent_nouns.append(value)
            except Exception:
                continue
        if feature == "story.translation.nouns" and project_id:
            noun_rows = self.conn.execute(
                """
                SELECT canonical_value, count
                FROM project_noun_index
                WHERE project_id = ? AND namespace = ?
                ORDER BY count DESC, updated_at DESC
                LIMIT ?
                """,
                (project_id, namespace, MAX_NOUN_RESULTS),
            ).fetchall()
            noun_total_row = self.conn.execute(
                """
                SELECT COUNT(*) AS count
                FROM project_noun_index
                WHERE project_id = ? AND namespace = ?
                """,
                (project_id, namespace),
            ).fetchone()
            total_nouns = int(noun_total_row["count"] or 0) if noun_total_row else 0
            recent_nouns = [str(row["canonical_value"] or "").strip() for row in noun_rows if str(row["canonical_value"] or "").strip()]
            new_nouns_last_ingest = len([noun for noun in recent_nouns if noun])

        return {
            "namespace": namespace,
            "totalMemories": int(total_memories or 0),
            "totalNamespaces": int(total_namespaces or 0),
            "recentEntities": recent_entities[:20],
            "recentNouns": recent_nouns[:20],
            "totalNouns": int(total_nouns or 0),
            "newNounsLastIngest": int(new_nouns_last_ingest or 0),
        }

    def upsert_project_nouns(
        self,
        project_id: str,
        namespace: str,
        nouns: List[Dict[str, Any]],
        chapter_index: int | None,
        chapter_id: str,
    ) -> Dict[str, Any]:
        if not project_id or not namespace or not nouns:
            return []

        updated_entries: List[Dict[str, Any]] = []
        mapped_canonical: List[Dict[str, Any]] = []
        new_nouns_last_ingest = 0
        now_ms = int(time.time() * 1000)

        for noun in nouns:
            normalized = str(noun.get("normalizedValue") or "").strip().lower()
            canonical = str(noun.get("value") or "").strip()
            increment = max(1, int(noun.get("count") or 1))
            if not normalized or not canonical:
                continue

            mapped_from = str(noun.get("mappedFrom") or "").strip()
            existing = self.conn.execute(
                """
                SELECT canonical_value, count, aliases_json, last_chapter_index, chapter_id
                FROM project_noun_index
                WHERE project_id = ? AND normalized_value = ?
                LIMIT 1
                """,
                (project_id, normalized),
            ).fetchone()

            if existing is None:
                aliases = [canonical]
                self.conn.execute(
                    """
                    INSERT INTO project_noun_index (
                        project_id, namespace, normalized_value, canonical_value,
                        count, aliases_json, last_chapter_index, chapter_id, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        project_id,
                        namespace,
                        normalized,
                        canonical,
                        increment,
                        json.dumps(aliases, ensure_ascii=False),
                        chapter_index,
                        chapter_id,
                        now_ms,
                    ),
                )
                updated_entries.append(
                    {
                        "value": canonical,
                        "normalizedValue": normalized,
                        "count": increment,
                        "aliases": aliases,
                        "lastChapterIndex": chapter_index,
                        "source": "project_dictionary",
                        "mappedFrom": mapped_from or None,
                    }
                )
                mapped_canonical.append(
                    {
                        "input": mapped_from or canonical,
                        "normalized": normalized,
                        "canonical": canonical,
                        "reason": "new",
                    }
                )
                new_nouns_last_ingest += 1
                continue

            try:
                aliases = json.loads(existing["aliases_json"] or "[]")
                if not isinstance(aliases, list):
                    aliases = []
            except Exception:
                aliases = []

            canonical_existing = str(existing["canonical_value"] or "").strip()
            if canonical and canonical not in aliases:
                aliases.append(canonical)
            if canonical_existing and canonical_existing not in aliases:
                aliases.insert(0, canonical_existing)

            updated_count = int(existing["count"] or 0) + increment
            chosen_canonical = canonical_existing or canonical
            if canonical and len(canonical) > len(chosen_canonical):
                chosen_canonical = canonical

            self.conn.execute(
                """
                UPDATE project_noun_index
                SET namespace = ?,
                    canonical_value = ?,
                    count = ?,
                    aliases_json = ?,
                    last_chapter_index = ?,
                    chapter_id = ?,
                    updated_at = ?
                WHERE project_id = ? AND normalized_value = ?
                """,
                (
                    namespace,
                    chosen_canonical,
                    updated_count,
                    json.dumps(aliases, ensure_ascii=False),
                    chapter_index,
                    chapter_id,
                    now_ms,
                    project_id,
                    normalized,
                ),
            )
            updated_entries.append(
                {
                    "value": chosen_canonical,
                    "normalizedValue": normalized,
                    "count": updated_count,
                    "aliases": aliases,
                    "lastChapterIndex": chapter_index,
                    "source": "project_dictionary",
                    "mappedFrom": mapped_from or None,
                }
            )
            mapped_canonical.append(
                {
                    "input": mapped_from or canonical,
                    "normalized": normalized,
                    "canonical": chosen_canonical,
                    "reason": "exact" if mapped_from == "" else "fuzzy",
                }
            )

        self.conn.commit()
        return {
            "entries": updated_entries,
            "mappedCanonical": mapped_canonical,
            "newNounsLastIngest": new_nouns_last_ingest,
        }

    def search_project_nouns(self, project_id: str, namespace: str, query_text: str, limit: int = MAX_NOUN_RESULTS) -> List[Dict[str, Any]]:
        if not project_id or not namespace:
            return []
        safe_limit = max(1, min(50, int(limit or 20)))
        query_norm = str(query_text or "").lower()

        rows = self.conn.execute(
            """
            SELECT canonical_value, normalized_value, count, aliases_json, last_chapter_index, chapter_id, updated_at
            FROM project_noun_index
            WHERE project_id = ? AND namespace = ?
            ORDER BY count DESC, updated_at DESC
            LIMIT 200
            """,
            (project_id, namespace),
        ).fetchall()

        scored: List[Dict[str, Any]] = []
        for row in rows:
            canonical = str(row["canonical_value"] or "").strip()
            normalized = str(row["normalized_value"] or "").strip()
            if not canonical or not normalized:
                continue
            try:
                aliases = json.loads(row["aliases_json"] or "[]")
                if not isinstance(aliases, list):
                    aliases = []
            except Exception:
                aliases = []
            score = float(row["count"] or 0)
            if query_norm:
                if normalized in query_norm:
                    score += 50.0
                elif canonical.lower() in query_norm:
                    score += 30.0
            scored.append(
                {
                    "value": canonical,
                    "normalizedValue": normalized,
                    "count": int(row["count"] or 0),
                    "aliases": aliases,
                    "chapterId": row["chapter_id"],
                    "chapterIndex": row["last_chapter_index"],
                    "source": "project_dictionary",
                    "provenance": f"project:{project_id}",
                    "_score": score,
                }
            )

        scored.sort(key=lambda item: (-float(item["_score"]), -int(item.get("count") or 0)))
        return [{k: v for k, v in item.items() if k != "_score"} for item in scored[:safe_limit]]

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
        self.underthesea_ok = False
        self.provider_configured = False
        self.backend = "unavailable"
        self.python_version = sys.version.split()[0]
        self.nlp = None
        self.loaded_spacy_model = None
        self.underthesea = None
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

        try:
            import underthesea  # type: ignore

            self.underthesea = underthesea
            self.underthesea_ok = True
        except Exception:
            self.underthesea = None
            self.underthesea_ok = False

        self.provider_configured = bool(
            os.environ.get("MEM0_API_KEY")
            or os.environ.get("OPENAI_API_KEY")
            or os.environ.get("GOOGLE_API_KEY")
            or os.environ.get("MEMORY_CONTEXT_PROVIDER")
        )

        if self.mem0_ok and self.spacy_ok and self.spacy_model_ok and self.underthesea_ok:
            self.backend = "local_fallback"
        else:
            self.backend = "unavailable"

    def health(self) -> Dict[str, Any]:
        warning = None
        if not self.mem0_ok or not self.spacy_ok or not self.spacy_model_ok or not self.underthesea_ok:
            warning = (
                "Thiếu dependency Python cho memory context. Cài: "
                "pip install mem0ai[nlp] underthesea && python -m spacy download xx_ent_wiki_sm"
            )
        elif not self.provider_configured:
            warning = "Provider Mem0 chưa cấu hình. V1 đang dùng backend local fallback cho search/add."
        return {
            "pythonOk": True,
            "mem0Ok": self.mem0_ok,
            "spacyOk": self.spacy_ok,
            "spacyModelOk": self.spacy_model_ok,
            "undertheseaOk": self.underthesea_ok,
            "providerConfigured": self.provider_configured,
            "backend": self.backend,
            "warning": warning,
            "details": {
                "pythonVersion": self.python_version,
                "storePath": self.store.db_path,
                "spacyModelName": SPACY_MODEL_NAME,
                "spacyLoadedModel": self.loaded_spacy_model,
                "modules": {
                    "mem0": self.mem0_ok,
                    "spacy": self.spacy_ok,
                    SPACY_MODEL_NAME: self.spacy_model_ok,
                    "underthesea": self.underthesea_ok,
                },
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
        parts = []
        if chapter_label:
            parts.append(f"[{chapter_label}]")
        if glossary:
            parts.append(f"Entities: {glossary}")
        if translated:
            parts.append(f"Translation: {translated}")
        return "\n".join(parts)

    def extract_vietnamese_nouns(self, text: str) -> List[Dict[str, Any]]:
        cleaned = " ".join(str(text or "").split())
        if not cleaned or self.underthesea is None:
            return []

        raw_items: List[str] = self.extract_raw_entities(cleaned)
        normalized_payload = self.normalize_entities(raw_items)
        return normalized_payload["nouns"]

    def extract_raw_entities(self, text: str) -> List[str]:
        if self.underthesea is None:
            return []
        raw_items: List[str] = []
        try:
            ner_items = self.underthesea.ner(text)
            for item in ner_items or []:
                if not isinstance(item, (list, tuple)) or len(item) < 3:
                    continue
                value = str(item[0] or "").strip()
                tag = str(item[2] or "").strip()
                if value and tag in {"B-PER", "I-PER", "B-LOC", "I-LOC", "B-ORG", "I-ORG"}:
                    raw_items.append(value)

            noun_tags = {"N", "Np", "Ny", "Nu", "Nb", "Nc", "V"}
            tagged = self.underthesea.pos_tag(text)
            current_phrase: List[str] = []
            for token, tag in tagged:
                value = str(token or "").strip()
                if not value:
                    continue
                if tag in noun_tags:
                    current_phrase.append(value)
                else:
                    if current_phrase:
                        raw_items.append(" ".join(current_phrase))
                        current_phrase = []
            if current_phrase:
                raw_items.append(" ".join(current_phrase))
        except Exception as exc:
            safe_err(f"[mem0_context_worker] underthesea noun extraction failed: {exc}")
            return []
        return raw_items

    def normalize_entities(self, raw_items: List[str]) -> Dict[str, Any]:
        normalized_counts: Counter[str] = Counter()
        display_map: Dict[str, str] = {}
        rejected: List[str] = []

        for raw in raw_items:
            candidate = self.normalize_single_entity(raw)
            if not candidate:
                rejected.append(raw)
                continue
            normalized = candidate.lower()
            normalized_counts[normalized] += 1
            if normalized not in display_map:
                display_map[normalized] = candidate

        nouns: List[Dict[str, Any]] = []
        normalized_candidates: List[str] = []
        for normalized, count in normalized_counts.most_common(64):
            canonical = display_map.get(normalized, normalized)
            nouns.append(
                {
                    "value": canonical,
                    "normalizedValue": normalized,
                    "count": int(count),
                }
            )
            normalized_candidates.append(canonical)
        return {
            "nouns": nouns,
            "normalizedCandidates": normalized_candidates,
            "rejectedCandidates": rejected[:64],
        }

    def normalize_single_entity(self, value: str) -> str:
        candidate = " ".join(str(value or "").split())
        candidate = candidate.strip(" []{}()\"'`“”‘’,.;:!?")
        if not candidate:
            return ""

        lower = candidate.lower()
        for prefix in NOUN_POSITION_PREFIXES:
            if lower.startswith(prefix + " "):
                candidate = candidate[len(prefix):].strip()
                lower = candidate.lower()

        for prefix in NOUN_BLACKLIST_PREFIXES:
            if lower.startswith(prefix + " "):
                candidate = candidate[len(prefix):].strip()
                lower = candidate.lower()

        for suffix in NOUN_BLACKLIST_SUFFIXES:
            if lower.endswith(" " + suffix):
                candidate = candidate[: len(candidate) - len(suffix)].strip()
                lower = candidate.lower()

        if " của " in lower:
            parts = candidate.split(" của ")
            candidate = parts[-1].strip()
            lower = candidate.lower()

        if candidate in SENTENCE_CAPITALIZED_NOISE:
            return ""
        if len(candidate.split()) <= 1 and len(candidate) <= 1:
            return ""
        if lower.isdigit():
            return ""
        return candidate

    def synchronize_entities(self, project_id: str, namespace: str, nouns: List[Dict[str, Any]]) -> Dict[str, Any]:
        if not nouns:
            return {"resolved": [], "mappedCanonical": []}
        existing = self.store.search_project_nouns(project_id, namespace, "", limit=400)
        existing_items = [
            {
                "value": str(item.get("value") or "").strip(),
                "normalizedValue": str(item.get("normalizedValue") or "").strip().lower(),
            }
            for item in existing
            if str(item.get("value") or "").strip()
        ]
        resolved: List[Dict[str, Any]] = []
        mapped: List[Dict[str, Any]] = []
        for noun in nouns:
            original_value = str(noun.get("value") or "").strip()
            original_norm = str(noun.get("normalizedValue") or "").strip().lower()
            if not original_value or not original_norm:
                continue

            match = next((e for e in existing_items if e["normalizedValue"] == original_norm), None)
            if match:
                resolved.append(
                    {
                        "value": match["value"],
                        "normalizedValue": match["normalizedValue"],
                        "count": int(noun.get("count") or 1),
                        "mappedFrom": "",
                    }
                )
                mapped.append(
                    {
                        "input": original_value,
                        "normalized": original_norm,
                        "canonical": match["value"],
                        "reason": "exact",
                    }
                )
                continue

            fuzzy_target = None
            for e in existing_items:
                if original_norm in e["normalizedValue"] or e["normalizedValue"] in original_norm:
                    fuzzy_target = e
                    break
            if fuzzy_target and len(fuzzy_target["value"]) >= len(original_value):
                resolved.append(
                    {
                        "value": fuzzy_target["value"],
                        "normalizedValue": fuzzy_target["normalizedValue"],
                        "count": int(noun.get("count") or 1),
                        "mappedFrom": original_value,
                    }
                )
                mapped.append(
                    {
                        "input": original_value,
                        "normalized": original_norm,
                        "canonical": fuzzy_target["value"],
                        "reason": "fuzzy",
                    }
                )
                continue

            resolved.append(
                {
                    "value": original_value,
                    "normalizedValue": original_norm,
                    "count": int(noun.get("count") or 1),
                    "mappedFrom": "",
                }
            )
            mapped.append(
                {
                    "input": original_value,
                    "normalized": original_norm,
                    "canonical": original_value,
                    "reason": "new",
                }
            )
        return {"resolved": resolved, "mappedCanonical": mapped}

    def build_noun_memory_text(self, payload: Dict[str, Any], nouns: List[Dict[str, Any]]) -> str:
        metadata = payload.get("metadata") or {}
        chapter_title = str(metadata.get("chapterTitle") or "").strip()
        chapter_label = ""
        chapter_index = metadata.get("chapterIndex")
        if chapter_index is not None:
            chapter_label = f"Chapter {chapter_index}"
        if chapter_title:
            chapter_label = f"{chapter_label}: {chapter_title}" if chapter_label else chapter_title
        noun_list = ", ".join(str(item.get("value") or "").strip() for item in nouns[:12] if str(item.get("value") or "").strip())
        parts = []
        if chapter_label:
            parts.append(f"[{chapter_label}]")
        if noun_list:
            parts.append(f"Known Nouns: {noun_list}")
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
        feature = str(payload.get("feature") or "").strip()
        project_id = str(payload.get("projectId") or "").strip()
        namespace = str(payload.get("namespace") or "").strip()
        query_text = str(payload.get("queryText") or "")
        query_entities = self.extract_entities(query_text)
        top_k = max(1, min(20, int(payload.get("topK") or 5)))

        if feature == "story.translation.nouns":
            nouns = self.store.search_project_nouns(project_id, namespace, query_text, limit=MAX_NOUN_RESULTS)
            prompt_lines = []
            if nouns:
                prompt_lines.append("Known Proper Nouns:")
                for noun in nouns[:MAX_NOUN_RESULTS]:
                    value = str(noun.get("value") or "").strip()
                    if value:
                        prompt_lines.append(f"- {value}")
            return {
                "memories": [],
                "promptContext": "\n".join(prompt_lines),
                "nouns": nouns,
                "nounSyncDebug": {
                    "rawCandidates": [],
                    "normalizedCandidates": [str(noun.get("value") or "") for noun in nouns[:MAX_NOUN_RESULTS]],
                    "mappedCanonical": [],
                    "rejectedCandidates": [],
                },
                "debug": [
                    {
                        "memory": str(noun.get("value") or ""),
                        "score": float(noun.get("count") or 0),
                        "chapterId": noun.get("chapterId"),
                        "chapterIndex": noun.get("chapterIndex"),
                        "kind": "project_noun",
                    }
                    for noun in nouns[:MAX_NOUN_RESULTS]
                ],
                "namespace": namespace,
                "warning": health.get("warning"),
            }

        candidates = self.store.get_candidates(namespace, current_chapter_index)
        scored_items = []
        aggregated_nouns: List[Dict[str, Any]] = []
        for row in candidates:
            score = self.score_candidate(query_text, query_entities, row, current_chapter_index)
            if score <= 0:
                continue
            try:
                entities = json.loads(row["entities_json"] or "[]")
            except Exception:
                entities = []
            try:
                metadata_json = json.loads(row["metadata_json"] or "{}")
            except Exception:
                metadata_json = {}
            row_nouns = metadata_json.get("nouns") or []
            scored_items.append(
                {
                    "memory": row["memory_text"],
                    "score": round(score, 3),
                    "entities": entities[:8],
                    "nouns": row_nouns[:12] if isinstance(row_nouns, list) else [],
                    "chapterId": row["chapter_id"],
                    "chapterIndex": row["chapter_index"],
                }
            )
        scored_items.sort(key=lambda item: (-float(item["score"]), int(item.get("chapterIndex") or 0) * -1))
        top_items = scored_items[:top_k]
        noun_counter: Counter[str] = Counter()
        noun_display: Dict[str, Dict[str, Any]] = {}
        for item in top_items:
            for noun in item.get("nouns") or []:
                if isinstance(noun, dict):
                    value = str(noun.get("value") or "").strip()
                    normalized = str(noun.get("normalizedValue") or value).strip().lower()
                    count = int(noun.get("count") or 1)
                else:
                    value = str(noun or "").strip()
                    normalized = value.lower()
                    count = 1
                if not value or not normalized:
                    continue
                noun_counter[normalized] += max(1, count)
                if normalized not in noun_display:
                    noun_display[normalized] = {
                        "value": value,
                        "normalizedValue": normalized,
                    }
        for normalized, count in noun_counter.most_common(20):
            base = noun_display.get(normalized, {"value": normalized, "normalizedValue": normalized})
            aggregated_nouns.append(
                {
                    "value": base["value"],
                    "normalizedValue": base["normalizedValue"],
                    "count": int(count),
                }
            )
        prompt_lines = [
            "Translation Memory Context:",
        ]
        for index, item in enumerate(top_items, start=1):
            prompt_lines.append(f"{index}. {item['memory']}")
        if aggregated_nouns:
            prompt_lines.append("")
            prompt_lines.append("Known Proper Nouns:")
            for noun in aggregated_nouns[:12]:
                prompt_lines.append(f"- {noun['value']}")
        prompt_context = "\n".join(prompt_lines) if top_items else ""
        return {
            "memories": [item["memory"] for item in top_items],
            "promptContext": prompt_context,
            "nouns": aggregated_nouns,
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
        metadata = payload.get("metadata") or {}
        feature = str(payload.get("feature") or "").strip()
        project_id = str(payload.get("projectId") or "").strip()
        namespace = str(payload.get("namespace") or "").strip()
        translated_text = str(payload.get("translatedText") or "")
        raw_candidates: List[str] = []
        normalized_candidates: List[str] = []
        rejected_candidates: List[str] = []
        nouns: List[Dict[str, Any]] = []
        mapped_canonical: List[Dict[str, Any]] = []
        if feature == "story.translation.nouns":
            raw_candidates = self.extract_raw_entities(translated_text)
            normalized_payload = self.normalize_entities(raw_candidates)
            nouns = normalized_payload["nouns"]
            normalized_candidates = normalized_payload["normalizedCandidates"]
            rejected_candidates = normalized_payload["rejectedCandidates"]
            if project_id and namespace:
                synchronized = self.synchronize_entities(project_id, namespace, nouns)
                nouns = synchronized["resolved"]
                mapped_canonical = synchronized["mappedCanonical"]
        chapter_index = int(metadata.get("chapterIndex")) if metadata.get("chapterIndex") is not None else None
        chapter_id = str(metadata.get("chapterId") or "").strip()

        combined_text = f"{payload.get('sourceText') or ''}\n{translated_text}"
        entities = self.extract_entities(combined_text)
        metadata["nouns"] = nouns
        metadata["nounSyncDebug"] = {
            "rawCandidates": raw_candidates[:64],
            "normalizedCandidates": normalized_candidates[:64],
            "mappedCanonical": mapped_canonical[:64],
            "rejectedCandidates": rejected_candidates[:64],
        }
        payload["metadata"] = metadata
        memory_text = (
            self.build_noun_memory_text(payload, nouns)
            if feature == "story.translation.nouns"
            else self.build_memory_text(payload, entities)
        )
        stored_count = self.store.add_memory(payload, entities, memory_text)
        merged_nouns: List[Dict[str, Any]] = []
        new_nouns_last_ingest = 0
        if feature == "story.translation.nouns" and project_id and namespace:
            upsert_result = self.store.upsert_project_nouns(
                project_id=project_id,
                namespace=namespace,
                nouns=nouns,
                chapter_index=chapter_index,
                chapter_id=chapter_id,
            )
            merged_nouns = upsert_result.get("entries") or []
            mapped_canonical = upsert_result.get("mappedCanonical") or mapped_canonical
            new_nouns_last_ingest = int(upsert_result.get("newNounsLastIngest") or 0)
        return {
            "storedCount": stored_count,
            "entities": entities,
            "nouns": merged_nouns if merged_nouns else nouns,
            "nounSyncDebug": {
                "rawCandidates": raw_candidates[:64],
                "normalizedCandidates": normalized_candidates[:64],
                "mappedCanonical": mapped_canonical[:64],
                "rejectedCandidates": rejected_candidates[:64],
            },
            "newNounsLastIngest": new_nouns_last_ingest,
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
                project_id = str(payload.get("projectId") or "")
                feature = str(payload.get("feature") or "")
                safe_json({"requestId": request_id, "success": True, "data": runtime.store.get_stats(namespace, project_id, feature)})
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
