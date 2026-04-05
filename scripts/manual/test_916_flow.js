const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  renderVideoPreviewFrame,
  renderVideo,
  getVideoMetadata,
} = require('../../dist/main/src/main/services/caption/videoRenderer.js');

function hashText(input) {
  return crypto.createHash('sha1').update(String(input || '')).digest('hex');
}

function nowMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

async function timed(name, fn) {
  const start = nowMs();
  const result = await fn();
  const elapsedMs = nowMs() - start;
  return { name, elapsedMs, result };
}

function ensureSuccess(label, result) {
  if (!result || result.success !== true) {
    const error = result && result.error ? result.error : 'Unknown error';
    throw new Error(`${label} failed: ${error}`);
  }
}

function buildEntries() {
  return [
    {
      index: 1,
      startMs: 0,
      endMs: 2200,
      durationMs: 2200,
      startTime: '00:00:00,000',
      endTime: '00:00:02,200',
      text: 'Xin chao',
      translatedText: 'Xin chao',
    },
    {
      index: 2,
      startMs: 2200,
      endMs: 5000,
      durationMs: 2800,
      startTime: '00:00:02,200',
      endTime: '00:00:05,000',
      text: 'Kiem thu 9:16',
      translatedText: 'Kiem thu 9:16',
    },
  ];
}

