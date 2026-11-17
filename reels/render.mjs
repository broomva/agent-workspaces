// Renders a vertical-native reel (1080x1920) from reels/<id>.html.
// Usage: bun reels/render.mjs <id> [--out DIR] [--fps 30] [--still SECONDS] [--safe] [--ass] [--recaption]
//   --still writes one PNG at that time instead of the video; --safe overlays the IG/TikTok unsafe areas;
//   --ass burns OpenCaptions' ASS export instead of the in-page captions (fallback path);
//   --recaption regenerates the CWI document even if reels/captions/<id>.cwi.json exists.
// Series mode (BRO-3817) switches on when reels/audio/<id>.series.json exists (written by reels/tts.mjs): the reel becomes
// spoken hook + 0.25 s gap + keynote slice + spoken CTA + end-card hold. The page gets window.SERIES before it loads
// and reels/series-overlay.js draws the cold open and the end card and maps the reel's own renderAt to body time.
// Without that file a reel renders exactly as before.
// Frames are window.renderAt(t) screenshots. Narration is a slice of the keynote audio. Captions are
// OpenCaptions (Caption with Intention) documents: generated once, stored in reels/captions/ (json + a
// script the page loads), and drawn by the page itself, word by word (content-engine opencaptions skill,
// CWI-Remotion bridge). Needs ffmpeg and a built opencaptions checkout (OPENCAPTIONS_DIR, default
// ../apps/opencaptions next to this repo; run `bunx turbo build` there).

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.dirname(here);
const req = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, 'noop.js') : import.meta.url);
const { chromium } = req('playwright');
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : (argv[i + 1] ?? d) };
const ID = argv[0];
if (!ID || ID.startsWith('--')) { console.error('usage: bun reels/render.mjs <id> [--out DIR] [--fps 30] [--still S] [--safe] [--ass] [--recaption]'); process.exit(2) }
const OUT = path.resolve(arg('--out', path.join('out', 'reels'))), FPS = +arg('--fps', '30');
const STILL = argv.includes('--still') ? +arg('--still', '0') : null, SAFE = argv.includes('--safe'), ASS = argv.includes('--ass');
mkdirSync(OUT, { recursive: true });
const run = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); if (r.status) throw new Error(`${cmd} failed: ${r.stderr || r.stdout}`); return r.stdout };

const htmlPath = path.join(here, `${ID}.html`);
const reel = JSON.parse(readFileSync(htmlPath, 'utf8').match(/<script id="reel-data"[^>]*>([\s\S]*?)<\/script>/)[1]);
const { start, end } = reel.audio, dur = end - start;
const seriesJson = path.join(here, 'audio', `${ID}.series.json`), SERIES = existsSync(seriesJson) ? JSON.parse(readFileSync(seriesJson, 'utf8')) : null;
if (SERIES && (Math.abs(SERIES.body.start - start) > 1e-3 || Math.abs(SERIES.body.end - end) > 1e-3))
  throw new Error(`${ID}: series body ${SERIES.body.start}-${SERIES.body.end} differs from the reel's audio ${start}-${end}; rerun bun reels/tts.mjs --reel ${ID}`);
const N = Math.round((SERIES ? SERIES.total_dur : dur) * FPS);

// 1. Narration slice.
const audio = path.join(OUT, `${ID}.m4a`);
if (!existsSync(audio)) run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(start), '-t', String(dur), '-i', path.resolve(here, reel.audio.src), '-c:a', 'aac', '-b:a', '192k', audio]);

// 1b. Series audio: hook, gap, the same keynote slice, CTA, hold. Every segment is resampled to one format and padded or
// trimmed to the duration series.json declares, so the soundtrack and the overlay share one timeline to the sample.
let mux = audio;
if (SERIES) {
  mux = path.join(OUT, `${ID}.series.m4a`);
  const A = path.join(here, 'audio'), silence = d => ['-f', 'lavfi', '-t', String(d), '-i', 'anullsrc=r=44100:cl=mono'];
  const segs = [SERIES.hook.dur, SERIES.gap, SERIES.body.dur, SERIES.cta.dur, SERIES.hold];
  const filter = segs.map((d, i) => `[${i}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=mono,apad,atrim=0:${d},asetpts=N/SR/TB[a${i}]`).join(';')
    + `;${segs.map((_, i) => `[a${i}]`).join('')}concat=n=${segs.length}:v=0:a=1[out]`;
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(A, SERIES.hook.audio), ...silence(SERIES.gap),
    '-ss', String(start), '-t', String(dur), '-i', path.resolve(here, reel.audio.src), '-i', path.join(A, SERIES.cta.audio), ...silence(SERIES.hold),
    '-filter_complex', filter, '-map', '[out]', '-c:a', 'aac', '-b:a', '192k', mux]);
}

