/**
 * Text Splitter - Chia text thành các batch để dịch
 * Giúp tránh rate limit và tối ưu hiệu suất
 */

import { SubtitleEntry, SplitOptions, SplitResult } from '../../../shared/types/caption';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Một batch text để dịch
 */
export interface TextBatch {
  batchIndex: number;
  startIndex: number;
  endIndex: number;
  entries: SubtitleEntry[];
  texts: string[];
}

/**
 * Chia entries thành các batch nhỏ hơn
 * @param entries - Danh sách SubtitleEntry
 * @param linesPerBatch - Số dòng mỗi batch (mặc định 50)
 */
/**
 * Merge kết quả dịch vào entries gốc
 * @param entries - Entries gốc
 * @param translatedTexts - Danh sách text đã dịch (cùng thứ tự với entries)
 */
export function mergeTranslatedTexts(
  entries: SubtitleEntry[],
  translatedTexts: string[]
): SubtitleEntry[] {
  console.log(`[TextSplitter] Merge ${translatedTexts.length} translated texts`);
  
  return entries.map((entry, index) => ({
    ...entry,
    // Giữ undefined nếu không có bản dịch, tránh mask lỗi bằng text gốc
    translatedText: translatedTexts[index] || entry.translatedText || undefined,
  }));
}

export type TranslationResponseFormat = 'json' | 'numbered' | 'pipe';

export interface TranslationPromptResult {
  prompt: string;
  systemPrompt?: string;
  responseFormat: TranslationResponseFormat;
}

/**
 * Format memory context thành markdown section để gắn vào prompt.
 */
function formatMemoryContextMarkdown(context: string): string {
  return `\n\n## Translation Memory\n\n` +
    `Các bản dịch trước để tham khảo. Giữ NHẤT QUÁN thuật ngữ, ` +
    `tên nhân vật và phong cách dịch.\n\n` +
    `${context}\n\n` +
    `---\n` +
    `Dùng ngữ cảnh trên để giữ NHẤT QUÁN tên nhân vật, thuật ngữ, ` +
    `và phong cách dịch. TUYỆT ĐỐI KHÔNG gộp câu — mỗi câu input = 1 output.\n`;
}

/**
 * Tạo prompt template cho việc dịch batch.
 * Nếu customTemplate được cung cấp, thay thế các biến:
 *   {{COUNT}}     → số dòng trong batch
 *   {{TEXT}}      → nội dung các dòng (thuần văn bản, mỗi dòng một câu)
 *   {{FILE_NAME}} → 'subtitle'
 * Prompt luôn ở định dạng markdown, memory context được append dưới dạng markdown section.
 * Output AI vẫn là JSON (responseFormat = 'json').
 */
export function createTranslationPrompt(
  texts: string[],
  targetLanguage: string = 'Vietnamese',
  customTemplate?: string,
  memoryContext?: string,
  debugSaveDir?: string,
  batchIndex?: number,
): TranslationPromptResult {
  const count = texts.length;

  if (customTemplate) {
    // --- Custom prompt: chỉ thay thế biến, KHÔNG sửa nội dung JSON ---
    // Đặt JSON raw trong markdown heading để phân ranh với memory context
    const arrayText = JSON.stringify(texts);
    const rawText = texts.join('\n');
    const content = customTemplate
      .replace(/"\{\{TEXT\}\}"/g, arrayText)   // "{{TEXT}}" → ["line1","line2",...]
      .replace(/\{\{TEXT\}\}/g, rawText)          // {{TEXT}} → plain fallback
      .replace(/\{\{COUNT\}\}/g, String(count))
      .replace(/\{\{FILE_NAME\}\}/g, 'subtitle');

    let prompt = `## User Translation Rules\n${content}\n`;

    if (memoryContext) {
      prompt += formatMemoryContextMarkdown(memoryContext);
    }

    console.log('[TextSplitter] Sử dụng custom prompt + memory context, format: json');
    savePromptDebug(debugSaveDir, batchIndex, prompt);
    return { prompt, responseFormat: 'json' };
  }

  // --- Default prompt: markdown format, nhúng JSON schema trong code blocks ---
  const sourcePayload = texts.map((text, i) => ({ index: i + 1, text }));
  let prompt = `# Subtitle Translation Prompt

## Task
Dịch **${count}** dòng subtitle sau sang tiếng **${targetLanguage}**.

## Output Format
- **Type:** JSON
- **Encoding:** UTF-8
- **Strict JSON Only:** KHÔNG markdown, KHÔNG \`\`\`json, KHÔNG text thừa.

## Success Response Schema
\`\`\`json
{
  "status": "success",
  "data": {
    "translations": [
      { "index": 1, "translated": "..." }
    ],
    "summary": {
      "total_sentences": ${count},
      "input_count": ${count},
      "output_count": ${count},
      "match": true,
      "language_style": "casual"
    }
  }
}
\`\`\`

## Error Response Schema
\`\`\`json
{
  "status": "error",
  "error": {
    "code": "ERROR_PROCESSING_FAILED",
    "message": "..."
  }
}
\`\`\`

## Critical Rules
1. translations phải có CHÍNH XÁC **${count}** object, index từ **1..${count}**, không thiếu, không trùng.
2. Mỗi câu input tương ứng đúng **1** câu translated — KHÔNG gộp, KHÔNG tách câu.
3. MỖI CÂU INPUT = 1 OBJECT OUTPUT. Index phải khớp tuyệt đối.

## Source Text
\`\`\`json
${JSON.stringify(sourcePayload, null, 2)}
\`\`\``;

  if (memoryContext) {
    prompt += formatMemoryContextMarkdown(memoryContext);
  }

  console.log('[TextSplitter] Sử dụng default prompt (markdown), format: json');
  savePromptDebug(debugSaveDir, batchIndex, prompt);
  return { prompt, responseFormat: 'json' };
}

