// A failed optional snapshot must not prevent any original pixel comparison.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL("../deck/smoke.mjs", import.meta.url),
  "utf8",
);
const loops = [
  {
    start: "for (const [scene, k]",
    end: "// 5. still frames",
    count: 3,
    prefix: "purity:",
    comparison: "a.equals(b)",
  },
  {
    start: "for (const scene of [6, 37])",
    end: "// 13. guide mode",
    count: 2,
    prefix: "capture DOM purity",
    comparison: "sa.equals(sb)",
  },
];

for (const spec of loops) {
  const loop = source.slice(
    source.indexOf(spec.start),
    source.indexOf(spec.end),
  );
  assert(loop.includes(spec.comparison), "original comparison is missing");
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
            evaluate: async (fn) =>
              String(fn).includes("#stack .plate") ? [6, 0] : undefined,
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
      assert(
        equalityCalls >= spec.count,
        "snapshot failure skipped pixel comparisons",
      );
      assert.equal(
        pages,
        spec.count * 2,
        "snapshot failure interrupted the A/B page lifecycle",
      );
      assert.equal(
        fails.filter((s) => s.startsWith(spec.prefix)).length,
        equal ? 0 : spec.count,
      );
    }
  }
}
console.log(
  "diagnostic fault injection: all original comparisons and failures survive",
);
