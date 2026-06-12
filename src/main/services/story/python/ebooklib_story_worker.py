import argparse
import json
import re
import sys
import traceback
from html import unescape
from html.parser import HTMLParser
from urllib.parse import unquote

from ebooklib import ITEM_DOCUMENT, epub  # type: ignore[import-not-found]


BLOCK_TAGS = {
    "p",
    "div",
    "li",
    "tr",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "section",
    "article",
    "header",
    "footer",
    "pre",
}
SKIP_TAGS = {"script", "style", "noscript", "svg"}


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:  # noqa: ANN001
        tag_name = (tag or "").lower()
        if tag_name in SKIP_TAGS:
            self._skip_depth += 1
            return
        if self._skip_depth > 0:
            return
        if tag_name == "br" or tag_name in BLOCK_TAGS:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag_name = (tag or "").lower()
        if tag_name in SKIP_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if self._skip_depth > 0:
            return
        if tag_name in BLOCK_TAGS:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth > 0:
            return
        if not data:
            return
        self._parts.append(data.replace("\xa0", " "))

    def get_text(self) -> str:
        text = "".join(self._parts)
        text = text.replace("\r", "")
        text = re.sub(r"\n[ \t]+", "\n", text)
        text = re.sub(r"[ \t]+\n", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()


def normalize_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def normalize_href_key(href: str) -> str:
    value = (href or "").strip().replace("\\", "/")
    if not value:
        return ""
    value = unquote(value)
    value = value.split("#", 1)[0]
    value = value.split("?", 1)[0]
    value = re.sub(r"^\.?/", "", value)
    return value.strip().lower()


def basename_key(path_value: str) -> str:
    normalized = normalize_href_key(path_value)
    if not normalized:
        return ""
    return normalized.rsplit("/", 1)[-1]


def extract_title_from_html(html: str) -> str:
    if not html:
        return ""
    patterns = [r"<h1[^>]*>(.*?)</h1>", r"<h2[^>]*>(.*?)</h2>", r"<title[^>]*>(.*?)</title>"]
    for pattern in patterns:
        matched = re.search(pattern, html, flags=re.IGNORECASE | re.DOTALL)
        if not matched:
            continue
        raw = re.sub(r"<[^>]+>", "", matched.group(1))
        title = normalize_spaces(unescape(raw))
        if title:
            return title
    return ""


def html_to_text(html: str) -> str:
    if not html:
        return ""
    parser = TextExtractor()
    parser.feed(html)
    parser.close()
    return parser.get_text()


def extract_toc_entries(book) -> list[dict[str, str]]:  # noqa: ANN001
    entries: list[dict[str, str]] = []

    def add_entry(node) -> None:  # noqa: ANN001
        href = ""
        title = ""

        href = getattr(node, "href", "") or getattr(node, "file_name", "") or ""
        title = getattr(node, "title", "") or ""

        href_key = normalize_href_key(str(href))
        if not href_key:
            return

        entry = {
            "href_key": href_key,
            "basename_key": basename_key(href_key),
            "title": normalize_spaces(str(title)),
        }
        entries.append(entry)

    def walk(nodes) -> None:  # noqa: ANN001
        if nodes is None:
            return
        if isinstance(nodes, (list, tuple)):
            iterable = list(nodes)
        else:
            iterable = [nodes]

        for node in iterable:
            if isinstance(node, tuple) and len(node) >= 2:
                add_entry(node[0])
                walk(node[1])
            else:
                add_entry(node)

    walk(book.toc)

    deduped: list[dict[str, str]] = []
    seen: set[str] = set()
    for entry in entries:
        key = entry["href_key"]
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(entry)
    return deduped


def collect_spine_documents(book) -> list[dict[str, str]]:  # noqa: ANN001
    documents: list[dict[str, str]] = []

    for spine_item in book.spine:
        if not spine_item:
            continue

        item_id = spine_item[0] if isinstance(spine_item, (list, tuple)) else spine_item
        if not item_id or item_id == "nav":
            continue

        item = book.get_item_with_id(item_id)
        if item is None or item.get_type() != ITEM_DOCUMENT:
            continue

        content_bytes = item.get_content() or b""
        html = content_bytes.decode("utf-8", errors="ignore")
        text = html_to_text(html)
        if not text:
            continue

        file_name = getattr(item, "file_name", "") or getattr(item, "get_name", lambda: "")()
        href_key = normalize_href_key(str(file_name))

        documents.append(
            {
                "href_key": href_key,
                "basename_key": basename_key(href_key),
                "title_hint": extract_title_from_html(html),
                "text": text,
            }
        )

    return documents


def build_chapters_from_toc(spine_docs: list[dict[str, str]], toc_entries: list[dict[str, str]]) -> list[dict[str, str]]:
    if not spine_docs or not toc_entries:
        return []

    index_by_href: dict[str, int] = {}
    index_by_basename: dict[str, int] = {}
    for index, doc in enumerate(spine_docs):
        href_key = doc.get("href_key", "")
        base_key = doc.get("basename_key", "")
        if href_key and href_key not in index_by_href:
            index_by_href[href_key] = index
        if base_key and base_key not in index_by_basename:
            index_by_basename[base_key] = index

    boundaries: list[dict[str, int | str]] = []
    for toc in toc_entries:
        start_index = index_by_href.get(toc.get("href_key", ""))
        if start_index is None:
            start_index = index_by_basename.get(toc.get("basename_key", ""))
        if start_index is None:
            continue
        if boundaries and int(boundaries[-1]["start_index"]) == int(start_index):
            continue
        boundaries.append(
            {
                "start_index": int(start_index),
                "title": toc.get("title", "").strip(),
            }
        )

    if not boundaries:
        return []

    chapters: list[dict[str, str]] = []
    for index, boundary in enumerate(boundaries):
        start_index = int(boundary["start_index"])
        next_start = int(boundaries[index + 1]["start_index"]) if index + 1 < len(boundaries) else len(spine_docs)
        end_index = max(start_index, next_start - 1)

        parts: list[str] = []
        for spine_index in range(start_index, end_index + 1):
            doc = spine_docs[spine_index]
            text = (doc.get("text") or "").strip()
            if text:
                parts.append(text)

        combined = "\n\n".join(parts).strip()
        if not combined:
            continue

        title = normalize_spaces(str(boundary.get("title") or ""))
        if not title:
            title = normalize_spaces(str(spine_docs[start_index].get("title_hint") or ""))
        if not title:
            title = f"Chapter {len(chapters) + 1}"

        chapters.append(
            {
                "id": str(len(chapters) + 1),
                "title": title,
                "content": combined,
            }
        )

    return chapters


def build_chapters_per_spine(spine_docs: list[dict[str, str]]) -> list[dict[str, str]]:
    chapters: list[dict[str, str]] = []
    for doc in spine_docs:
        content = (doc.get("text") or "").strip()
        if not content:
            continue

        title = normalize_spaces(str(doc.get("title_hint") or ""))
        if not title:
            title = f"Chapter {len(chapters) + 1}"

        chapters.append(
            {
                "id": str(len(chapters) + 1),
                "title": title,
                "content": content,
            }
        )

    return chapters


def parse_epub(file_path: str) -> dict:
    book = epub.read_epub(file_path, options={"ignore_ncx": False})
    spine_docs = collect_spine_documents(book)
    if not spine_docs:
        return {"success": False, "error": "No readable chapters found in EPUB spine"}

    toc_entries = extract_toc_entries(book)
    chapters = build_chapters_from_toc(spine_docs, toc_entries)
    if not chapters:
        chapters = build_chapters_per_spine(spine_docs)

    if not chapters:
        return {"success": False, "error": "No chapters could be extracted by EbookLib"}

    return {"success": True, "chapters": chapters}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True, help="Absolute path to EPUB file")
    args = parser.parse_args()

    try:
        result = parse_epub(args.file)
    except Exception as exc:  # noqa: BLE001
        result = {
            "success": False,
            "error": f"EbookLib parser exception: {exc}",
            "traceback": traceback.format_exc(limit=5),
        }

    sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
