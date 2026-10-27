import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../dist");
const manifest = JSON.parse(
  readFileSync(path.join(root, "release.json"), "utf8"),
);
assert.deepEqual(Object.keys(manifest).sort(), [
  "files",
  "generatedAt",
  "sourceCommit",
  "upstreamCommit",
  "version",
]);
assert.equal(
  manifest.version,
  JSON.parse(readFileSync(path.join(root, "../package.json"), "utf8")).version,
);
assert(/^[a-f0-9]{40}$/.test(manifest.sourceCommit));
assert.equal(
  manifest.upstreamCommit,
  "ce6f879f1045fae540e5b31ad4f5252737a83801",
);
assert(Number.isFinite(Date.parse(manifest.generatedAt)));
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(path.join(dir, e.name))
      : [path.relative(root, path.join(dir, e.name)).split(path.sep).join("/")],
  );
const actual = walk(root)
  .filter((f) => f !== "release.json")
  .sort();
assert.deepEqual(Object.keys(manifest.files).sort(), actual);
for (const required of [
  "deck/index.html",
  "deck/narration/river.mp3",
  "deck/narration/CREDITS.md",
  "NOTICE",
  "LICENSE",
  "LICENSE-CONTENT",
  "ATTRIBUTION.md",
  "script.md",
  "resources.md",
  "downloads/agent-workspaces-slides.pdf",
  "downloads/agent-workspaces-guide.pdf",
])
  assert(actual.includes(required));
for (const f of actual) {
  assert(
    /^(deck\/(index\.html|preview\.webp|fonts\/[^/]+|narration\/(river\.mp3|CREDITS\.md))|script\.md|resources\.md|NOTICE|LICENSE|LICENSE-CONTENT|ATTRIBUTION\.md|downloads\/agent-workspaces-(slides|guide)\.pdf)$/.test(
      f,
    ),
    `unexpected output ${f}`,
  );
  const data = readFileSync(path.join(root, f));
  assert.equal(
    createHash("sha256").update(data).digest("hex"),
    manifest.files[f],
    `checksum mismatch ${f}`,
  );
  if (f.endsWith(".pdf")) assert.equal(data.subarray(0, 5).toString(), "%PDF-");
}
console.log(
  `release verified: ${actual.length} files, ${manifest.sourceCommit}`,
);
