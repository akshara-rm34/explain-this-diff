// Try the question prompt locally on any diff, without GitHub.
//   git diff main | npx tsx scripts/try.ts
//   npx tsx scripts/try.ts some.diff
// Needs ANTHROPIC_API_KEY in the environment.

import { readFileSync } from "node:fs";
import { prepareDiff } from "../src/diff.js";
import { generateQuestions, type Effort } from "../src/llm.js";

const path = process.argv[2];
const raw = readFileSync(path ?? 0, "utf8");
const prepared = prepareDiff(raw, 60000);

console.error(`files sent: ${prepared.included.join(", ") || "(none)"}`);
for (const s of prepared.skipped) console.error(`skipped: ${s.path} (${s.reason})`);
if (!prepared.text) process.exit(0);

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Set ANTHROPIC_API_KEY first.");
  process.exit(1);
}

const questions = await generateQuestions(
  {
    apiKey,
    model: process.env.MODEL ?? "claude-opus-5-5",
    effort: (process.env.EFFORT ?? "high") as Effort,
  },
  { title: process.env.TITLE ?? "(local diff)", body: "" },
  prepared.text,
);
questions.forEach((q, i) => console.log(`${i + 1}. ${q.question}\n   (${q.file})\n`));
