import { app } from 'electron';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { checkPythonModuleAvailability } from '../../utils/pythonRuntime';
import { Chapter, ParseStoryResult } from '../../../shared/types/story';

/**
 * Parses a story file into chapters.
 * Supports .txt files with specific delimiters (e.g., === 第X章 ===) and .epub files.
 */
export async function parseStoryFile(filePath: string): Promise<ParseStoryResult> {
  try {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.epub') {
       return await parseEpubFile(filePath);
    } else {
       return await parseTxtFile(filePath);
    }

  } catch (error) {
    console.error('Error parsing story file:', error);
    return { success: false, error: String(error) };
  }
}

const EPUB_WORKER_TIMEOUT_MS = 120000;

function resolveStoryEpubWorkerPath(): string | null {
  const appPath = app.getAppPath();
  const candidates = [
    path.join(process.resourcesPath || '', 'story', 'python', 'ebooklib_story_worker.py'),
    path.join(process.resourcesPath || '', 'python', 'ebooklib_story_worker.py'),
    path.join(appPath, 'src', 'main', 'services', 'story', 'python', 'ebooklib_story_worker.py')
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function normalizeWorkerResult(rawResult: ParseStoryResult): ParseStoryResult {
  if (!rawResult.success || !Array.isArray(rawResult.chapters)) {
    return {
      success: false,
      error: rawResult.error || 'EbookLib parser did not return chapter data'
    };
  }

  const chapters = rawResult.chapters
    .map((chapter) => ({
      title: String(chapter?.title || '').trim(),
      content: String(chapter?.content || '').trim()
    }))
    .filter((chapter) => chapter.content.length > 0)
    .map((chapter, index) => ({
      id: String(index + 1),
      title: chapter.title || `Chapter ${index + 1}`,
      content: chapter.content
    }));

  if (chapters.length === 0) {
    return { success: false, error: 'No readable chapters returned by EbookLib parser' };
  }

  return { success: true, chapters };
}

async function runEpubWorker(
  filePath: string,
  runtimeCommand: string,
  runtimeBaseArgs: string[],
  workerPath: string
): Promise<ParseStoryResult> {
  return new Promise((resolve) => {
    const args = [...runtimeBaseArgs, '-u', workerPath, '--file', filePath];
    const env = {
      ...process.env,
      PYTHONUTF8: '1',
      PYTHONDONTWRITEBYTECODE: '1'
    };

    const child = spawn(runtimeCommand, args, {
      windowsHide: true,
      env
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const finish = (result: ParseStoryResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // no-op
      }
      finish({ success: false, error: `EbookLib worker timeout after ${EPUB_WORKER_TIMEOUT_MS}ms` });
    }, EPUB_WORKER_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ success: false, error: `Failed to start EbookLib worker: ${String(error)}` });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;

      const stdoutText = Buffer.concat(stdoutChunks).toString('utf-8').trim();
      const stderrText = Buffer.concat(stderrChunks).toString('utf-8').trim();

      const nonEmptyLines = stdoutText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const jsonCandidate = nonEmptyLines.length > 0 ? nonEmptyLines[nonEmptyLines.length - 1] : '';
      if (!jsonCandidate) {
        finish({
          success: false,
          error: `EbookLib worker produced no output (code=${code ?? 'null'}). ${stderrText}`.trim()
        });
        return;
      }

      try {
        const parsed = JSON.parse(jsonCandidate) as ParseStoryResult;
        finish(normalizeWorkerResult(parsed));
      } catch {
        finish({
          success: false,
          error: `Invalid JSON from EbookLib worker (code=${code ?? 'null'}). stderr=${stderrText} stdout=${jsonCandidate}`
        });
      }
    });
  });
}

async function parseEpubFile(filePath: string): Promise<ParseStoryResult> {
  const workerPath = resolveStoryEpubWorkerPath();
  if (!workerPath) {
    return {
      success: false,
      error: 'Missing EbookLib worker file (ebooklib_story_worker.py)'
    };
  }

  const availability = await checkPythonModuleAvailability(['ebooklib'], { preferredVersion: '3.12' });
  if (!availability.success || !availability.runtime) {
    return {
      success: false,
      error: `[${availability.errorCode || 'PYTHON_MODULE_MISSING'}] ${availability.error || 'Python runtime unavailable for EbookLib parser'}`
    };
  }

  const parseResult = await runEpubWorker(
    filePath,
    availability.runtime.command,
    availability.runtime.baseArgs,
    workerPath
  );

  if (!parseResult.success) {
    console.error('[storyParser] EbookLib parse failed.', {
      filePath,
      error: parseResult.error
    });
  }

  return parseResult;
}

/**
 * Existing TXT parser
 */
async function parseTxtFile(filePath: string): Promise<ParseStoryResult> {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const chapters: Chapter[] = [];
    
    // Regex to find chapter headers like "=== 第1章 寒门之子 ==="
    const chapterRegex = /===\s*(.*?)\s*===/g;
    
    let match;
    const matches: { title: string; index: number; length: number }[] = [];
    while ((match = chapterRegex.exec(fileContent)) !== null) {
      matches.push({
        title: match[1].trim(),
        index: match.index,
        length: match[0].length
      });
    }

    if (matches.length === 0) {
      chapters.push({
        id: '1',
        title: 'Toàn bộ nội dung',
        content: fileContent
      });
      return { success: true, chapters };
    }

    for (let i = 0; i < matches.length; i++) {
        const currentMatch = matches[i];
        const nextMatch = matches[i + 1];
        
        const contentStart = currentMatch.index + currentMatch.length;
        const contentEnd = nextMatch ? nextMatch.index : fileContent.length;
        
        const content = fileContent.slice(contentStart, contentEnd).trim();
        
        chapters.push({
            id: String(i + 1),
            title: currentMatch.title,
            content: content
        });
    }

    return { success: true, chapters };
}