async function main() {
  const cwd = process.cwd();
  const videoPath = path.resolve(cwd, 'test_output.mp4');
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Missing test video: ${videoPath}`);
  }

  const wavCandidates = fs
    .readdirSync(path.resolve(cwd, 'test_output'))
    .filter((file) => file.toLowerCase().endsWith('.wav'))
    .map((file) => path.resolve(cwd, 'test_output', file));
  if (wavCandidates.length === 0) {
    throw new Error('Missing test audio (.wav) in ./test_output');
  }
  const audioPath = wavCandidates[0];

  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'qa_916_flow_'));
  const srtPath = path.join(workDir, 'qa_916.srt');
  const renderOutPath = path.join(workDir, 'qa_916_step7.mp4');
  const entries = buildEntries();

  const srtContent = [
    '1',
    '00:00:00,000 --> 00:00:02,200',
    'Xin chao',
    '',
    '2',
    '00:00:02,200 --> 00:00:05,000',
    'Kiem thu 9:16',
    '',
  ].join('\n');
  await fsp.writeFile(srtPath, srtContent, 'utf8');

  const style = {
    fontName: 'Arial',
    fontSize: 52,
    fontColor: '#FFFFFF',
    shadow: 2,
    marginV: 56,
    alignment: 2,
  };

  const previewBase = {
    videoPath,
    entries,
    previewTimeSec: 1.2,
    style,
    renderMode: 'hardsub_portrait_9_16',
    renderResolution: '360p',
    position: { x: 0.5, y: 0.82 },
    blackoutTop: 0.82,
    coverMode: 'blackout_bottom',
    hardwareAcceleration: 'none',
    thumbnailText: 'Text1 QA',
    thumbnailTextSecondary: 'Text2 QA',
    thumbnailLineHeightRatio: 1.16,
    portraitTextPrimaryFontName: 'Arial',
    portraitTextPrimaryFontSize: 92,
    portraitTextPrimaryColor: '#00FF00',
    portraitTextSecondaryFontName: 'Arial',
    portraitTextSecondaryFontSize: 76,
    portraitTextSecondaryColor: '#FFFF00',
    portraitTextPrimaryPosition: { x: 0.5, y: 0.42 },
    portraitTextSecondaryPosition: { x: 0.5, y: 0.58 },
  };

  const preview1 = await timed('preview_miss', () => renderVideoPreviewFrame(previewBase));
  ensureSuccess('preview_miss', preview1.result);
  const hashPreview1 = hashText(preview1.result.frameData || '');

  const preview2 = await timed('preview_hit_same_payload', () => renderVideoPreviewFrame(previewBase));
  ensureSuccess('preview_hit_same_payload', preview2.result);
  const hashPreview2 = hashText(preview2.result.frameData || '');

  const previewDraggedT1 = await timed('preview_drag_text1', () =>
    renderVideoPreviewFrame({
      ...previewBase,
      portraitTextPrimaryPosition: { x: 0.66, y: 0.44 },
    })
  );
  ensureSuccess('preview_drag_text1', previewDraggedT1.result);
  const hashPreviewDraggedT1 = hashText(previewDraggedT1.result.frameData || '');

  const previewDraggedT2 = await timed('preview_drag_text2', () =>
    renderVideoPreviewFrame({
      ...previewBase,
      portraitTextPrimaryPosition: { x: 0.66, y: 0.44 },
      portraitTextSecondaryPosition: { x: 0.37, y: 0.62 },
    })
  );
  ensureSuccess('preview_drag_text2', previewDraggedT2.result);
  const hashPreviewDraggedT2 = hashText(previewDraggedT2.result.frameData || '');

  const renderRun = await timed('step7_render_916', () =>
    renderVideo(
      {
        srtPath,
        outputPath: renderOutPath,
        width: 1920,
        height: 1080,
        videoPath,
        audioPath,
        style,
        renderMode: 'hardsub_portrait_9_16',
        renderResolution: '360p',
        position: { x: 0.5, y: 0.82 },
        blackoutTop: 0.82,
        coverMode: 'blackout_bottom',
        hardwareAcceleration: 'none',
        thumbnailEnabled: false,
        thumbnailText: 'Text1 QA',
        thumbnailTextSecondary: 'Text2 QA',
        thumbnailLineHeightRatio: 1.16,
        portraitTextPrimaryFontName: 'Arial',
        portraitTextPrimaryFontSize: 92,
        portraitTextPrimaryColor: '#00FF00',
        portraitTextSecondaryFontName: 'Arial',
        portraitTextSecondaryFontSize: 76,
        portraitTextSecondaryColor: '#FFFF00',
        portraitTextPrimaryPosition: { x: 0.66, y: 0.44 },
        portraitTextSecondaryPosition: { x: 0.37, y: 0.62 },
        step7SubtitleSource: 'session_translated_entries',
        step7AudioSource: 'session_merged_audio',
      },
      () => undefined
    )
  );
  ensureSuccess('step7_render_916', renderRun.result);

  const outputStat = await fsp.stat(renderOutPath);
  const outputMeta = await getVideoMetadata(renderOutPath);
  const outputHash = hashText(await fsp.readFile(renderOutPath));

  const summary = {
    input: {
      videoPath,
      audioPath,
      srtPath,
      outputPath: renderOutPath,
      workDir,
    },
    preview: {
      missMs: preview1.elapsedMs,
      hitSamePayloadMs: preview2.elapsedMs,
      dragText1Ms: previewDraggedT1.elapsedMs,
      dragText2Ms: previewDraggedT2.elapsedMs,
      frameHash: {
        miss: hashPreview1,
        hitSamePayload: hashPreview2,
        dragText1: hashPreviewDraggedT1,
        dragText2: hashPreviewDraggedT2,
      },
      assertions: {
        samePayloadStableFrame: hashPreview1 === hashPreview2,
        dragText1ChangesFrame: hashPreview1 !== hashPreviewDraggedT1,
        dragText2ChangesFrame: hashPreviewDraggedT1 !== hashPreviewDraggedT2,
      },
    },
    step7: {
      renderMs: renderRun.elapsedMs,
      outputBytes: outputStat.size,
      outputHash,
      metadata: outputMeta,
    },
  };

  const reportPath = path.join(workDir, 'qa_916_report.json');
  await fsp.writeFile(reportPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log(JSON.stringify(summary, null, 2));
  console.log(`REPORT_PATH=${reportPath}`);
}

module.exports = { main };

if (require.main === module) {
  main().catch((error) => {
    console.error('QA 9:16 flow failed:', error);
    process.exitCode = 1;
  });
}
