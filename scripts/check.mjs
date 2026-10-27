import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const src = readFileSync(path.join(root, "deck/index.html"), "utf8");
const sections = [
  ...src.matchAll(
    /<section class="scene(?: brk)?" data-id="(\w+)" data-act="(\d)" data-steps="(\d+)" aria-label="([^"]+)">([\s\S]*?)\n<\/section>/g,
  ),
];
assert.equal(sections.length, 37, "expected 37 parseable scenes");
assert.equal(new Set(sections.map((s) => s[1])).size, sections.length);
let beats = 0;
for (const [, id, , count, label, body] of sections) {
  assert(+count >= 1, `${id}: missing beats`);
  beats += +count;
  assert(body.includes('<aside class="notes">'), `${id}: no speaker notes`);
  assert(body.includes('<template class="guide">'), `${id}: no guide`);
  assert(
    body.includes('class="workspace-example"'),
    `${id}: local source scope missing`,
  );
  assert(!label.includes("—"), `${id}: em dash in title`);
  for (const b of body.matchAll(/data-beat="(\d+)"/g))
    assert(+b[1] < +count, `${id}: invalid guide beat`);
  for (const h of body.matchAll(/href="([^"]+)"/g))
    assert(h[1].startsWith("https://"), `${id}: non-HTTPS guide link`);
}
assert(
  !/two-hop|up to four links out|66 nested repos|corpus outgrows the window/i.test(
    src + readFileSync(path.join(root, "script.md"), "utf8"),
  ),
  "stale narrative",
);
assert(!/oklch\([^)]*\s330(?:\s|\))/.test(src), "purple rim stop");
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (
      [".git", "node_modules", "dist"].includes(e.name) ||
      e.name.endsWith(".tar.gz") ||
      e.name.endsWith(".sha256")
    )
      return [];
    const f = path.join(dir, e.name);
    return e.isDirectory() ? walk(f) : [f];
  });
const publicationDenylist = (process.env.PUBLICATION_DENYLIST || "")
  .split(",")
  .map((term) => term.trim().toLowerCase())
  .filter(Boolean);
for (const f of walk(root)) {
  if (f.endsWith(".woff2")) continue;
  const text = readFileSync(f, "utf8");
  assert(
    !publicationDenylist.some((term) => text.toLowerCase().includes(term)),
    `publication denylist match: ${path.relative(root, f)}`,
  );
  assert(
    !/(?:\/Users\/|\/Volumes\/|\/home\/[a-z]|file:\/\/|ghp_[A-Za-z0-9]{20}|sk-(?:proj-)?[A-Za-z0-9_-]{24})/.test(
      text,
    ),
    `private absolute path or token: ${path.relative(root, f)}`,
  );
}
for (const name of ["Inter", "Raleway", "JetBrainsMono"]) {
  const license = readFileSync(
    path.join(root, `deck/fonts/${name}-OFL.txt`),
    "utf8",
  );
  assert(
    license.includes("SIL OPEN FONT LICENSE Version 1.1") &&
      license.includes("DISCLAIMER"),
    `${name}: incomplete OFL`,
  );
}
console.log(
  `static check: ${sections.length} scenes, ${beats} beats, scoped guides, privacy scan and font licenses passed`,
);