/**
 * System prompt cố định cho DeepSeek, tối ưu cho context caching.
 * KHÔNG chứa targetLanguage, KHÔNG chứa {count} — đảm bảo cache prefix giống nhau giữa các batch.
 */
function buildDeepSeekSystemPrompt(): string {
  return `# Subtitle Translation Prompt

## Task
Dịch các dòng subtitle sau. Output là JSON thuần, KHÔNG markdown, KHÔNG code block.

## Success Response Schema
{
  "status": "success",
  "data": {
    "translations": [
      { "index": 1, "translated": "..." }
    ],
    "summary": {
      "total_sentences": <số_lượng>,
      "input_count": <số_lượng>,
      "output_count": <số_lượng>,
      "match": true,
      "language_style": "casual"
    }
  }
}

## Error Response Schema
{
  "status": "error",
  "error": {
    "code": "ERROR_PROCESSING_FAILED",
    "message": "..."
  }
}

## Critical Rules
1. Mỗi câu input = 1 object output. Index phải khớp chính xác (bắt đầu từ 1).
2. KHÔNG gộp câu — mỗi câu input tương ứng đúng 1 câu translated.
3. KHÔNG có markdown hay text thừa — CHỈ trả về JSON thuần.

## Terminology
- Tên nhân vật: Giữ nguyên, không dịch.
- Địa danh: Dịch âm Hán Việt nếu có.
- Đại từ: Phù hợp văn hóa Việt.`;
}

/**
 * Tạo prompt cho DeepSeek với Context Caching optimization.
 * System prompt = stable (task, rules, schemas — không có {count}).
 * User prompt = variable (source text, memory context).
 */
