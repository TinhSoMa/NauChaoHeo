import argparse
import json
import os
from typing import Dict, List, Tuple

try:
    import tkinter as tk
    from tkinter import filedialog, messagebox
except Exception:
    tk = None


def load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: str, data: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def extract_title(translated_content: str, chapter_id: str) -> str:
    lines = [line.strip() for line in translated_content.splitlines() if line.strip()]
    return lines[0] if lines else f"Chương {chapter_id}"


def parse_chapter_file(path: str) -> Tuple[str, str, str, str]:
    data = load_json(path)
    chapter_id = str(data.get("chapterId", "")).strip()
    chapter_title = str(data.get("chapterTitle", "")).strip()
    translated_content = str(data.get("translatedContent", "")).strip()
    model = str(data.get("model", "")).strip()

    if not chapter_id:
        raise ValueError(f"Missing chapterId in {path}")
    if not translated_content:
        raise ValueError(f"Missing translatedContent in {path}")

    title = extract_title(translated_content, chapter_id)
    if chapter_title:
        # Prefer translated title extracted from content; keep chapterTitle only if content has no title
        title = title or chapter_title

    return chapter_id, translated_content, title, model


def sort_key(chapter_id: str):
    try:
        return int(chapter_id)
    except ValueError:
        return chapter_id


def merge_translations(state_path: str, input_files: List[str]) -> None:
    state = load_json(state_path)

    translated_entries: Dict[str, str] = dict(state.get("translatedEntries", []))
    chapter_models: Dict[str, str] = dict(state.get("chapterModels", []))

    for file_path in input_files:
        chapter_id, translated_content, title, model = parse_chapter_file(file_path)
        translated_entries[chapter_id] = translated_content
        if model:
            chapter_models[chapter_id] = model

    # Order by chapterId
    ordered_ids = sorted(translated_entries.keys(), key=sort_key)
    ordered_translated_entries = [[cid, translated_entries[cid]] for cid in ordered_ids]
    translated_titles = [
        {"id": cid, "title": extract_title(translated_entries[cid], cid)}
        for cid in ordered_ids
    ]
    ordered_chapter_models = [
        [cid, chapter_models.get(cid, state.get("model", ""))] for cid in ordered_ids
    ]

    state["translatedEntries"] = ordered_translated_entries
    state["translatedTitles"] = translated_titles
    state["chapterModels"] = ordered_chapter_models

    save_json(state_path, state)


def collect_input_files(input_dir: str, input_file: str) -> List[str]:
    files: List[str] = []
    if input_file:
        files.append(input_file)
    if input_dir:
        for name in os.listdir(input_dir):
            if name.lower().endswith(".json"):
                files.append(os.path.join(input_dir, name))
    return files


def main():
    parser = argparse.ArgumentParser(description="Merge translated chapter JSON files into story-translator.json")
    parser.add_argument("--state", required=False, help="Path to story-translator.json")
    parser.add_argument("--input-dir", default="", help="Folder containing chapter JSON files")
    parser.add_argument("--input-file", default="", help="Single chapter JSON file (e.g., 1.json)")

    args = parser.parse_args()

    if not args.state and not args.input_dir and not args.input_file:
        if not tk:
            raise SystemExit("Tkinter is not available. Provide CLI arguments instead.")

        root = tk.Tk()
        root.withdraw()

        state_path = filedialog.askopenfilename(
            title="Chọn story-translator.json",
            filetypes=[("JSON Files", "*.json")]
        )
        if not state_path:
            return

        input_dir = filedialog.askdirectory(title="Chọn thư mục chứa các file chương (JSON)")
        input_file = ""
        if not input_dir:
            input_file = filedialog.askopenfilename(
                title="Hoặc chọn 1 file chương",
                filetypes=[("JSON Files", "*.json")]
            )

        input_files = collect_input_files(input_dir, input_file)
        if not input_files:
            messagebox.showerror("Lỗi", "Không có file chương nào được chọn.")
            return

        merge_translations(state_path, input_files)
        messagebox.showinfo("Thành công", f"Đã merge {len(input_files)} file(s) vào {state_path}")
        return

    if not args.state:
        raise SystemExit("Missing --state. Provide story-translator.json path.")

    input_files = collect_input_files(args.input_dir, args.input_file)
    if not input_files:
        raise SystemExit("No input files found. Use --input-file or --input-dir.")

    merge_translations(args.state, input_files)
    print(f"Merged {len(input_files)} file(s) into {args.state}")


if __name__ == "__main__":
    main()
