import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createChromeMock } from "./harness/mock-chrome.mjs";
import { loadBackgroundHooks } from "./harness/load-background-hooks.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

async function loadHooks(initialStore = {}) {
  const chromeMock = createChromeMock(initialStore);
  const hooks = await loadBackgroundHooks({ repoRoot, chromeMock });
  return { hooks, chromeMock };
}

test("validateTranslationCount: pass when indexes are full and ordered", async () => {
  const { hooks } = await loadHooks();
  const result = hooks.validateTranslationCount(3, {
    translations: [{ index: 1 }, { index: 2 }, { index: 3 }]
  }, "");
  assert.equal(result.ok, true);
  assert.equal(result.reasonCode, null);
});

test("validateTranslationCount: fail on missing index", async () => {
  const { hooks } = await loadHooks();
  const result = hooks.validateTranslationCount(3, {
    translations: [{ index: 1 }, { index: 3 }]
  }, "");
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "MISSING_INDEX");
  assert.deepEqual(Array.from(result.missing), [2]);
});

test("validateEbookNovelCompletion: pass with chapter header and Het chuong", async () => {
  const { hooks } = await loadHooks();
  const result = hooks.validateEbookNovelCompletion(
    { chapterIndex: 9, chapterTitle: "Chapter test", lines: ["原文首行"] },
    "Chương 9: Lời mời trong bóng tối\n...\nHết chương"
  );
  assert.equal(result.ok, true);
  assert.equal(result.firstLineOk, true);
  assert.equal(result.endMarkerOk, true);
});

test("validateEbookNovelCompletion: fail when end marker missing", async () => {
  const { hooks } = await loadHooks();
  const result = hooks.validateEbookNovelCompletion(
    { chapterIndex: 2, chapterTitle: "Chapter test", lines: ["原文首行"] },
    "Chương 2: Tiêu đề\nNội dung chưa kết thúc"
  );
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "EBOOK_END_MARKER_MISSING");
});

test("saveBatchFilesForActiveMode: writes subtitleBatchFiles in subtitle mode", async () => {
  const { hooks, chromeMock } = await loadHooks({ activeInputMode: "subtitle" });
  const batchFiles = [{ name: "a.txt", status: "pending" }];
  await hooks.saveBatchFilesForActiveMode(batchFiles);
  assert.deepEqual(chromeMock.__store.batchFiles, batchFiles);
  assert.deepEqual(chromeMock.__store.subtitleBatchFiles, batchFiles);
  assert.equal(chromeMock.__store.ebookBatchFiles, undefined);
});

test("saveBatchFilesForActiveMode: writes ebookBatchFiles in ebook mode", async () => {
  const { hooks, chromeMock } = await loadHooks({ activeInputMode: "ebook" });
  const batchFiles = [{ name: "ch1", status: "done" }];
  await hooks.saveBatchFilesForActiveMode(batchFiles);
  assert.deepEqual(chromeMock.__store.batchFiles, batchFiles);
  assert.deepEqual(chromeMock.__store.ebookBatchFiles, batchFiles);
  assert.equal(chromeMock.__store.subtitleBatchFiles, undefined);
});