export function createDeepSeekPrompt(
  texts: string[],
  targetLanguage: string = 'Vietnamese',
  customTemplate?: string,
  memoryContext?: string,
  debugSaveDir?: string,
  batchIndex?: number,
  systemPromptOverride?: string,
): TranslationPromptResult {
  const count = texts.length;

  if (customTemplate) {
    const arrayText = JSON.stringify(texts);
    const rawText = texts.join('\n');
    const content = customTemplate
      .replace(/"\{\{TEXT\}\}"/g, arrayText)
      .replace(/\{\{TEXT\}\}/g, rawText)
      .replace(/\{\{COUNT\}\}/g, String(count))
      .replace(/\{\{FILE_NAME\}\}/g, 'subtitle');

    const systemPrompt = systemPromptOverride
      ? `${systemPromptOverride}\n\n## Target Language\nDịch sang tiếng **${targetLanguage}**.`
      : buildDeepSeekSystemPrompt();
    let userPrompt = `## User Translation Rules\n${content}\n`;

    if (memoryContext) {
      userPrompt += formatMemoryContextMarkdown(memoryContext);
    }

    console.log('[TextSplitter] DeepSeek custom prompt (system+user), format: json');
    savePromptDebug(debugSaveDir, batchIndex, `[SYSTEM]\n${systemPrompt}\n\n[USER]\n${userPrompt}`);
    return { prompt: userPrompt, systemPrompt, responseFormat: 'json' };
  }

  const systemPrompt = systemPromptOverride
    ? `${systemPromptOverride}\n\n## Target Language\nDịch sang tiếng **${targetLanguage}**.`
    : `# Subtitle Translation Prompt

## Task
Dịch các dòng subtitle sau sang tiếng **${targetLanguage}**.

## Output Format
- **Type:** JSON
- **Encoding:** UTF-8
- **Strict JSON Only:** KHÔNG markdown, KHÔNG \`\`\`json, KHÔNG text thừa.

## Success Response Schema
\`\`\`json
{
  "status": "success",
  "data": {
    "translations": [
      { "index": 1, "translated": "..." }
    ],
    "summary": {
      "total_sentences": <số_lượng>,
      "input_count": <số_lượng>,
      "output_count": <số_lượng>,
      "match": true,
      "language_style": "casual"
    }
  }
}
\`\`\`

## Error Response Schema
\`\`\`json
{
  "status": "error",
  "error": {
    "code": "ERROR_PROCESSING_FAILED",
    "message": "..."
  }
}
\`\`\`

## Critical Rules
1. translations phải có CHÍNH XÁC số object bằng số dòng input, index từ 1, không thiếu, không trùng.
2. Mỗi câu input tương ứng đúng 1 câu translated — KHÔNG gộp, KHÔNG tách câu.
3. MỖI CÂU INPUT = 1 OBJECT OUTPUT. Index phải khớp tuyệt đối.
`;

  const sourcePayload = texts.map((text, i) => ({ index: i + 1, text }));
  let userPrompt = `Dịch **${count}** dòng subtitle sau sang tiếng **${targetLanguage}**:

## Source Text
\`\`\`json
${JSON.stringify(sourcePayload, null, 2)}
\`\`\``;

  if (memoryContext) {
    userPrompt += formatMemoryContextMarkdown(memoryContext);
  }

  console.log('[TextSplitter] DeepSeek default prompt (system+user), format: json');
  savePromptDebug(debugSaveDir, batchIndex, `[SYSTEM]\n${systemPrompt}\n\n[USER]\n${userPrompt}`);
  return { prompt: userPrompt, systemPrompt, responseFormat: 'json' };
}

function savePromptDebug(debugSaveDir?: string, batchIndex?: number, prompt?: string): void {
  if (!debugSaveDir || !prompt) return;
  try {
    const idx = typeof batchIndex === 'number' ? batchIndex + 1 : Date.now();
    const fileName = `step3_prompt_batch_${idx}.txt`;
    const dir = debugSaveDir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(dir, fileName), prompt, 'utf-8');
    console.log(`[TextSplitter] Đã lưu prompt debug: ${path.join(dir, fileName)}`);
  } catch (error) {
    console.warn('[TextSplitter] Không thể lưu prompt debug:', error);
  }
}

export interface JsonTranslationParseResult {
  ok: boolean;
  translatedTexts: string[];
  errorCode?: string;
  errorMessage?: string;
}

function parseCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  return value >= 0 ? value : null;
}

function failJsonParse(
  translatedTexts: string[],
  errorCode: string,
  errorMessage: string
): JsonTranslationParseResult {
  return {
    ok: false,
    translatedTexts,
    errorCode,
    errorMessage,
  };
}

/**
 * Parse response JSON schema cho Step 3 (JSON-only).
 */
