// Regression test for the reel series' reuse boundary (BRO-3817, P20 round 4).
// reels/tts.mjs --offline rebuilds a part's timeline from series.json and the cached River lines; render.mjs runs it before
// every series render. Each cached line is reused only if its receipt vouches for the request, the MP3 bytes and the
// alignment bytes, and the alignment spells the line. This script tampers with a disposable copy and requires a refusal
// for each case, after a control run on the untouched copy that must succeed and reproduce the committed timeline.
// It never calls ElevenLabs: every run is --offline or --dry-run, or stops before any request (a cap, or a paid take
// missing from the media store), always with the key file pointed at a path that does not exist and, for v2, an empty
// media store. The v2 gap arithmetic (reels/gap.mjs) is tested on synthetic PCM, so none of it needs media or ffmpeg.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
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
  // insertion on loud signal (no silence to hide in): two cuts; every sample outside the fades is the source's, shifted
  const sig = loud(2 * SR, 11),
    ins = Math.round(0.35 * SR),
    cuts = [30011, 61003],
    out = insertGaps(sig, cuts, ins);
  const same = (o, from, to, shift) => {
    for (let i = from; i < to; i++) if (out[i + shift] !== sig[i]) return false;
    return true;
  };
  const zeroAt = (h) => out.subarray(h, h + ins).every((v) => v === 0);
  expect(
    "exactly round(0.35 s × 44100) zero samples go in at each cut; the rest is the source, shifted",
    out.length === sig.length + 2 * ins &&
      zeroAt(cuts[0]) &&
      zeroAt(cuts[1] + ins) &&
      same(out, 0, cuts[0] - FADE, 0) &&
      same(out, cuts[0] + FADE, cuts[1] - FADE, ins) &&
      same(out, cuts[1] + FADE, sig.length, 2 * ins) &&
      out[cuts[0] - 1] === 0 &&
      out[cuts[0] + ins] === 0,
    `length ${out.length}`,
  );
  // three lines "ab cd ef": line n moves by (n - 1) gaps; each boundary space keeps its start and ends after its gap
  const { starts, ends } = shiftAlignment(
    [0, 0.1, 0.2, 0.5, 0.6, 0.7, 1.0, 1.1],
    [0.1, 0.2, 0.5, 0.6, 0.7, 1.0, 1.1, 1.2],
    [0, 3, 6],
    0.35,
  );
  expect(
    "the alignment shifts line n by (n - 1) gaps",
    JSON.stringify(starts) ===
      JSON.stringify([0, 0.1, 0.2, 0.85, 0.95, 1.05, 1.7, 1.8]) &&
      JSON.stringify(ends) ===
        JSON.stringify([0.1, 0.2, 0.85, 0.95, 1.05, 1.7, 1.8, 1.9]),
    `${starts} / ${ends}`,
  );
}

// Every committed v2 part: its receipts, alignments, cuts and timeline agree (no media needed, so this runs in CI). Where
// the takes are in the media store, an --offline rebuild in a disposable copy also reproduces the committed timeline.
{
  const v2 = path.join(root, "reels", "audio", "v2");
  const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
  const json = (f) => JSON.parse(readFileSync(f, "utf8"));
  const parts = readdirSync(v2)
    .filter((n) => n.endsWith(".timeline.json"))
    .map((n) => n.slice(0, -".timeline.json".length));
  expect("v2: the committed parts are found", parts.length >= 6, parts.join(", "));
  for (const reel of parts) {
    const f = (ext) => path.join(v2, `${reel}${ext}`);
    const take = json(f(".receipt.json")),
      gapped = json(f(".gapped.receipt.json")),
      tl = json(f(".timeline.json"));
    const bad = [];
    if (take.alignmentSha256 !== sha(f(".alignment.json")))
      bad.push("the take alignment does not match its receipt");
    if (gapped.alignmentSha256 !== sha(f(".gapped.alignment.json")))
      bad.push("the gapped alignment does not match its receipt");
    if (gapped.source?.receiptSha256 !== sha(f(".receipt.json")))
      bad.push("the gapped receipt names another take receipt");
    if (gapped.source?.audioSha256 !== take.audioSha256)
      bad.push("the gapped receipt names another take");
    if (gapped.credits !== 0) bad.push("the gapped take claims credits");
    if (!(take.estimateCredits <= take.capCredits))
      bad.push(`the take's estimate ${take.estimateCredits} is over its cap ${take.capCredits}`);
    if (tl.take.audio !== `v2/${reel}.gapped.wav`)
      bad.push("the timeline does not play the gapped take");
    if (JSON.stringify(tl.take.gaps.cuts) !== JSON.stringify(gapped.cuts))
      bad.push("the timeline's cuts differ from the gapped receipt's");
    if (
      !readFileSync(f(".timeline.js"), "utf8").endsWith(
        `\nwindow.REEL_V2=${JSON.stringify(tl, null, 2)};\n`,
      )
    )
      bad.push("timeline.js is not generated from timeline.json");
    expect(
      `v2 ${reel}: receipts, alignments, cuts and timeline agree`,
      bad.length === 0,
      bad.join("; "),
    );
  }
  const media =
    process.env.CF_MEDIA_DIR ||
    path.join(homedir(), ".local", "share", "content-flow", "media", "sha256");
  const stored = (rec) =>
    existsSync(path.join(media, `${json(rec).audioSha256}.mp3`));
  const ctaStored = stored(path.join(v2, "v2-cta.receipt.json"));
  const present = parts.filter(
    (r) => ctaStored && stored(path.join(v2, `${r}.receipt.json`)),
  );
  if (present.length < parts.length)
    console.log(
      `SKIPPED, NOT PROVED  v2 offline rebuild of ${parts.length - present.length} part(s): their takes are not in ${media} (the consistency checks above still ran)`,
    );
  for (const reel of present) {
    const dir = fresh();
    try {
      const tlFile = path.join(dir, "reels", "audio", "v2", `${reel}.timeline.json`);
      const before = readFileSync(tlFile, "utf8");
      const scratch = path.join(dir, "media"); // never write into the real store
      mkdirSync(scratch);
      for (const r of ["v2-cta", reel]) {
        const h = json(path.join(v2, `${r}.receipt.json`)).audioSha256;
        cpSync(path.join(media, `${h}.mp3`), path.join(scratch, `${h}.mp3`));
      }
      const r = spawnSync(
        "bun",
        [path.join(dir, "reels", "tts.mjs"), "--v2", "--reel", reel, "--offline"],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            ELEVENLABS_ENV_FILE: path.join(dir, "no-such-key-file"),
            CF_MEDIA_DIR: scratch,
          },
        },
      );
      expect(
        `v2 ${reel}: an --offline rebuild reproduces the committed timeline`,
        r.status === 0 && readFileSync(tlFile, "utf8") === before,
        r.stderr,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

if (failures) {
  console.error(`reels guards: ${failures} case(s) failed`);
  process.exit(1);
}
console.log(
  "reels guards: every tampered input refused; control rebuilds the committed timeline",
);
