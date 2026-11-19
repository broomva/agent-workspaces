// Regression test for the reel series' reuse boundary (BRO-3817, P20 round 4).
// reels/tts.mjs --offline rebuilds a part's timeline from series.json and the cached River lines; render.mjs runs it before
// every series render. Each cached line is reused only if its receipt vouches for the request, the MP3 bytes and the
// alignment bytes, and the alignment spells the line. This script tampers with a disposable copy and requires a refusal
// for each case, after a control run on the untouched copy that must succeed and reproduce the committed timeline.
// It never calls ElevenLabs: every run is --offline or --dry-run, or stops before any request (a cap, or a paid take
// missing from the media store), always with the key file pointed at a path that does not exist and, for v2, an empty
// media store. The v2 gap arithmetic (reels/gap.mjs) is tested on synthetic PCM, so none of it needs media or ffmpeg.

import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FADE,
  insertGaps,
  MAX_CUT_RMS,
  quietestCut,
  SR,
  shiftAlignment,
  WIN,
} from "../reels/gap.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REEL = "r01-folder";
let failures = 0;

function fresh() {
  const dir = mkdtempSync(path.join(tmpdir(), "reels-guards-"));
  cpSync(
    path.join(root, "reels", "tts.mjs"),
    path.join(dir, "reels", "tts.mjs"),
  );
  cpSync(
    path.join(root, "reels", "gap.mjs"),
    path.join(dir, "reels", "gap.mjs"),
  );
  cpSync(
    path.join(root, "reels", "series.json"),
    path.join(dir, "reels", "series.json"),
  );
  cpSync(path.join(root, "reels", "audio"), path.join(dir, "reels", "audio"), {
    recursive: true,
  });
  return dir;
}
function tts(dir, ...args) {
  const r = spawnSync(
    "bun",
    [path.join(dir, "reels", "tts.mjs"), "--reel", REEL, ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ELEVENLABS_ENV_FILE: path.join(dir, "no-such-key-file"),
      },
    },
  );
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const file = (dir, name) => path.join(dir, "reels", "audio", name);
const editJson = (p, fn) => {
  const d = JSON.parse(readFileSync(p, "utf8"));
  fn(d);
  writeFileSync(p, `${JSON.stringify(d, null, 2)}\n`);
};
const snapshot = (dir) =>
  Object.fromEntries(
    readdirSync(path.join(dir, "reels", "audio")).map((n) => [
      n,
      statSync(file(dir, n)).mtimeMs,
    ]),
  );

