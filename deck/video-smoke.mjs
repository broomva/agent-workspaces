// Smoke for deck/video.mjs: renders scene 4 (a ~12 s break) at 16:9 and 9:16 into a temp dir and checks each
// clip against the narration timing: frames = chapter length × fps (±1), audio slice = video length (±0.05 s).
// Needs ffmpeg/ffprobe with libass and libx264. Usage: bun deck/video-smoke.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), FPS = 30;
const OUT = mkdtempSync(path.join(os.tmpdir(), 'aw-video-smoke-'));
const fail = m => { console.error(m); console.error(`(output kept in ${OUT})`); process.exit(1) };
for (const [aspect, w, h] of [['16x9', 1920, 1080], ['9x16', 1080, 1920]]) {
  const r = spawnSync('bun', [path.join(here, 'video.mjs'), '--smoke', '--workers', '1', '--aspect', aspect, '--out', OUT], { stdio: 'inherit' });
  if (r.status !== 0) fail(`renderer failed (${aspect})`);
  const data = JSON.parse(readFileSync(path.join(OUT, 'narration.json'), 'utf8'));
  const i = data.chapters.findIndex(c => c.scene === 4), ch = data.chapters[i];
  const want = Math.round(data.chapters[i + 1].startSeconds * FPS) - Math.round(ch.startSeconds * FPS);
  const file = path.join(OUT, 'scenes', `s04-${ch.id}${aspect === '16x9' ? '' : `-${aspect}`}.mp4`);
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
