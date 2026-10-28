// Video renderer for the agent-workspaces keynote.
// Usage: bun deck/video.mjs --out DIR [--workers N] [--scenes 1,5-9] [--fps 30] [--aspect 16x9|9x16|4x5] [--no-master] [--smoke]
// Renders silent and audio-slice variants for each scene. Muxes a full master if all scenes are present.
// Captures frames exactly as they render in capture mode.

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, existsSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, 'noop.js') : import.meta.url);
const { chromium } = req('playwright');
const argv = process.argv.slice(2), arg = (k, def) => { const i = argv.indexOf(k); return i < 0 ? def : (argv[i + 1] || def) };

const OUT = path.resolve(arg('--out', 'out')), WORKERS = +arg('--workers', '4'), FPS = +arg('--fps', '30');
const ASPECT = arg('--aspect', '16x9'), SCENES = arg('--scenes', ''), SMOKE = argv.includes('--smoke');
const NO_MASTER = argv.includes('--no-master');
const PROOF = argv.includes('--proof');
const CAPTIONS = arg('--captions', ASPECT === '16x9' ? 'none' : 'cwi');
mkdirSync(path.join(OUT, 'scenes'), { recursive: true });

const SAFE = {
  // 9x16 (1080x1920) for IG Reels/TikTok: top 250 px, bottom 480 px, left 64 px, right 150 px (right action rail)
  '9x16': { t: 250, b: 480, l: 64, r: 150 },
  // 4x5 (1080x1350) for feeds: 60 px on every side
  '4x5': { t: 60, b: 60, l: 60, r: 60 }
};

let manifest = { "default": { "mode": "full" } };
if (existsSync(path.join(here, 'vertical.json'))) {
  manifest = JSON.parse(readFileSync(path.join(here, 'vertical.json'), 'utf8'));
}

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