function expect(name, ok, detail) {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${detail}`}`,
  );
  if (!ok) failures++;
}
function refuses(name, tamper, pattern) {
  const dir = fresh();
  try {
    tamper(dir);
    const r = tts(dir, "--offline");
    expect(
      name,
      r.code !== 0 && pattern.test(r.out),
      `exit ${r.code}, wanted a refusal matching ${pattern}: ${r.out.trim().split("\n").slice(-3).join(" | ")}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// control: the untouched copy rebuilds, and reproduces the committed timeline byte for byte
{
  const dir = fresh();
  try {
    const r = tts(dir, "--offline");
    const same =
      r.code === 0 &&
      ["series.json", "series.js"].every(
        (ext) =>
          readFileSync(file(dir, `${REEL}.${ext}`), "utf8") ===
          readFileSync(
            path.join(root, "reels", "audio", `${REEL}.${ext}`),
            "utf8",
          ),
      );
    expect(
      "control: untouched lines rebuild the committed timeline",
      same,
      `exit ${r.code}: ${r.out.trim().split("\n").slice(-3).join(" | ")}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

refuses(
  "alignment text tampered (receipt and MP3 untouched)",
  (dir) =>
    editJson(file(dir, `${REEL}-hook.alignment.json`), (d) => {
      const a = d.alignment || d.normalized_alignment;
      a.characters[0] = a.characters[0] === "Z" ? "Y" : "Z";
    }),
  /alignment\.json does not match its receipt/,
);
refuses(
  "alignment timing tampered (text unchanged)",
  (dir) =>
    editJson(file(dir, `${REEL}-hook.alignment.json`), (d) => {
      const a = d.alignment || d.normalized_alignment;
      a.character_start_times_seconds[0] += 0.5;
    }),
  /alignment\.json does not match its receipt/,
);
refuses(
  "alignment that does not spell the line, with a receipt re-signed to match",
  (dir) => {
    editJson(file(dir, `${REEL}-hook.alignment.json`), (d) => {
      const a = d.alignment || d.normalized_alignment;
      a.characters[0] = "Z";
    });
    const sha = spawnSync(
      "shasum",
      ["-a", "256", file(dir, `${REEL}-hook.alignment.json`)],
      { encoding: "utf8" },
    ).stdout.split(" ")[0];
    editJson(file(dir, `${REEL}-hook.receipt.json`), (r) => {
      r.alignmentSha256 = sha;
    });
  },
  /does not spell/,
);
refuses(
  "receipt without an alignment hash",
  (dir) =>
    editJson(file(dir, `${REEL}-hook.receipt.json`), (r) => {
      delete r.alignmentSha256;
    }),
  /records no alignmentSha256/,
);
refuses(
  "MP3 bytes changed",
  (dir) =>
    writeFileSync(
      file(dir, `${REEL}-hook.mp3`),
      Buffer.concat([
        readFileSync(file(dir, `${REEL}-hook.mp3`)),
        Buffer.from([0]),
      ]),
    ),
  /mp3 does not match its receipt/,
);
refuses(
  "hook text changed in series.json (needs new audio)",
  (dir) =>
    editJson(path.join(dir, "reels", "series.json"), (s) => {
      s.parts.find((p) => p.reel === REEL).spokenHook += " Really.";
    }),
  /needs new audio/,
);

// a dry run reports and writes nothing, even when the timeline would change
{
  const dir = fresh();
  try {
    editJson(path.join(dir, "reels", "series.json"), (s) => {
      s.parts.find((p) => p.reel === REEL).next = "A different next card.";
    });
    const before = snapshot(dir),
      r = tts(dir, "--dry-run"),
      after = snapshot(dir);
    expect(
      "dry run writes nothing",
      r.code === 0 && JSON.stringify(before) === JSON.stringify(after),
      `exit ${r.code}; files changed: ${r.out.trim()}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Each v2 part gets only its own override; exceeding either cap stops before a request.
{
  const dir = fresh();
  try {
    editJson(path.join(dir, "reels", "series.json"), (s) => {
      s.v2.budget.creditsPerCharacter = 1;
      s.v2.budget.ctaCapCredits = 1000;
      s.v2.budget.partCapCredits = 10;
      s.v2.parts[0].capCredits = 20;
      s.v2.parts[0].spoken = ["x".repeat(21)];
      s.v2.parts[1].spoken = ["x".repeat(15)];
    });
    const run = (reel) =>
      spawnSync(
        "bun",
        [path.join(dir, "reels", "tts.mjs"), "--v2", "--reel", reel],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            ELEVENLABS_ENV_FILE: path.join(dir, "no-such-key-file"),
            CF_MEDIA_DIR: path.join(dir, "empty-media"),
          },
        },
      );
    const over = run("v2-p1-folder"),
      other = run("v2-p2-findings");
    expect(
      "v2 override stops its part before spending",
      over.status !== 0 &&
        /over its cap of 20\. Nothing was sent/.test(over.stderr),
      over.stderr,
    );
    expect(
      "v2 override does not apply to other parts",
      other.status !== 0 &&
        /over its cap of 10\. Nothing was sent/.test(other.stderr),
      other.stderr,
    );
    editJson(path.join(dir, "reels", "series.json"), (s) => {
      s.v2.parts[0].spoken = ["x".repeat(15)];
    });
    const within = spawnSync(
      "bun",
      [
        path.join(dir, "reels", "tts.mjs"),
        "--v2",
        "--reel",
        "v2-p1-folder",
        "--dry-run",
      ],
      { encoding: "utf8" },
    );
    expect(
      "v2 override allows its part within its own cap",
      within.status === 0 && /cap 20/.test(within.stdout),
      within.stderr + within.stdout,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A v2 take whose receipt matches the request but whose audio is not in the media store was already paid for: a run
// without --offline refuses before any request rather than paying again; --dry-run reports it and spends nothing.
{
  const dir = fresh();
  try {
    const v2dir = path.join(dir, "reels", "audio", "v2");
    for (const n of readdirSync(v2dir))
      if (/\.(mp3|wav)$/.test(n)) rmSync(path.join(v2dir, n)); // as in CI: v2 media is not in git
    const v2run = (...extra) =>
      spawnSync(
        "bun",
        [
          path.join(dir, "reels", "tts.mjs"),
          "--v2",
          "--reel",
          "v2-p2-findings",
          ...extra,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            ELEVENLABS_ENV_FILE: path.join(dir, "no-such-key-file"),
            CF_MEDIA_DIR: path.join(dir, "empty-media"),
          },
        },
      );
    const paid = v2run(),
      dry = v2run("--dry-run");
    expect(
      "v2 refuses to pay again for a take missing from the media store",
      paid.status !== 0 &&
        /already paid for\. Restore it there; nothing was sent/.test(
          paid.stderr,
        ),
      paid.stderr,
    );
    expect(
      "v2 --dry-run reports a paid take missing from the media store",
      dry.status === 0 && /missing .*already paid for/.test(dry.stdout),
      dry.stderr + dry.stdout,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The gap arithmetic on synthetic PCM: speech at amplitude 2000, one stretch of silence per boundary.
{
  const loud = (n, seed) =>
    Int16Array.from({ length: n }, (_, i) =>
      Math.round(2000 * Math.sin((i + seed) * 0.37)),
    );
  const pcm = new Int16Array(3 * SR);
  pcm.set(loud(SR, 0), 0);
  pcm.set(loud(SR, 7), 2 * SR); // [SR, 2 SR) stays silent
  const { sample, rms } = quietestCut(pcm, SR - 100, 2 * SR + 100, "t");
  expect(
    "a cut lands inside the silence",
    sample >= SR && sample < 2 * SR && rms === 0,
    `sample ${sample}, rms ${rms}`,
  );
  const threw = (fn, re) => {
    try {
      fn();
      return false;
    } catch (e) {
      return re.test(String(e.message));
    }
  };
  expect(
    "a boundary with no silence is refused, not cut into speech",
    threw(
      () => quietestCut(loud(SR, 3), 1000, 5000, "t"),
      new RegExp(`over ${MAX_CUT_RMS}; there is no silence`),
    ),
    "quietestCut accepted a window of speech",
  );
  expect(
    "a boundary shorter than the cut window is refused",
    threw(
      () => quietestCut(pcm, SR, SR + WIN - 1, "t"),
      /under the 10 ms a cut needs/,
    ),
    "quietestCut accepted a window under 10 ms",
  );
  const ins = Math.round(0.35 * SR),
    out = insertGaps(pcm, [sample], ins);
  const zeros = out.subarray(sample, sample + ins).every((v) => v === 0);
  expect(
    "exactly round(0.35 s × 44100) zero samples go in at the cut",
    out.length === pcm.length + ins &&
      zeros &&
      out[sample + ins + FADE] === pcm[sample + FADE] &&
      out[sample - 1 - FADE] === pcm[sample - 1 - FADE],
    `length ${out.length}, zeros ${zeros}`,
  );
  // two lines "ab cd": the boundary space (index 2) keeps its start and ends after the gap; line 2 moves by one gap
  const { starts, ends } = shiftAlignment(
    [0, 0.1, 0.2, 0.5, 0.6],
    [0.1, 0.2, 0.5, 0.6, 0.7],
    [0, 3],
    0.35,
  );
  expect(
    "the alignment shifts line n by (n - 1) gaps",
    JSON.stringify(starts) === JSON.stringify([0, 0.1, 0.2, 0.85, 0.95]) &&
      JSON.stringify(ends) === JSON.stringify([0.1, 0.2, 0.85, 0.95, 1.05]),
    `${starts} / ${ends}`,
  );
}

if (failures) {
  console.error(`reels guards: ${failures} case(s) failed`);
  process.exit(1);
}
console.log(
  "reels guards: every tampered input refused; control rebuilds the committed timeline",
);
