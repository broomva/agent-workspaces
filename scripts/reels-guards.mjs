// Regression test for the reel series' reuse boundary (BRO-3817, P20 round 4).
// reels/tts.mjs --offline rebuilds a part's timeline from series.json and the cached River lines; render.mjs runs it before
// every series render. Each cached line is reused only if its receipt vouches for the request, the MP3 bytes and the
// alignment bytes, and the alignment spells the line. This script tampers with a disposable copy and requires a refusal
// for each case, after a control run on the untouched copy that must succeed and reproduce the committed timeline.
// It never calls ElevenLabs: every run is --offline or --dry-run, with the key file pointed at a path that does not exist.

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

if (failures) {
  console.error(`reels guards: ${failures} case(s) failed`);
  process.exit(1);
}
console.log(
  "reels guards: every tampered input refused; control rebuilds the committed timeline",
);
