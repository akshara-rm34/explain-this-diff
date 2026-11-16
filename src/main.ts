import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  HELP_COMMENT,
  isAnswerComment,
  parseAnswers,
  parseQuestionsComment,
  QUESTIONS_MARKER,
  renderFeedbackComment,
  renderQuestionsComment,
} from "./comments.js";
import { prepareDiff } from "./diff.js";
import { upsertEntry } from "./doc.js";
import { generateQuestions, reviewAnswers, type Effort, type LlmOptions } from "./llm.js";

type Octokit = ReturnType<typeof github.getOctokit>;

interface Config {
  llm: LlmOptions;
  docPath: string;
  feedback: boolean;
  maxDiffChars: number;
  skipDrafts: boolean;
  botLogin: string;
}

const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

function readConfig(): Config {
  return {
    llm: {
      apiKey: core.getInput("anthropic_api_key", { required: true }),
      model: core.getInput("model") || "claude-haiku-5-5",
      effort: (core.getInput("effort") || "high") as Effort,
    },
    docPath: core.getInput("doc_path") || "docs/interview-prep.md",
    feedback: core.getBooleanInput("feedback"),
    maxDiffChars: Number(core.getInput("max_diff_chars") || "60000"),
    skipDrafts: core.getBooleanInput("skip_drafts"),
    botLogin: core.getInput("bot_login") || "github-actions[bot]",
  };
}

async function fetchDiff(octokit: Octokit, prNumber: number): Promise<string> {
  const { owner, repo } = github.context.repo;
  const res = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
    mediaType: { format: "diff" },
  });
  // With the diff media type the API returns the raw diff as a string.
  return res.data as unknown as string;
}

async function findQuestionsComment(octokit: Octokit, prNumber: number, botLogin: string) {
  const { owner, repo } = github.context.repo;
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });
  // Only trust marker comments posted by the bot, so nobody can plant fake questions.
  return comments.find((c) => c.user?.login === botLogin && c.body?.includes(QUESTIONS_MARKER));
}

async function onPullRequest(octokit: Octokit, cfg: Config) {
  const pr = github.context.payload.pull_request;
  if (!pr) return;
  if (cfg.skipDrafts && pr.draft) {
    core.info("Draft PR, skipping.");
    return;
  }

  const existing = await findQuestionsComment(octokit, pr.number, cfg.botLogin);
  if (existing) {
    core.info(`Questions already posted (${existing.html_url}), skipping.`);
    return;
  }

  const prepared = prepareDiff(await fetchDiff(octokit, pr.number), cfg.maxDiffChars);
  if (!prepared.text) {
    core.info("No reviewable changes after filtering, skipping.");
    return;
  }
  core.info(`Sending ${prepared.included.length} file(s), skipped ${prepared.skipped.length}.`);

  const questions = await generateQuestions(cfg.llm, { title: pr.title, body: pr.body ?? "" }, prepared.text);
  const { owner, repo } = github.context.repo;
  const comment = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: pr.number,
    body: renderQuestionsComment({ questions, sha: pr.head.sha }, prepared.skipped),
  });
  core.info(`Posted questions: ${comment.data.html_url}`);
}

async function writeDoc(
  octokit: Octokit,
  path: string,
  branch: string,
  update: (current: string | null) => string,
  message: string,
): Promise<void> {
  const { owner, repo } = github.context.repo;

  // Retry once on a conflict (someone else changed the file between read and write).
  for (let attempt = 0; attempt < 2; attempt++) {
    let current: string | null = null;
    let sha: string | undefined;
    try {
      const res = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch });
      if (!Array.isArray(res.data) && res.data.type === "file") {
        current = Buffer.from(res.data.content, "base64").toString("utf8");
        sha = res.data.sha;
      }
    } catch (err: any) {
      if (err.status !== 404) throw err;
    }

    try {
      await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        branch,
        message,
        content: Buffer.from(update(current)).toString("base64"),
        sha,
      });
      return;
    } catch (err: any) {
      if (attempt === 0 && (err.status === 409 || err.status === 422)) continue;
      throw err;
    }
  }
}

async function onIssueComment(octokit: Octokit, cfg: Config) {
  const { payload } = github.context;
  const issue = payload.issue;
  const comment = payload.comment;
  if (!issue?.pull_request || !comment) return;
  if (comment.user?.type === "Bot") return;
  if (!isAnswerComment(comment.body ?? "")) return;

  const { owner, repo } = github.context.repo;
  const isAuthor = comment.user?.login === issue.user?.login;
  if (!isAuthor && !TRUSTED_ASSOCIATIONS.has(comment.author_association)) {
    core.info(`Ignoring /answer from ${comment.user?.login} (${comment.author_association}).`);
    return;
  }

  const qComment = await findQuestionsComment(octokit, issue.number, cfg.botLogin);
  const data = qComment ? parseQuestionsComment(qComment.body ?? "") : null;
  if (!data) {
    core.info("No questions comment on this PR, nothing to answer.");
    return;
  }

  const answers = parseAnswers(comment.body, data.questions.length);
  if (answers.every((a) => a === "")) {
    await octokit.rest.issues.createComment({ owner, repo, issue_number: issue.number, body: HELP_COMMENT });
    return;
  }

  let feedback = null;
  if (cfg.feedback) {
    const prepared = prepareDiff(await fetchDiff(octokit, issue.number), cfg.maxDiffChars);
    feedback = await reviewAnswers(
      cfg.llm,
      prepared.text,
      data.questions.map((q, i) => ({ question: q.question, answer: answers[i] })),
    );
  }

  const branch: string = payload.repository?.default_branch ?? "main";
  const repoName = `${owner}/${repo}`;
  await writeDoc(
    octokit,
    cfg.docPath,
    branch,
    (current) =>
      upsertEntry(current, repoName, {
        prNumber: issue.number,
        title: issue.title,
        url: issue.html_url ?? `https://github.com/${repoName}/pull/${issue.number}`,
        date: new Date().toISOString().slice(0, 10),
        questions: data.questions,
        answers,
        feedback,
      }),
    `docs: interview prep answers for #${issue.number}`,
  );

  const docUrl = `https://github.com/${repoName}/blob/${branch}/${cfg.docPath}`;
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issue.number,
    body: renderFeedbackComment(data.questions, feedback, docUrl),
  });
  await octokit.rest.reactions.createForIssueComment({ owner, repo, comment_id: comment.id, content: "rocket" });
}

export async function run(): Promise<void> {
  try {
    const cfg = readConfig();
    const octokit = github.getOctokit(core.getInput("github_token", { required: true }));
    switch (github.context.eventName) {
      case "pull_request":
      case "pull_request_target":
        await onPullRequest(octokit, cfg);
        break;
      case "issue_comment":
        await onIssueComment(octokit, cfg);
        break;
      default:
        core.info(`Event ${github.context.eventName} not handled.`);
    }
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}
