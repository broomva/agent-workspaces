// Smoke for deck/video.mjs: renders scene 4 (a ~12 s break) at 16:9 and 9:16 into a temp dir and checks each
// clip against the narration timing: frames = chapter length × fps (±1), audio slice = video length (±0.05 s).
// Needs ffmpeg/ffprobe with libass and libx264. Usage: bun deck/video-smoke.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), FPS = 30;
const OUT = mkdtempSync(path.join(os.tmpdir(), 'aw-video-smoke-'));
const fail = m => { console.error(m); console.error(`(output kept in ${OUT})`); process.exit(1) };
const pr = spawnSync('bun', [path.join(here, 'video.mjs'), '--proof', '--scenes', '2,4', '--workers', '1', '--aspect', '9x16', '--out', OUT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
if (pr.stdout) process.stdout.write(pr.stdout);
if (pr.status !== 0) fail('renderer failed (9x16 proof)');
for (const f of ['s02-thesis-9x16-proof.png', 's04-brk1-9x16-proof.png']) {
  if (!existsSync(path.join(OUT, 'scenes', f))) fail(`9x16 proof: missing ${f}`);
}
if (existsSync(path.join(OUT, 'scenes', 's02-thesis-9x16.ass')) || existsSync(path.join(OUT, 'scenes', 's04-brk1-9x16.ass')) || existsSync(path.join(OUT, 'scenes', 's04-brk1.mp3'))) {
  fail('9x16 proof: unexpected caption/audio artifacts');
}
const m = pr.stdout.match(/Proof s02-thesis [^\n]*\[vis:(\d+),(\d+),(\d+),(\d+) text:(\d+),(\d+),(\d+),(\d+) cap:(\d+),(\d+),(\d+),(\d+)\]/);
if (!m) fail('9x16 proof: missing s02-thesis split-scene bounds');
const [vx, vy, vw, vh, tx, ty, tw, th, cx, cy, cw, chBox] = m.slice(1).map(Number);
if (vx < 64 || vy < 250 || vx + vw > 930 || vy + vh > ty) fail(`9x16 split visual outside safe area: [${vx},${vy},${vw},${vh}]`);
if (tx < 64 || ty < vy + vh || tx + tw > 930 || ty + th > cy) fail(`9x16 split text outside safe area: [${tx},${ty},${tw},${th}]`);
if (cx < 64 || cy < ty + th || cx + cw > 930 || cy + chBox > 1440) fail(`9x16 split caption slot outside safe area: [${cx},${cy},${cw},${chBox}]`);
for (const [aspect, w, h] of [['16x9', 1920, 1080], ['9x16', 1080, 1920]]) {
  const r = spawnSync('bun', [path.join(here, 'video.mjs'), '--smoke', '--workers', '1', '--aspect', aspect, '--captions', 'plain', '--out', OUT], { stdio: 'inherit' });
  if (r.status !== 0) fail(`renderer failed (${aspect})`);
  const data = JSON.parse(readFileSync(path.join(OUT, 'narration.json'), 'utf8'));
  const i = data.chapters.findIndex(c => c.scene === 4), ch = data.chapters[i];
  const want = Math.round(data.chapters[i + 1].startSeconds * FPS) - Math.round(ch.startSeconds * FPS);
  const file = path.join(OUT, 'scenes', `s04-${ch.id}${aspect === '16x9' ? '' : `-${aspect}-plain`}.mp4`);
  if (aspect === '9x16') {
    const ass = readFileSync(path.join(OUT, 'scenes', `s04-${ch.id}-9x16-plain.ass`), 'utf8');
    if (!ass.includes(',64,150,490,1')) fail('9x16 ASS captions: expected safe-area margins 64,150,490');
  }
  const p = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,width,height,nb_read_frames,duration', '-of', 'json', file]);
  if (p.status !== 0) fail(`ffprobe failed on ${file}`);
  const s = JSON.parse(p.stdout.toString()).streams, v = s.find(x => x.codec_type === 'video'), a = s.find(x => x.codec_type === 'audio');
  if (!v || !a) fail(`${aspect}: missing ${v ? 'audio' : 'video'} stream`);
  if (v.width !== w || v.height !== h) fail(`${aspect}: resolution ${v.width}x${v.height}, want ${w}x${h}`);
  if (Math.abs(+v.nb_read_frames - want) > 1) fail(`${aspect}: ${v.nb_read_frames} frames, chapter needs ${want}`);
  if (Math.abs(+v.duration - +a.duration) > 0.05) fail(`${aspect}: video ${v.duration}s vs audio ${a.duration}s`);
  console.log(`video smoke ${aspect}: ${v.nb_read_frames}/${want} frames, ${v.width}x${v.height}, A/V ${(+v.duration).toFixed(3)}/${(+a.duration).toFixed(3)} s`);
}
rmSync(OUT, { recursive: true, force: true });
