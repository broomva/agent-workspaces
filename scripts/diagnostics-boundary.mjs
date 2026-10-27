// A failed optional snapshot must not prevent any original pixel comparison.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL("../deck/smoke.mjs", import.meta.url),
  "utf8",
);
const loop = source.slice(
  source.indexOf("for (const [scene, k]"),
  source.indexOf("// 5. still frames"),
);
assert(
  loop.includes("const same = a.equals(b)"),
  "original comparison is missing",
);

for (const snapshotFails of [false, true]) {
  for (const equal of [false, true]) {
    const fails = [];
    let pages = 0;
    let equalityCalls = 0;
    const a = {
      equals() {
        equalityCalls++;
        return equal;
      },
    };
    const page = async () => {
      const index = pages++;
      return {
        p: {
          waitForFunction: async () => {},
          evaluate: async () => {},
          screenshot: async () => (index % 2 === 0 ? a : {}),
          close: async () => {},
        },
      };
    };
    const context = {
      deck: "fixture",
      page,
      fails,
      console: { log() {} },
      collectPurityState: async () => {
        if (snapshotFails) throw Error("injected snapshot failure");
        return {};
      },
      purityDiagnostics: async () => {
        throw Error("injected artifact failure");
      },
    };
    await vm.runInNewContext(`(async () => {${loop}})()`, context);
    assert.equal(
      equalityCalls,
      3,
      "snapshot failure skipped pixel comparisons",
    );
    assert.equal(
      pages,
      6,
      "snapshot failure interrupted the A/B page lifecycle",
    );
    assert.equal(
      fails.filter((s) => s.startsWith("purity:")).length,
      equal ? 0 : 3,
    );
  }
}
console.log(
  "diagnostic fault injection: all original comparisons and failures survive",
);