// render settings are part of a clip's name, so a run with other settings never reuses stale clips
const SFX = (ASPECT === '16x9' ? '' : `-${ASPECT}`) + (FPS === 30 ? '' : `-${FPS}fps`);
const clip = (c, tail = '') => path.join(OUT, 'scenes', `s${String(c.scene).padStart(2, '0')}-${c.id}${SFX}${tail}.mp4`);
queue = queue.filter(c => !existsSync(clip(c)));
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
    const silent = clip(c, '-silent'), pSil = silent.replace('.mp4', '.part.mp4');
    
    const vf = [];
    let assP = null;
    if (ASPECT !== '16x9') {
      const W = 1080, H = ASPECT === '9x16' ? 1920 : 1350, tall = ASPECT === '9x16';
      const S = SAFE[ASPECT];
      const SW = W - S.l - S.r;
      const SH = H - S.t - S.b;
      const CAP_H = tall ? 230 : 150;
      const SLOTS_H = SH - CAP_H;
      const SLOTS_Y = S.t;

      const layout = manifest[c.id] || manifest['default'];
      const esc = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\u2019").replace(/:/g, '\\:').replace(/%/g, '\\%');
      const font = f => path.join(here, 'fonts', f).replace(/\\/g, '/');
      const nText = `${String(c.scene).padStart(2, '0')}/${data.chapters.length}`;
      const drawN = `drawtext=fontfile='${font('JetBrainsMono-400.woff2')}':text='${esc(nText)}':fontcolor=0x5AA0FF:fontsize=${tall ? 30 : 24}:x=${S.l}:y=${S.t}:box=1:boxcolor=0x050B1A@0.8:boxborderw=10`;
      let overlayGraph = '';
      let seamBottom = H - S.b; // fallback
      
      if (layout.mode === 'full') {
        const SLOTS_H = SH - CAP_H;
        const SLOTS_Y = S.t;
        const scale = Math.min(SW / 1920, SLOTS_H / 1080);
        const outW = Math.round(1920 * scale);
        const outH = Math.round(1080 * scale);
        const outX = S.l + Math.round((SW - outW) / 2);
        const outY = SLOTS_Y + Math.round((SLOTS_H - outH) / 2);
        vf.push(`[0:v]split=2[bg_in][v_in]`);
        vf.push(`[bg_in]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=40:10,drawbox=x=0:y=0:w=${W}:h=${H}:color=0x050B1A@0.72:t=fill[bg]`);
        vf.push(`[v_in]scale=${outW}:${outH}[v_scaled]`);
        overlayGraph = `[bg][v_scaled]overlay=${outX}:${outY}[comp]`;
        seamBottom = outY + outH;
      } else {
        const [vx, vy, vw, vh] = layout.visual;
        const [tx, ty, tw, th] = layout.text;
        
        const visY = tall ? 140 : 40;
        const textBottom = H - S.b;
        const minVisSlotH = tall ? 520 : 360;
        const maxTextW = W - S.l - S.r; // 866 for 9x16
        
        const sW = maxTextW / tw;
        let visSlotH = textBottom - (th * sW) - visY;
        visSlotH = Math.max(minVisSlotH, visSlotH);
        
        const visBottom = visY + visSlotH;
        const textSlotH = textBottom - visBottom;
        
        const tScale = Math.min(maxTextW / tw, textSlotH / th);
        if (tScale < 0.8) {
           console.log(`[info] scene ${sn}-${c.id} text scale is ${tScale.toFixed(2)} (below 0.8)`);
        }
        
        const vScale = Math.min(W / vw, visSlotH / vh);
        const vOutW = Math.round(vw * vScale) || 2;
        const vOutH = Math.round(vh * vScale) || 2;
        const vOutX = Math.round((W - vOutW) / 2);
        const vOutY = visY + Math.round((visSlotH - vOutH) / 2);
        
        const tOutW = Math.round(tw * tScale) || 2;
        const tOutH = Math.round(th * tScale) || 2;
        const tOutX = S.l + Math.round((maxTextW - tOutW) / 2);
        const tOutY = visBottom;
        
        seamBottom = visBottom;
        
        vf.push(`[0:v]split=3[bg_in][v_in][t_in]`);
        vf.push(`[bg_in]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=40:10,drawbox=x=0:y=0:w=${W}:h=${H}:color=0x050B1A@0.72:t=fill[bg]`);
        vf.push(`[v_in]crop=${vw}:${vh}:${vx}:${vy},scale=${vOutW}:${vOutH}[v_scaled]`);
        vf.push(`[t_in]crop=${tw}:${th}:${tx}:${ty},scale=${tOutW}:${tOutH}[t_scaled]`);
        vf.push(`[bg][v_scaled]overlay=${vOutX}:${vOutY}[bg_v]`);
        overlayGraph = `[bg_v][t_scaled]overlay=${tOutX}:${tOutY}[comp]`;
      }

            let cwiSuccess = false;
      if (CAPTIONS !== 'none') {
        assP = path.join(OUT, 'scenes', `s${sn}-${c.id}-${ASPECT}.ass`);
        if (CAPTIONS === 'cwi') {
          const cwiJson = path.join(OUT, 'scenes', `s${sn}-${c.id}.cwi.json`);
          const audioFile = path.join(here, data.audio);
          const refTextFile = path.join(OUT, 'scenes', `s${sn}-${c.id}.ref.txt`);
          
          const refLines = data.captions.filter(cap => cap[1] > c.start && cap[0] < c.end).map(cap => cap[2]);
          writeFileSync(refTextFile, refLines.join(' '));
          
          const aSlice = path.join(OUT, 'scenes', `s${sn}-${c.id}.mp3`);
          if (!existsSync(aSlice)) {
            spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', audioFile, '-ss', String(c.start), '-t', String(c.end - c.start), '-c:a', 'copy', aSlice]);
          }
          
          const ocDir = process.env.OPENCAPTIONS_DIR || path.join(here, '..', '..', 'apps', 'opencaptions');
          const ocBin = existsSync(path.join(ocDir, 'packages/cli/src/index.ts')) 
            ? ['bun', 'run', path.join(ocDir, 'packages/cli/src/index.ts')] 
            : ['opencaptions'];

          try {
            if (!existsSync(cwiJson)) {
              const rGen = spawnSync(ocBin[0], [...ocBin.slice(1), 'generate', aSlice, '--reference-text', refTextFile, '--output', cwiJson]);
              if (rGen.status !== 0) throw new Error('cwi generate failed');
            }
            const rExp = spawnSync(ocBin[0], [...ocBin.slice(1), 'export', cwiJson, '--format', 'ass', '--width', String(W), '--height', String(H), '--font', 'Roboto Flex', '--font-size', '62', '--margin-l', String(S.l), '--margin-r', String(S.r), '--margin-v', String(H - seamBottom), '--max-chars', '22', '--box', '--output', assP]);
            if (rExp.status !== 0) throw new Error('cwi export failed');
            cwiSuccess = true;
          } catch (e) {
            console.warn(`[warning] cwi captions failed for scene ${c.id}, falling back to plain ASS`);
          }
        }
        
        if (!cwiSuccess) {
          const assT = s => { const ms = Math.max(0, Math.round(s * 100)); return `${Math.floor(ms / 360000)}:${String(Math.floor(ms / 6000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 100) % 60).padStart(2, '0')}.${String(ms % 100).padStart(2, '0')}` };
          const lines = data.captions.filter(cap => cap[1] > c.start && cap[0] < c.end).map(cap =>
            `Dialogue: 0,${assT(Math.max(0, cap[0] - c.start))},${assT(Math.min(c.end, cap[1]) - c.start)},Cap,,0,0,0,,${cap[2].replace(/[{}\\]/g, '').replace(/\n/g, ' ')}`);
          writeFileSync(assP, `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 0\n\n[V4+ Styles]\n` +
            'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n' +
            `Style: Cap,Inter,${tall ? 60 : 46},&H00FFFFFF,&H00FFFFFF,&H00180B05,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,${S.l},${S.r},${H - seamBottom},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${lines.join('\n')}\n`);
        }
      }

      let nextStep = '[comp]';
      vf.push(overlayGraph);
      if (PROOF) {
         vf.push(`[comp]drawbox=x=0:y=0:w=${W}:h=${S.t}:color=red@0.3:t=fill,drawbox=x=0:y=${H-S.b}:w=${W}:h=${S.b}:color=red@0.3:t=fill,drawbox=x=0:y=${S.t}:w=${S.l}:h=${SH}:color=red@0.3:t=fill,drawbox=x=${W-S.r}:y=${S.t}:w=${S.r}:h=${SH}:color=red@0.3:t=fill[comp_proof]`);
         nextStep = '[comp_proof]';
      }
      
      vf.push(`${nextStep}${drawN}[comp2]`);
      if (assP && !PROOF) {
        vf.push(`[comp2]ass=filename='${assP.replace(/\\/g, '/')}':fontsdir='${path.join(here, 'fonts').replace(/\\/g, '/')}'[comp3]`);
      }
    }

    if (PROOF) {
      const proofImg = clip(c, '-proof').replace('.mp4', '.png');
      const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-'];
      if (vf.length) {
         args.push('-filter_complex', vf.join(';'));
         args.push('-map', '[comp2]');
      }
      args.push('-frames:v', '1', proofImg);
      const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
      const done = new Promise((ok, ko) => ff.on('close', code => code ? ko(new Error('ffmpeg ' + code)) : ok()));
      await page.evaluate(t => window.__adv(t), (f1 - f0) / FPS);
      const buf = await page.screenshot({ type: 'jpeg', quality: 93 });
      ff.stdin.write(buf);
      ff.stdin.end(); await done;
      console.log(`Proof s${sn}-${c.id} generated at ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      continue;
    }

    const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-'];
    if (vf.length) {
       args.push('-filter_complex', vf.join(';'));
       args.push('-map', assP && !PROOF ? '[comp3]' : '[comp2]');
    }
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

    const final = clip(c), pFin = final.replace('.mp4', '.part.mp4');
    const aArgs = ['-y', '-loglevel', 'error', '-i', silent, '-ss', String(c.start), '-t', String(c.end - c.start), 
      '-i', path.join(here, data.audio), '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', pFin];
    const fa = spawn('ffmpeg', aArgs, { stdio: ['ignore', 'inherit', 'inherit'] });
    await new Promise((ok, ko) => fa.on('close', code => code ? ko(new Error('ffmpeg a ' + code)) : ok()));
    renameSync(pFin, final);
    console.log(`s${sn}-${c.id} ${f1 - f0} frames at ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await page.close();
}

await Promise.all(Array.from({ length: WORKERS }, work));
await b.close();

if (PROOF && ASPECT === '9x16') {
  const proofs = ch.map(c => clip(c, '-proof').replace('.mp4', '.png')).filter(existsSync);
  if (proofs.length) {
    const listPath = path.join(OUT, 'proofs.txt');
    writeFileSync(listPath, proofs.map(p => `file '${p}'\n`).join(''));
    const csPath = path.join(OUT, 'contact-sheet.png');
    // tile=8x5 layout
    const args = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-vf', 'tile=8x5', csPath];
    const fp = spawnSync('ffmpeg', args);
    if (fp.status === 0) console.log(`Contact sheet generated at ${csPath}`);
    else console.error('Failed to generate contact sheet', fp.stderr?.toString());
  }
}

if (!NO_MASTER && !SCENES && !SMOKE && ASPECT === '16x9') {
  if (ch.every(c => existsSync(clip(c, '-silent')))) {
    const list = path.join(OUT, 'concat.txt');
    writeFileSync(list, ch.map(c => `file '${clip(c, '-silent')}'\n`).join(''));
    const mast = path.join(OUT, 'agent-workspaces-keynote.mp4'), pMast = mast.replace('.mp4', '.part.mp4');
    const mArgs = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-i', path.join(here, data.audio),
      '-i', path.join(OUT, 'chapters.txt'), '-i', path.join(OUT, 'agent-workspaces-keynote.srt'),
      '-map', '0:v', '-map', '1:a', '-map', '3:s', '-map_metadata', '2', '-map_chapters', '2', '-metadata:s:s:0', 'language=eng', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-c:s', 'mov_text',
      '-metadata', 'title=Agent Workspaces — The workspace is the product', '-metadata', `comment=${data.disclosure}`, '-movflags', '+faststart', pMast];
    const fm = spawn('ffmpeg', mArgs, { stdio: ['ignore', 'inherit', 'inherit'] });
    await new Promise((ok, ko) => fm.on('close', code => code ? ko(new Error('ffmpeg m ' + code)) : ok()));
    renameSync(pMast, mast);
    console.log('Master done');
  }
}