// 2. CWI captions, generated once with the script as reference text, kept in the repo with the reel.
const capDir = path.join(here, 'captions'), cwi = path.join(capDir, `${ID}.cwi.json`);
mkdirSync(capDir, { recursive: true });
const ocDir = process.env.OPENCAPTIONS_DIR || path.join(root, '..', 'apps', 'opencaptions');
const oc = (...a) => run('bun', ['run', path.join(ocDir, 'packages/cli/src/index.ts'), ...a]);
if (!existsSync(cwi) || argv.includes('--recaption')) {
  const html = readFileSync(path.join(root, 'deck', 'index.html'), 'utf8');
  const nar = JSON.parse(html.match(/<script[^>]*id="narration-data"[^>]*>([\s\S]*?)<\/script>/)[1]);
  const ref = path.join(OUT, `${ID}.ref.txt`);
  writeFileSync(ref, nar.captions.filter(c => c[0] >= start - 0.05 && c[1] <= end + 0.05).map(c => c[2]).join(' '));
  oc('generate', audio, '--reference-text', ref, '--output', cwi);
}
// report the CWI validation (12 rules, three pillars); a failing pillar is printed, not fatal
const val = spawnSync('bun', ['run', path.join(ocDir, 'packages/cli/src/index.ts'), 'validate', cwi], { encoding: 'utf8' });
console.log((val.stdout || '').split('\n').filter(l => /Overall|Attribution|Synchronization|Intonation/.test(l)).join('\n'));
writeFileSync(path.join(capDir, `${ID}.cwi.js`), `// GENERATED by reels/render.mjs from ${ID}.cwi.json (OpenCaptions). Do not edit.\nwindow.CWI=${readFileSync(cwi, 'utf8').trim()};\n`);

let vf = null;
if (ASS) {
  const cap = reel.captions, ass = path.join(OUT, `${ID}.ass`);
  oc('export', cwi, '--format', 'ass', '--width', '1080', '--height', '1920', '--font', cap.font, '--font-size', String(cap.size),
    '--max-chars', String(cap.maxChars), '--margin-l', String(cap.marginL), '--margin-r', String(cap.marginR),
    '--margin-v', String(cap.marginV), '--box', '--output', ass);
  vf = `ass=filename='${ass}':fontsdir='${path.join(root, 'deck', 'fonts')}'`;
  if (SERIES) vf = `setpts=PTS-${SERIES.body.at}/TB,${vf},setpts=PTS+${SERIES.body.at}/TB`;  // the CWI timeline is body time
}

// 3. Frames → ffmpeg.
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1080, height: 1920 } });
page.on('pageerror', e => console.error('[page error]', e.message));
page.on('console', m => { if (m.type() === 'error') console.error('[console]', m.text()) });
if (SERIES) await page.addInitScript({ content: readFileSync(path.join(here, 'audio', `${ID}.series.js`), 'utf8') });
await page.goto(`${pathToFileURL(htmlPath).href}?t=0${ASS ? '&captions=off' : ''}`);
await page.waitForFunction(() => window.__ready === true);
if (SERIES) {                                           // a part that does not load the overlay itself still gets it
  if (!(await page.evaluate(() => !!window.SERIES_OVERLAY))) await page.addScriptTag({ path: path.join(here, 'series-overlay.js') });
  await page.evaluate(() => window.SERIES_OVERLAY.ready);
}

// Safe-zone overlay for proofs: the content-engine 9:16 contract (reels-organic), safe zone x 143-938, y 277-1643.
const safeCss = 'body::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:99;' +
  'border-style:solid;border-color:rgba(255,40,40,.32);border-width:277px 142px 277px 143px}';

if (STILL !== null) {
  if (SAFE) await page.addStyleTag({ content: safeCss });
  await page.evaluate(t => window.renderAt(t), STILL);
  const png = path.join(OUT, `${ID}-t${STILL.toFixed(1)}${SAFE ? '-safe' : ''}.png`);
  const shot = await page.screenshot({ type: 'png' });
  if (vf) {
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-i', '-', '-vf', `setpts=PTS+${STILL}/TB,${vf}`, '-frames:v', '1', png], { stdio: ['pipe', 'inherit', 'inherit'] });
    ff.stdin.end(shot); await new Promise((ok, ko) => ff.on('close', c => c ? ko(new Error('ffmpeg ' + c)) : ok()));
  } else writeFileSync(png, shot);
  console.log(png);
} else {
  const mp4 = path.join(OUT, `${ID}.mp4`), part = path.join(OUT, `${ID}.part.mp4`), t0 = Date.now();
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-i', mux,
    '-map', '0:v', '-map', '1:a', ...(vf ? ['-vf', vf] : []), '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'copy', '-metadata', `comment=${reel.disclosure}`, '-movflags', '+faststart', '-f', 'mp4', part], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((ok, ko) => ff.on('close', c => c ? ko(new Error('ffmpeg ' + c)) : ok()));
  for (let f = 0; f < N; f++) {
    await page.evaluate(t => window.renderAt(t), f / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 94 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 300 === 0) console.log(`${ID} ${f}/${N} frames`);
  }
  ff.stdin.end(); await done;
  copyFileSync(part, mp4);                              // write to a part file first: a killed run never leaves a half file under the final name
  console.log(`${mp4} · ${N} frames · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await b.close();
