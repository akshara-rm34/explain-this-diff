import { describe, expect, it } from "vitest";
import { prepareDiff, splitDiff } from "../src/diff.js";

const file = (path: string, body = "+x\n") =>
  `diff --git a/${path} b/${path}\nindex 1..2 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n${body}`;

describe("splitDiff", () => {
  it("splits per file and reads the new path", () => {
    const files = splitDiff(file("src/a.ts") + file("src/b.ts"));
    expect(files.map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("uses the new name for renames", () => {
    const d = "diff --git a/old.ts b/new.ts\nsimilarity index 90%\nrename from old.ts\nrename to new.ts\n";
    expect(splitDiff(d)[0].path).toBe("new.ts");
  });
});

describe("prepareDiff", () => {
  it("drops lockfiles, build output and binaries, and says why", () => {
    const d =
      file("src/a.ts") +
      file("package-lock.json") +
      file("dist/index.js") +
      "diff --git a/logo.svg b/logo.svg\nBinary files a/logo.svg and b/logo.svg differ\n";
    const out = prepareDiff(d, 10_000);
    expect(out.included).toEqual(["src/a.ts"]);
    expect(out.skipped).toEqual([
      { path: "package-lock.json", reason: "lockfile" },
      { path: "dist/index.js", reason: "build output" },
      { path: "logo.svg", reason: "binary" },
    ]);
  });

  it("drops source maps but keeps hand-written .d.ts files", () => {
    const out = prepareDiff(
      file("lib/app.js.map") + file("lib/index.d.ts.map") + file("types/global.d.ts") + file("dist/index.d.ts"),
      10_000,
    );
    expect(out.included).toEqual(["types/global.d.ts"]);
    expect(out.skipped).toEqual([
      { path: "lib/app.js.map", reason: "source map" },
      { path: "lib/index.d.ts.map", reason: "source map" },
      { path: "dist/index.d.ts", reason: "build output" },
    ]);
  });

  it("keeps the smallest files under the budget and reports the rest", () => {
    const small = file("small.ts");
    const big = file("big.ts", "+" + "y".repeat(500) + "\n");
    const out = prepareDiff(big + small, small.length + 10);
    expect(out.included).toEqual(["small.ts"]);
    expect(out.skipped).toEqual([{ path: "big.ts", reason: "over size budget" }]);
  });

  it("returns empty text when nothing is reviewable", () => {
    expect(prepareDiff(file("yarn.lock"), 10_000).text).toBe("");
  });
});
