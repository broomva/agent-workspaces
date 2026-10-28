// Video renderer for the agent-workspaces keynote.
// Usage: bun deck/video.mjs --out DIR [--workers N] [--scenes 1,5-9] [--fps 30] [--aspect 16x9|9x16|4x5] [--no-master] [--smoke]
// Renders silent and audio-slice variants for each scene. Muxes a full master if all scenes are present.
// Captures frames exactly as they render in capture mode.

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, 'noop.js') : import.meta.url);
const { chromium } = req('playwright');
const argv = process.argv.slice(2), arg = (k, def) => { const i = argv.indexOf(k); return i < 0 ? def : (argv[i + 1] || def) };

const OUT = path.resolve(arg('--out', 'out')), WORKERS = +arg('--workers', '4'), FPS = +arg('--fps', '30');
const ASPECT = arg('--aspect', '16x9'), SCENES = arg('--scenes', ''), SMOKE = argv.includes('--smoke');
const NO_MASTER = argv.includes('--no-master');
mkdirSync(path.join(OUT, 'scenes'), { recursive: true });

const deck = pathToFileURL(path.join(here, 'index.html')).href;
const b = await chromium.launch({ args: ['--disable-gpu-vsync'] });
const p0 = await b.newPage();
await p0.goto(deck + '?t=0#scene=1');
await p0.waitForFunction(() => window.__ready === true);
const data = await p0.evaluate(() => JSON.parse(document.querySelector('#narration-data').textContent));
await p0.close();

writeFileSync(path.join(OUT, 'narration.json'), JSON.stringify(data, null, 2));
const ch = data.chapters.map((c, i) => ({ i, scene: c.scene, id: c.id, title: c.title, start: c.startSeconds,
  end: i + 1 < data.chapters.length ? data.chapters[i + 1].startSeconds : data.duration, cues: c.cues }));

