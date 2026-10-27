import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (git("status", "--porcelain", "--untracked-files=normal"))
  throw new Error("Commit source changes before building an immutable release");
const sourceCommit = git("rev-parse", "HEAD");
const version = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
).version;
const dist = path.join(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, "deck"), { recursive: true });
mkdirSync(path.join(dist, "downloads"));
cpSync(path.join(root, "deck/index.html"), path.join(dist, "deck/index.html"));
cpSync(path.join(root, "deck/fonts"), path.join(dist, "deck/fonts"), {
  recursive: true,
});
cpSync(path.join(root, "deck/narration"), path.join(dist, "deck/narration"), {
  recursive: true,
});
for (const f of [
  "script.md",
  "resources.md",
  "NOTICE",
  "LICENSE",
  "LICENSE-CONTENT",
  "ATTRIBUTION.md",
])
  cpSync(path.join(root, f), path.join(dist, f));
const scratch = mkdtempSync(path.join(dist, ".export-"));
try {
  execFileSync(
    process.execPath,
    [
      path.join(root, "deck/pdf.mjs"),
      "--out",
      scratch,
      "--preview",
      path.join(dist, "deck/preview.webp"),
    ],
    { cwd: root, stdio: "inherit" },
  );
  for (const kind of ["slides", "guide"])
    cpSync(
      path.join(scratch, `agent-workspaces-${kind}.pdf`),
      path.join(dist, `downloads/agent-workspaces-${kind}.pdf`),
    );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
const files = {};
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else
      files[path.relative(dist, f).split(path.sep).join("/")] = createHash(
        "sha256",
      )
        .update(readFileSync(f))
        .digest("hex");
  }
};
walk(dist);
writeFileSync(
  path.join(dist, "release.json"),
  `${JSON.stringify({ version, sourceCommit, upstreamCommit: "ce6f879f1045fae540e5b31ad4f5252737a83801", generatedAt: new Date().toISOString(), files }, null, 2)}\n`,
);
execFileSync(process.execPath, [path.join(root, "scripts/verify-dist.mjs")], {
  stdio: "inherit",
});
