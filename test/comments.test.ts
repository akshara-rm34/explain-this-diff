import { describe, expect, it } from "vitest";
import {
  isAnswerComment,
  parseAnswers,
  parseQuestionsComment,
  renderQuestionsComment,
} from "../src/comments.js";

const questions = [
  { question: "Why a Map instead of an object?", file: "src/cache.ts" },
  { question: "What happens if the lock is never released? -->", file: "src/lock.ts" },
  { question: "Why sort before dedup?", file: "src/list.ts" },
];

describe("questions comment", () => {
  it("round-trips the questions through the hidden data block", () => {
    const body = renderQuestionsComment({ questions, sha: "abc123" }, []);
    expect(parseQuestionsComment(body)).toEqual({ questions, sha: "abc123" });
  });

  it("lists skipped files", () => {
    const body = renderQuestionsComment({ questions, sha: "x" }, [{ path: "yarn.lock", reason: "lockfile" }]);
    expect(body).toContain("`yarn.lock` (lockfile)");
  });

  it("ignores comments without the marker", () => {
    expect(parseQuestionsComment("just a comment")).toBeNull();
  });
});

describe("parseAnswers", () => {
  it("recognizes the command", () => {
    expect(isAnswerComment("/answer\n1. hi")).toBe(true);
    expect(isAnswerComment("  /Answer 1. hi")).toBe(true);
    expect(isAnswerComment("my /answer is")).toBe(false);
  });

  it("parses numbered answers, including multi-line ones", () => {
    const body = "/answer\n1. Lookups are O(1)\nand keys can be any type.\n2) It times out after 30s\n3: Dedup needs adjacent duplicates";
    expect(parseAnswers(body, 3)).toEqual([
      "Lookups are O(1)\nand keys can be any type.",
      "It times out after 30s",
      "Dedup needs adjacent duplicates",
    ]);
  });

  it("accepts A1:/bold styles and leaves skipped answers empty", () => {
    expect(parseAnswers("/answer\nA1: first\n**3.** third", 3)).toEqual(["first", "", "third"]);
  });

  it("ignores numbers outside the question range", () => {
    expect(parseAnswers("/answer\n1. see step\n4. not a question", 3)[0]).toBe("see step\n4. not a question");
  });

  it("returns all empty when nothing is numbered", () => {
    expect(parseAnswers("/answer I dunno", 3)).toEqual(["", "", ""]);
  });
});
