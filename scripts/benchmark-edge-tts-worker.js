#!/usr/bin/env node

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  args._positional = positional;
  return args;
}

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    '-',
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join('');
}

function getSafeFilename(index, text, ext) {
  const safeText = String(text || '')
    .slice(0, 30)
    .replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF\s-]/g, '')
    .replace(/\s+/g, '_')
    .trim();
  return `${String(index).padStart(5, '0')}_${safeText || 'audio'}.${ext}`;
}

function chunkArray(arr, size) {
  if (size <= 0) return [arr.slice()];
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function looksLikeWav(buffer) {
  return buffer.length >= 12
    && buffer.slice(0, 4).toString('ascii') === 'RIFF'
    && buffer.slice(8, 12).toString('ascii') === 'WAVE';
}

function looksLikeMp3(buffer) {
  if (buffer.length >= 3 && buffer.slice(0, 3).toString('ascii') === 'ID3') {
    return true;
  }
  return buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
}

function resolvePythonRuntime(preferred) {
  const candidates = preferred
    ? [{ command: preferred, baseArgs: [] }]
    : [
        { command: 'python', baseArgs: [] },
        { command: 'py', baseArgs: ['-3'] },
        { command: 'py', baseArgs: [] },
      ];

  for (const c of candidates) {
    try {
      const check = spawnSync(c.command, [...c.baseArgs, '--version'], {
        stdio: 'ignore',
        timeout: 3000,
        windowsHide: true,
      });
      if (check.status === 0) {
        return c;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

function printHelp() {
  console.log('Benchmark Edge TTS worker speed + audio validity');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/benchmark-edge-tts-worker.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --count <n>                 Number of audio items (default: 200)');
  console.log('  --batchSize <n>             Items per job (default: 250)');
  console.log('  --voice <voiceId>           Voice ID (default: vi-VN-HoaiMyNeural)');
  console.log('  --rate <rate>               Edge rate (default: +0%)');
  console.log('  --volume <volume>           Edge volume (default: +0%)');
  console.log('  --format <wav|mp3>          Output format (default: wav)');
  console.log('  --wavMode <auto|direct|convert>  Worker wav mode (default: auto)');
  console.log('  --itemConcurrency <n>       Worker per-job item concurrency (default: 2)');
  console.log('  --timeoutMs <n>             Per-item timeout in worker (default: 75000)');
  console.log('  --text <text>               Base text for generated items');
  console.log('  --outputDir <path>          Output directory (default: test/output/edge-bench-<timestamp>)');
  console.log('  --python <cmd>              Python command (default: auto-detect)');
  console.log('  --workerPath <path>         Worker path override');
  console.log('  --logEvery <n>              Progress log step (default: 100)');
  console.log('  --clean                     Remove existing output directory first');
  console.log('  --dryRun                    Build payload only, do not spawn worker');
  console.log('  --help                      Show help');
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function removeDirIfExists(dir) {
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

async function validateOutputs(results, expectedFormat) {
  let validCount = 0;
  let invalidCount = 0;
  const invalidSamples = [];

  for (const item of results) {
    if (!item.success) {
      continue;
    }
    const outputPath = item.path;
    try {
      const buf = await fsp.readFile(outputPath);
      if (buf.length <= 0) {
        throw new Error('file empty');
      }
      let ok = false;
      if (expectedFormat === 'wav') {
        ok = looksLikeWav(buf);
      } else {
        ok = looksLikeMp3(buf);
      }
      if (!ok) {
        throw new Error(`header mismatch (${expectedFormat})`);
      }
      validCount += 1;
    } catch (err) {
      invalidCount += 1;
      if (invalidSamples.length < 20) {
        invalidSamples.push(`${outputPath} :: ${String(err && err.message ? err.message : err)}`);
      }
    }
  }

  return {
    validCount,
    invalidCount,
    invalidSamples,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const positional = Array.isArray(args._positional) ? args._positional : [];
  const positionalLooksLikeNpmStrippedFlags = positional.length > 0
    && !args.count
    && !args.format
    && !args.wavMode
    && !args.python;

  if (positionalLooksLikeNpmStrippedFlags) {
    console.warn(
      '[benchmark] Detected positional args only (likely npm consumed --flags). '
      + 'Applying positional fallback: <count> <format> <wavMode> <python> <outputDir>.'
    );
  }

  const count = Math.max(1, toInt(args.count ?? positional[0], 200));
  const batchSize = Math.max(1, toInt(args.batchSize, 250));
  const voice = String(args.voice || 'vi-VN-HoaiMyNeural');
  const rate = String(args.rate || '+0%');
  const volume = String(args.volume || '+0%');
  const outputFormat = String((args.format ?? positional[1]) || 'wav').toLowerCase() === 'mp3' ? 'mp3' : 'wav';
  const wavMode = String((args.wavMode ?? positional[2]) || 'auto').toLowerCase();
  const itemConcurrency = Math.max(1, toInt(args.itemConcurrency, 2));
  const timeoutMs = Math.max(1, toInt(args.timeoutMs, 75000));
  const logEvery = Math.max(1, toInt(args.logEvery, 100));
  const baseText = String(args.text || 'Xin chao day la audio benchmark toc do NauChaoHeo');

  const defaultOutputDir = path.join(process.cwd(), 'test', 'output', `edge-bench-${nowStamp()}`);
  const outputDir = path.resolve(String(args.outputDir || positional[4] || defaultOutputDir));
  const workerPath = path.resolve(
    String(args.workerPath || path.join(process.cwd(), 'src', 'main', 'services', 'tts', 'python', 'edge_tts_worker.py'))
  );

  if (!fs.existsSync(workerPath)) {
    throw new Error(`Worker not found: ${workerPath}`);
  }

  const runtime = args.dryRun
    ? { command: '<dry-run>', baseArgs: [] }
    : resolvePythonRuntime(args.python ? String(args.python) : (positional[3] ? String(positional[3]) : undefined));
  if (!runtime) {
    throw new Error('Cannot find Python runtime. Use --python to provide command.');
  }

  if (args.clean) {
    await removeDirIfExists(outputDir);
  }
  await ensureDir(outputDir);

  const ext = outputFormat;
  const items = [];
  for (let i = 1; i <= count; i += 1) {
    const text = `${baseText} #${i}`;
    const filename = getSafeFilename(i, text, ext);
    items.push({
      index: i,
      text,
      outputPath: path.join(outputDir, filename),
      filename,
      startMs: (i - 1) * 2000,
      durationMs: 2000,
    });
  }

  const jobs = chunkArray(items, batchSize).map((chunk) => ({
    proxyId: null,
    proxyUrl: null,
    items: chunk,
    voice,
    rate,
    volume,
    outputFormat,
  }));

  const payload = {
    jobs,
    timeoutMs,
    wavMode,
    itemConcurrency,
  };

  console.log('=== Edge TTS Worker Benchmark ===');
  console.log(`Worker     : ${workerPath}`);
  console.log(`Python     : ${runtime.command} ${runtime.baseArgs.join(' ')}`.trim());
  console.log(`Output dir : ${outputDir}`);
  console.log(`Count      : ${count}`);
  console.log(`Batch size : ${batchSize} -> jobs=${jobs.length}`);
  console.log(`Format     : ${outputFormat}`);
  console.log(`Wav mode   : ${wavMode}`);
  console.log(`Concurrency: ${itemConcurrency}`);
  console.log(`Timeout ms : ${timeoutMs}`);

  if (args.dryRun) {
    console.log('Dry run enabled. Payload prepared, worker not executed.');
    return;
  }

  const startedAt = Date.now();
  let stdoutBuf = '';
  let stderrBuf = '';
  let doneEvent = null;
  let progressCount = 0;
  let progressSuccess = 0;
  let progressFailed = 0;

  await new Promise((resolve, reject) => {
    const proc = spawn(runtime.command, [...runtime.baseArgs, workerPath], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    proc.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString();
      let idx;
      while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (!line) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }

        if (event.event === 'progress') {
          progressCount += 1;
          if (event.success === true) {
            progressSuccess += 1;
          } else {
            progressFailed += 1;
          }
          if (progressCount % logEvery === 0 || progressCount === count) {
            const elapsed = (Date.now() - startedAt) / 1000;
            const speed = elapsed > 0 ? (progressCount / elapsed).toFixed(2) : '0.00';
            console.log(
              `[progress] ${progressCount}/${count} success=${progressSuccess} fail=${progressFailed} speed=${speed} item/s`
            );
          }
        }

        if (event.event === 'done') {
          doneEvent = event;
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
    });

    proc.on('error', (err) => {
      reject(err);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker exited with code=${code} stderr=${stderrBuf.trim()}`));
        return;
      }
      resolve();
    });

    proc.stdin.write(Buffer.from(JSON.stringify(payload), 'utf8'));
    proc.stdin.end();
  });

  if (!doneEvent || !Array.isArray(doneEvent.results)) {
    throw new Error(`Worker did not emit done event. stderr=${stderrBuf.trim()}`);
  }

  const resultMap = new Map();
  for (const r of doneEvent.results) {
    if (typeof r.index === 'number') {
      resultMap.set(r.index, r);
    }
  }

  const mergedResults = items.map((item) => {
    const r = resultMap.get(item.index);
    return {
      index: item.index,
      path: item.outputPath,
      success: !!(r && r.success),
      error: r && r.error ? String(r.error) : undefined,
    };
  });

  const successCount = mergedResults.filter((r) => r.success).length;
  const failCount = mergedResults.length - successCount;
  const elapsedSec = (Date.now() - startedAt) / 1000;
  const throughput = elapsedSec > 0 ? mergedResults.length / elapsedSec : 0;

  const validation = await validateOutputs(mergedResults, outputFormat);

  const report = {
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date().toISOString(),
    elapsedSec,
    throughputItemsPerSec: throughput,
    config: {
      count,
      batchSize,
      jobs: jobs.length,
      outputFormat,
      wavMode,
      itemConcurrency,
      timeoutMs,
      voice,
      rate,
      volume,
      outputDir,
      workerPath,
      pythonCommand: runtime.command,
      pythonBaseArgs: runtime.baseArgs,
    },
    result: {
      successCount,
      failCount,
      progressCount,
      progressSuccess,
      progressFailed,
      validAudioHeaders: validation.validCount,
      invalidAudioHeaders: validation.invalidCount,
    },
    failedSamples: mergedResults.filter((r) => !r.success).slice(0, 50),
    invalidHeaderSamples: validation.invalidSamples,
    workerStderr: stderrBuf.trim(),
  };

  const reportPath = path.join(outputDir, 'benchmark_report.json');
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('');
  console.log('=== Summary ===');
  console.log(`Elapsed      : ${elapsedSec.toFixed(2)}s`);
  console.log(`Throughput   : ${throughput.toFixed(2)} item/s`);
  console.log(`Success/Fail : ${successCount}/${failCount}`);
  console.log(`Header valid : ${validation.validCount}`);
  console.log(`Header error : ${validation.invalidCount}`);
  console.log(`Report file  : ${reportPath}`);

  if (failCount > 0 || validation.invalidCount > 0) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error('[benchmark-edge-tts-worker] ERROR');
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