export function parseJsonTranslationResponse(
  response: string,
  expectedCount: number
): JsonTranslationParseResult {
  const safeExpectedCount = Math.max(0, Math.floor(expectedCount));
  const translatedTexts = new Array<string>(safeExpectedCount).fill('');
  const raw = typeof response === 'string' ? response.trim() : '';

  console.log(`[TextSplitter] Parse JSON response, expected ${safeExpectedCount} lines`);

  if (!raw) {
    return failJsonParse(translatedTexts, 'JSON_PARSE_FAILED', 'Response rỗng');
  }
  if (!raw.startsWith('{') || !raw.endsWith('}')) {
    return failJsonParse(
      translatedTexts,
      'JSON_PARSE_FAILED',
      'Response không phải JSON thuần túy (có text thừa ngoài JSON)'
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return failJsonParse(
      translatedTexts,
      'JSON_PARSE_FAILED',
      `JSON.parse thất bại: ${String(error)}`
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return failJsonParse(translatedTexts, 'ERROR_INVALID_INPUT', 'Schema không hợp lệ: root phải là object');
  }

  const root = parsed as Record<string, unknown>;
  const status = typeof root.status === 'string' ? root.status.trim() : '';

  if (status === 'error') {
    const errorNode =
      root.error && typeof root.error === 'object' && !Array.isArray(root.error)
        ? (root.error as Record<string, unknown>)
        : {};
    const upstreamCode = typeof errorNode.code === 'string' ? errorNode.code.trim() : '';
    const upstreamMessage = typeof errorNode.message === 'string' ? errorNode.message.trim() : '';
    return failJsonParse(
      translatedTexts,
      upstreamCode || 'ERROR_PROCESSING_FAILED',
      upstreamMessage || 'Model trả về status=error'
    );
  }

  if (status !== 'success') {
    return failJsonParse(
      translatedTexts,
      'ERROR_INVALID_INPUT',
      'Schema không hợp lệ: status phải là "success" hoặc "error"'
    );
  }

  const dataNode =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : null;
  if (!dataNode) {
    return failJsonParse(translatedTexts, 'ERROR_INVALID_INPUT', 'Schema không hợp lệ: thiếu data object');
  }

  const translations = Array.isArray(dataNode.translations) ? dataNode.translations : null;
  if (!translations) {
    return failJsonParse(translatedTexts, 'ERROR_INVALID_INPUT', 'Schema không hợp lệ: thiếu data.translations[]');
  }

  const seenIndexes = new Set<number>();

  for (const item of translations) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return failJsonParse(translatedTexts, 'ERROR_INVALID_INPUT', 'Schema không hợp lệ: item translations phải là object');
    }
    const typed = item as Record<string, unknown>;
    const parsedIndex = parseCount(typed.index);
    if (parsedIndex === null || parsedIndex <= 0) {
      return failJsonParse(translatedTexts, 'ERROR_INVALID_INPUT', 'Schema không hợp lệ: index phải là số nguyên >= 1');
    }
    if (parsedIndex > safeExpectedCount) {
      return failJsonParse(
        translatedTexts,
        'ERROR_COUNT_MISMATCH',
        `Index ngoài phạm vi: ${parsedIndex} > ${safeExpectedCount}`
      );
    }
    if (seenIndexes.has(parsedIndex)) {
      return failJsonParse(translatedTexts, 'ERROR_INVALID_INPUT', `Trùng index trong translations: ${parsedIndex}`);
    }
    if (typeof typed.translated !== 'string') {
      return failJsonParse(translatedTexts, 'ERROR_INVALID_INPUT', `Schema không hợp lệ tại index ${parsedIndex}: thiếu translated string`);
    }

    seenIndexes.add(parsedIndex);
    translatedTexts[parsedIndex - 1] = typed.translated.trim();
  }

  if (seenIndexes.size !== safeExpectedCount) {
    return failJsonParse(
      translatedTexts,
      'ERROR_COUNT_MISMATCH',
      `Số dòng dịch không khớp: nhận ${seenIndexes.size}/${safeExpectedCount}`
    );
  }

  const summaryNode =
    dataNode.summary && typeof dataNode.summary === 'object' && !Array.isArray(dataNode.summary)
      ? (dataNode.summary as Record<string, unknown>)
      : null;
  if (!summaryNode) {
    return failJsonParse(translatedTexts, 'ERROR_INVALID_INPUT', 'Schema không hợp lệ: thiếu data.summary object');
  }

  const totalSentences = parseCount(summaryNode.total_sentences);
  const inputCount = parseCount(summaryNode.input_count);
  const outputCount = parseCount(summaryNode.output_count);
  const match = summaryNode.match;
  const languageStyle = summaryNode.language_style;

  if (
    totalSentences !== safeExpectedCount ||
    inputCount !== safeExpectedCount ||
    outputCount !== safeExpectedCount ||
    match !== true
  ) {
    return failJsonParse(
      translatedTexts,
      'ERROR_COUNT_MISMATCH',
      `Summary mismatch: total=${String(totalSentences)}, input=${String(inputCount)}, output=${String(outputCount)}, match=${String(match)}`
    );
  }

  if (typeof languageStyle !== 'string' || !languageStyle.trim()) {
    return failJsonParse(translatedTexts, 'ERROR_INVALID_INPUT', 'Schema không hợp lệ: summary.language_style phải là string');
  }

  console.log(`[TextSplitter] [JSON] Parse được ${translatedTexts.filter((r) => r).length}/${safeExpectedCount} dòng`);
  return {
    ok: true,
    translatedTexts,
  };
}

/**
 * Parse kết quả dịch dạng pipe: |Câu1|Câu2|...|CâuN|
 */
