// Formatting and parsing for the PR comments the bot posts and reads.

import type { Feedback, Question } from "./llm.js";

export const QUESTIONS_MARKER = "<!-- explain-this-diff:questions -->";
const DATA_RE = /<!-- etd-data ([A-Za-z0-9+/=]+) -->/;

export interface QuestionsData {
  questions: Question[];
  sha: string;
}

export function renderQuestionsComment(data: QuestionsData, skipped: { path: string; reason: string }[]): string {
  const list = data.questions
    .map((q, i) => `**${i + 1}.** ${q.question}\n<sub>\`${q.file}\`</sub>`)
    .join("\n\n");

  const skippedNote = skipped.length
    ? `\n\n<details><summary>${skipped.length} file(s) not shown to the model</summary>\n\n${skipped
        .map((s) => `- \`${s.path}\` (${s.reason})`)
        .join("\n")}\n</details>`
    : "";

  // Questions are stored base64-encoded in a hidden comment so the answer
  // step can recover them later without calling the model again.
  const encoded = Buffer.from(JSON.stringify(data)).toString("base64");

  return `${QUESTIONS_MARKER}
### Explain this diff

Three questions an interviewer might ask about this PR.

${list}

Reply with a comment like this to save your answers to the prep doc:

\`\`\`
/answer
1. ...
2. ...
3. ...
\`\`\`${skippedNote}

<!-- etd-data ${encoded} -->`;
}

export function parseQuestionsComment(body: string): QuestionsData | null {
  if (!body.includes(QUESTIONS_MARKER)) return null;
  const match = body.match(DATA_RE);
  if (!match) return null;
  try {
    return JSON.parse(Buffer.from(match[1], "base64").toString("utf8")) as QuestionsData;
  } catch {
    return null;
  }
}

export function isAnswerComment(body: string): boolean {
  return /^\s*\/answer\b/i.test(body);
}

// Parses "/answer" followed by numbered answers. Answers can span several
// lines. Accepts "1.", "1)", "1:", "A1:", "**1.**". Returns answers indexed
// 0..count-1, with "" for any the user skipped.
export function parseAnswers(body: string, count: number): string[] {
  const text = body.replace(/^\s*\/answer\b/i, "");
  const answers: string[] = Array(count).fill("");
  const marker = /^\s*(?:\*\*)?(?:A|Q)?(\d+)\s*[.):](?:\*\*)?\s?/i;

  let current = -1;
  for (const line of text.split("\n")) {
    const m = line.match(marker);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= count) {
        current = n - 1;
        answers[current] = line.slice(m[0].length);
        continue;
      }
    }
    if (current >= 0) answers[current] += "\n" + line;
  }
  return answers.map((a) => a.trim());
}

const VERDICT_LABEL = { solid: "✅ solid", partial: "🟡 partial", missing: "❌ missing" } as const;

export function renderFeedbackComment(
  questions: Question[],
  feedback: Feedback[] | null,
  docUrl: string,
): string {
  if (!feedback) {
    return `Saved your answers to the [prep doc](${docUrl}).`;
  }
  const body = questions
    .map(
      (q, i) => `**${i + 1}. ${VERDICT_LABEL[feedback[i].verdict]}**: ${feedback[i].feedback}

<details><summary>A stronger answer</summary>

${feedback[i].stronger_answer}
</details>`,
    )
    .join("\n\n");
  return `### Feedback on your answers\n\n${body}\n\nSaved to the [prep doc](${docUrl}).`;
}

export const HELP_COMMENT = `I couldn't find any numbered answers. Use this format:

\`\`\`
/answer
1. your answer to question 1
2. your answer to question 2
3. your answer to question 3
\`\`\``;
