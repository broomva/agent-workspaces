import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
execFileSync(process.execPath, [path.join(root, "scripts/verify-dist.mjs")], {
  stdio: "inherit",
});
const manifest = JSON.parse(
  readFileSync(path.join(root, "dist/release.json"), "utf8"),
);
const name = `agent-workspaces-v${manifest.version}-${manifest.sourceCommit.slice(0, 12)}.tar.gz`;
execFileSync(
  "tar",
  ["-czf", path.join(root, name), "-C", path.join(root, "dist"), "."],
  { env: { ...process.env, COPYFILE_DISABLE: "1" } },
);
const sha = createHash("sha256")
  .update(readFileSync(path.join(root, name)))
  .digest("hex");
writeFileSync(path.join(root, `${name}.sha256`), `${sha}  ${name}\n`);
console.log(`${name}\nsha256 ${sha}`);