export function parsePipeResponse(
  response: string,
  expectedCount: number
): string[] {
  console.log(`[TextSplitter] Parse pipe response, expected ${expectedCount} lines`);

  // Tìm đoạn |...|...|...|  trong response (bỏ qua text thừa trước/sau)
  const pipeMatch = response.match(/\|[^]*/);
  const raw = pipeMatch ? pipeMatch[0] : response;

  // Tách theo '|', bỏ phần tử rỗng (do dòng bắt đầu/kết thúc bằng |)
  const parts = raw.split('|').map(s => s.trim());

  // Lọc phần tử rỗng ở 2 đầu (do dòng bắt đầu/kết thúc bằng |)
  const results: string[] = [];
  for (const part of parts) {
    if (results.length >= expectedCount) break;
    if (part !== '') {
      results.push(part);
    }
  }

  // Điền các dòng thiếu bằng chuỗi rỗng
  for (let i = results.length; i < expectedCount; i++) {
    results.push('');
    console.warn(`[TextSplitter] [Pipe] Thiếu dịch cho dòng ${i + 1}`);
  }

  console.log(`[TextSplitter] [Pipe] Parse được ${results.filter(r => r).length}/${expectedCount} dòng`);
  return results;
}

/**
 * Parse kết quả dịch từ response của Gemini
 * Format expected: [1] Text dịch 1\n[2] Text dịch 2\n...
 */
export function parseTranslationResponse(
  response: string,
  expectedCount: number
): string[] {
  console.log(`[TextSplitter] Parse translation response, expected ${expectedCount} lines`);
  
  const results: string[] = [];
  const lines = response.trim().split('\n');
  
  // Pattern: [1] Text hoặc 1. Text hoặc 1) Text
  const linePattern = /^\[?(\d+)\]?[.):]?\s*(.+)$/;
  
  for (const line of lines) {
    const match = line.trim().match(linePattern);
    if (match) {
      const index = parseInt(match[1], 10) - 1; // 0-indexed
      const text = match[2].trim();
      
      if (index >= 0 && index < expectedCount) {
        results[index] = text;
      }
    }
  }
  
  // Điền các dòng thiếu bằng chuỗi rỗng
  for (let i = 0; i < expectedCount; i++) {
    if (!results[i]) {
      results[i] = '';
      console.warn(`[TextSplitter] Thiếu dịch cho dòng ${i + 1}`);
    }
  }
  
  console.log(`[TextSplitter] Parse được ${results.filter(r => r).length}/${expectedCount} dòng`);
  return results;
}

/**
 * Chia entries thành nhiều file text
 * @param options - SplitOptions
 */
export async function splitText(options: SplitOptions): Promise<SplitResult> {
  const { entries, splitByLines, value, outputDir } = options;
  console.log(`[TextSplitter] Split text: ${entries.length} entries, splitByLines=${splitByLines}, value=${value}`);

  try {
    // Tạo thư mục output nếu chưa tồn tại
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const files: string[] = [];
    let batches: SubtitleEntry[][];

    if (splitByLines) {
      // Chia theo số dòng mỗi file
      batches = [];
      for (let i = 0; i < entries.length; i += value) {
        batches.push(entries.slice(i, i + value));
      }
    } else {
      // Chia đều thành N phần
      const partsCount = Math.max(1, Math.min(value, entries.length));
      const entriesPerPart = Math.ceil(entries.length / partsCount);
      batches = [];
      for (let i = 0; i < partsCount; i++) {
        const start = i * entriesPerPart;
        const end = Math.min(start + entriesPerPart, entries.length);
        if (start < entries.length) {
          batches.push(entries.slice(start, end));
        }
      }
    }

    // Ghi từng batch vào file
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const fileName = `part_${String(i + 1).padStart(3, '0')}.txt`;
      const filePath = path.join(outputDir, fileName);
      
      // Nội dung file: mỗi dòng là text của một entry
      const content = batch.map(entry => entry.text).join('\n');
      fs.writeFileSync(filePath, content, 'utf-8');
      
      files.push(filePath);
      console.log(`[TextSplitter] Đã ghi file: ${filePath} (${batch.length} dòng)`);
    }

    console.log(`[TextSplitter] Đã chia thành ${files.length} files`);
    return {
      success: true,
      partsCount: files.length,
      files,
    };
  } catch (error) {
    console.error('[TextSplitter] Lỗi split text:', error);
    return {
      success: false,
      partsCount: 0,
      files: [],
      error: String(error),
    };
  }
}
