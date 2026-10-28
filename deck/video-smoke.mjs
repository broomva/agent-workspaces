import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'out-smoke');
if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });

console.log('Running video renderer smoke test (scene 4)...');
const res = spawnSync('bun', [path.join(here, 'video.mjs'), '--smoke', '--out', OUT], { stdio: 'inherit' });
if (res.status !== 0) {
  console.error('Renderer failed');
  process.exit(1);
}

const file = path.join(OUT, 'scenes', 's04-brk1.mp4');
if (!fs.existsSync(file)) {
  console.error('Missing output file', file);
  process.exit(1);
}

const ffprobe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,nb_frames,duration,codec_type', '-of', 'json', file]);
const info = JSON.parse(ffprobe.stdout.toString());

const vStream = info.streams.find(s => s.codec_type === 'video');
const aStream = info.streams.find(s => s.codec_type === 'audio');

if (vStream.width !== 1920 || vStream.height !== 1080) {
  console.error(`Invalid resolution: ${vStream.width}x${vStream.height}`);
  process.exit(1);
}

const vDur = Number(vStream.duration);
const aDur = Number(aStream.duration);

if (Math.abs(vDur - aDur) > 0.05) {
  console.error(`Duration mismatch: video ${vDur}s, audio ${aDur}s`);
  process.exit(1);
}

const expectedFrames = Math.round(vDur * 30);
const frames = Number(vStream.nb_frames);
if (Math.abs(frames - expectedFrames) > 1) {
  console.error(`Frame count mismatch: expected ~${expectedFrames}, got ${frames}`);
  process.exit(1);
}

console.log(`Smoke test passed: ${frames} frames, ${vDur}s video, ${aDur}s audio, ${vStream.width}x${vStream.height}`);