const ts = s => {
  const ms = Math.round(s * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};

if (!SMOKE) {
  const srt = data.captions.map((c, i) => `${i + 1}\n${ts(c[0])} --> ${ts(c[1])}\n${c[2]}\n`).join('\n');
  writeFileSync(path.join(OUT, 'agent-workspaces-keynote.srt'), srt);
  const chTxt = ';FFMETADATA1\n' + ch.map((c, i) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(c.start * 1000)}\nEND=${Math.round(c.end * 1000)}\ntitle=${String(c.scene).padStart(2, '0')} · ${c.title}\n`).join('');
  writeFileSync(path.join(OUT, 'chapters.txt'), chTxt);
  const ytTxt = ch.map(c => `${Math.floor(c.start / 60)}:${String(Math.floor(c.start) % 60).padStart(2, '0')} ${c.title}\n`).join('');
  writeFileSync(path.join(OUT, 'youtube-chapters.txt'), ytTxt);
}

let queue = ch;
if (SCENES) {
  const sel = new Set();
  SCENES.split(',').forEach(p => {
    if (p.includes('-')) { const [a, b] = p.split('-').map(Number); for (let i = a; i <= b; i++) sel.add(i); }
    else sel.add(Number(p));
  });
  queue = queue.filter(c => sel.has(c.scene));
} else if (SMOKE) {
  queue = [ch.find(c => c.scene === 4) || ch[0]];
}

queue = queue.filter(c => !existsSync(path.join(OUT, 'scenes', `s${String(c.scene).padStart(2, '0')}-${c.id}.mp4`)));
const t0 = Date.now();

async function work() {
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  while (queue.length) {
    const c = queue.shift(), f0 = Math.round(c.start * FPS), f1 = Math.round(c.end * FPS);
    await page.goto('about:blank'); await page.goto(`${deck}?t=0#scene=${c.scene}`);
    await page.waitForFunction(() => window.__ready === true);
    await page.evaluate(cues => {
      window.__cues = cues; simReset(captureScene());
      window.__adv = function(t) {
        const i = simScene, n = Math.max(0, Math.round(t * 60));
        while (simN < n) {
          const lt = simN / 60; let bt = 0;
          for (const q of window.__cues) if (q.at <= lt + 1e-4) bt = q.beat;
          if (bt !== step) go(i, bt, true);
          T0 += 1 / 60; NOW += 1 / 60; domFrame(1 / 60); paint(1 / 60); simN++;
        }
        bgDraw(T0); rebuild();
      }
    }, c.cues);
    const sn = String(c.scene).padStart(2, '0');
    const silent = path.join(OUT, 'scenes', `s${sn}-${c.id}-silent.mp4`), pSil = silent.replace('.mp4', '.part.mp4');
    
    const vf = [];
    if (ASPECT !== '16x9') {
      const W = 1080, H = ASPECT === '9x16' ? 1920 : 1350;
      const sCaptions = data.captions.filter(cap => cap[1] > c.start && cap[0] < c.end).map((cap, i) => 
        `${i + 1}\n${ts(Math.max(0, cap[0] - c.start))} --> ${ts(Math.min(c.end - c.start, cap[1] - c.start))}\n${cap[2]}\n`).join('\n');
      const srtP = path.join(OUT, 'scenes', `s${sn}-${c.id}.srt`);
      writeFileSync(srtP, sCaptions + '\n');
      const esc = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
      vf.push(`split=2[bg][fg]`);
      vf.push(`[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=40:10,drawbox=x=0:y=0:w=${W}:h=${H}:color=black@0.6:t=fill[bg2]`);
      vf.push(`[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg2]`);
      vf.push(`[bg2][fg2]overlay=(W-w)/2:(H-h)/2[comp]`);
      const fontFile = path.join(here, 'fonts', 'Raleway-300.woff2').replace(/\\/g, '/');
      vf.push(`[comp]drawtext=fontfile='${fontFile}':text='${esc(c.title)}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=120[comp2]`);
      const fontsDir = path.join(here, 'fonts').replace(/\\/g, '/');
      vf.push(`[comp2]subtitles=filename='${srtP.replace(/\\/g, '/')}':fontsdir='${fontsDir}':force_style='Fontname=Inter\\,Fontsize=26\\,Alignment=2\\,MarginV=120'`);
    }

    const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-'];
    if (vf.length) args.push('-vf', vf.join(';'));
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS), pSil);
    
    const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((ok, ko) => ff.on('close', code => code ? ko(new Error('ffmpeg ' + code)) : ok()));
    for (let f = f0; f < f1; f++) {
      await page.evaluate(t => window.__adv(t), (f - f0) / FPS);
      const buf = await page.screenshot({ type: 'jpeg', quality: 93 });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    }
    ff.stdin.end(); await done;
    renameSync(pSil, silent);

    const final = path.join(OUT, 'scenes', `s${sn}-${c.id}.mp4`), pFin = final.replace('.mp4', '.part.mp4');
    const aArgs = ['-y', '-loglevel', 'error', '-i', silent, '-ss', String(c.start), '-t', String(c.end - c.start), 
      '-i', path.join(here, data.audio), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', pFin];
    const fa = spawn('ffmpeg', aArgs, { stdio: ['ignore', 'inherit', 'inherit'] });
    await new Promise((ok, ko) => fa.on('close', code => code ? ko(new Error('ffmpeg a ' + code)) : ok()));
    renameSync(pFin, final);
    console.log(`s${sn}-${c.id} ${f1 - f0} frames at ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await page.close();
}

await Promise.all(Array.from({ length: WORKERS }, work));
await b.close();

if (!NO_MASTER && !SCENES && !SMOKE) {
  if (ch.every(c => existsSync(path.join(OUT, 'scenes', `s${String(c.scene).padStart(2, '0')}-${c.id}-silent.mp4`)))) {
    const list = path.join(OUT, 'concat.txt');
    writeFileSync(list, ch.map(c => `file 'scenes/s${String(c.scene).padStart(2, '0')}-${c.id}-silent.mp4'\n`).join(''));
    const mast = path.join(OUT, 'agent-workspaces-keynote.mp4'), pMast = mast.replace('.mp4', '.part.mp4');
    const mArgs = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-i', path.join(here, data.audio),
      '-i', path.join(OUT, 'chapters.txt'), '-i', path.join(OUT, 'agent-workspaces-keynote.srt'),
      '-map_metadata', '2', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-c:s', 'mov_text',
      '-metadata', 'title=Agent Workspaces', '-metadata', `comment=${data.disclosure}`, '-movflags', '+faststart', pMast];
    const fm = spawn('ffmpeg', mArgs, { stdio: ['ignore', 'inherit', 'inherit'] });
    await new Promise((ok, ko) => fm.on('close', code => code ? ko(new Error('ffmpeg m ' + code)) : ok()));
    renameSync(pMast, mast);
    console.log('Master done');
  }
}
