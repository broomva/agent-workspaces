// v2 mode of reels/render.mjs (Act I v2, BRO-3825). render.mjs calls this for a reel listed in series.json
// `v2.parts` with spoken lines; it is not run on its own.
//
//   0 ── take (hook + body, one River take) ── excerpt hold (silent) ── shared CTA ── end hold ── total_dur
//
// 1. `tts.mjs --v2 --reel <id> --offline` rebuilds the timeline (audio/v2/<id>.timeline.json/.js) from series.json v2
//    and the cached River lines; it refuses any line whose receipt does not vouch for the request, the MP3 and the
//    alignment, and restores a missing v2 MP3 from the content-flow media store by its receipt digest.
// 2. The soundtrack is the take, then silence for the excerpt hold, then the shared CTA, then silence for the end hold,
//    each resampled to one format and padded or trimmed to the duration the timeline declares, so audio and picture
//    share one timeline to the sample.
// 3. Frames are window.renderAt(t) screenshots of reels/<id>.html with window.REEL_V2 injected before the page loads.
//    Captions are drawn by the page, word by word, from the alignment's CWI-shaped events (no OpenCaptions pass).
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function renderV2({ id, here, OUT, FPS, STILL, SAFE, safeCss, chromium, run }) {
  process.stdout.write(run('bun', [path.join(here, 'tts.mjs'), '--v2', '--reel', id, '--offline']));
  const A = path.join(here, 'audio'), T = JSON.parse(readFileSync(path.join(A, 'v2', `${id}.timeline.json`), 'utf8'));
  const N = Math.round(T.total_dur * FPS);

  const mux = path.join(OUT, `${id}.m4a`), silence = d => ['-f', 'lavfi', '-t', String(d), '-i', 'anullsrc=r=44100:cl=mono'];
  const segs = [T.take.dur, T.excerpt.hold, T.cta.dur, T.end.hold];
  const filter = segs.map((d, i) => `[${i}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=mono,apad,atrim=0:${d},asetpts=N/SR/TB[a${i}]`).join(';')
    + `;${segs.map((_, i) => `[a${i}]`).join('')}concat=n=${segs.length}:v=0:a=1[out]`;
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(A, T.take.audio), ...silence(T.excerpt.hold), '-i', path.join(A, T.cta.audio),
    ...silence(T.end.hold), '-filter_complex', filter, '-map', '[out]', '-c:a', 'aac', '-b:a', '192k', mux]);

  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  page.on('pageerror', e => console.error('[page error]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('[console]', m.text()) });
  await page.addInitScript({ content: readFileSync(path.join(A, 'v2', `${id}.timeline.js`), 'utf8') });
  await page.goto(`${pathToFileURL(path.join(here, `${id}.html`)).href}?t=0`);
  await page.waitForFunction(() => window.__ready === true);
  if (SAFE) await page.addStyleTag({ content: safeCss });
  if (STILL !== null) {
    await page.evaluate(t => window.renderAt(t), STILL);
    const png = path.join(OUT, `${id}-t${STILL.toFixed(1)}${SAFE ? '-safe' : ''}.png`);
    writeFileSync(png, await page.screenshot({ type: 'png' }));
    console.log(png);
  } else {
    const mp4 = path.join(OUT, `${id}${SAFE ? '-safe' : ''}.mp4`), part = path.join(OUT, `${id}.part.mp4`), t0 = Date.now();
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-i', mux,
      '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-c:a', 'copy', '-metadata', `comment=${T.disclosure}`, '-movflags', '+faststart', '-f', 'mp4', part], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((ok, ko) => ff.on('close', c => c ? ko(new Error(`ffmpeg ${c}`)) : ok()));
    for (let f = 0; f < N; f++) {
      await page.evaluate(t => window.renderAt(t), f / FPS);
      const buf = await page.screenshot({ type: 'jpeg', quality: 94 });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (f % 300 === 0) console.log(`${id} ${f}/${N} frames`);
    }
    ff.stdin.end(); await done;
    copyFileSync(part, mp4);                              // a killed run never leaves a half file under the final name
    const hex = createHash('sha256').update(readFileSync(mp4)).digest('hex');
    console.log(`${mp4} · ${N} frames · ${T.total_dur}s · sha256:${hex} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await b.close();
}
