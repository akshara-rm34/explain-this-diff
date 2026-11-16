import { describe, expect, it } from "vitest";
import { upsertEntry, type Entry } from "../src/doc.js";

const entry = (n: number, answer: string): Entry => ({
  prNumber: n,
  title: `PR ${n}`,
  url: `https://github.com/me/repo/pull/${n}`,
  date: "2026-11-16",
  questions: [{ question: "Why?", file: "a.ts" }],
  answers: [answer],
  feedback: null,
});

describe("upsertEntry", () => {
  it("creates the doc with a header", () => {
    const doc = upsertEntry(null, "me/repo", entry(1, "because"));
    expect(doc).toMatch(/^# Interview prep: me\/repo/);
    expect(doc).toContain("> because");
  });

  it("appends new PRs and replaces an existing PR's entry", () => {
    let doc = upsertEntry(null, "me/repo", entry(1, "first try"));
    doc = upsertEntry(doc, "me/repo", entry(2, "other pr"));
    doc = upsertEntry(doc, "me/repo", entry(1, "better answer"));
    expect(doc).not.toContain("first try");
    expect(doc).toContain("better answer");
    expect(doc.indexOf("PR 1")).toBeLessThan(doc.indexOf("PR 2"));
    expect(doc.match(/etd:pr-1 -->/g)).toHaveLength(2); // one start, one end
  });

  it("quotes multi-line answers and marks blank ones", () => {
    expect(upsertEntry(null, "r", entry(1, "a\nb"))).toContain("> a\n> b");
    expect(upsertEntry(null, "r", entry(1, ""))).toContain("> _(no answer)_");
  });

  it("includes feedback when present", () => {
    const e = entry(1, "x");
    e.feedback = [{ verdict: "partial", feedback: "Close.", stronger_answer: "Say more." }];
    const doc = upsertEntry(null, "r", e);
    expect(doc).toContain("*Feedback (partial):* Close.");
    expect(doc).toContain("*Stronger answer:* Say more.");
  });
});
