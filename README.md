# Explain This Diff

A GitHub Action that turns your pull requests into interview prep.

When you open a PR, it posts 3 "why does this work" questions about the change. You reply with `/answer`, it gives feedback on each answer, and it saves the Q&A to `docs/interview-prep.md` in the repo. Over time you end up with a prep doc for every project you'd talk about in an interview.

## How it works

```
PR opened ──> fetch diff ──> filter + trim ──> Claude ──> questions comment
                                                              │
you reply "/answer 1. ... 2. ... 3. ..."  <───────────────────┘
       │
       └──> parse answers ──> Claude feedback ──> commit to prep doc ──> feedback comment
```

- **Diff filtering.** Lockfiles, build output, binaries and snapshots are dropped. The rest is fit under a character budget, smallest files first. Anything left out is listed in the comment, so you can tell what the model didn't see.
- **No re-asking.** The questions are stored in a hidden block in the bot's comment, so the answer step doesn't need to regenerate them. Only comments posted by the bot account are trusted.
- **Prep doc.** Each PR gets one section between markers. Answering again replaces your old answer instead of adding a duplicate.
- **Who can answer.** Only the PR author or repo owners, members and collaborators. Random commenters on a public repo can't run up your API bill.

## Setup

1. Add your Anthropic API key as a repo secret named `ANTHROPIC_API_KEY`.
2. Add `.github/workflows/explain-this-diff.yml`:

```yaml
name: Explain This Diff
on:
  pull_request:
    types: [opened, ready_for_review]
  issue_comment:
    types: [created]
permissions:
  contents: write
  pull-requests: write
  issues: write
jobs:
  explain:
    if: github.event_name == 'pull_request' || (github.event.issue.pull_request && startsWith(github.event.comment.body, '/answer'))
    runs-on: ubuntu-latest
    steps:
      - uses: <your-username>/explain-this-diff@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

3. Open a PR.

The prep doc is committed straight to the default branch. If that branch is protected, the commit will fail. Use an unprotected repo, or change `doc_path`.

## Options

| Input | Default | |
|---|---|---|
| `model` | `claude-opus-5-5` | Claude model ID |
| `effort` | `high` | `low` / `medium` / `high` / `xhigh` / `max`. Lower is cheaper |
| `doc_path` | `docs/interview-prep.md` | Where the prep doc goes |
| `feedback` | `true` | Grade answers and suggest stronger ones |
| `max_diff_chars` | `60000` | Diff budget sent to the model |
| `skip_drafts` | `true` | Wait until the PR is ready for review |

## Development

```bash
npm install
npm run all                              # typecheck, test, build dist/
git diff main | npm run try              # try the question prompt on a local diff
```

`dist/index.js` is committed because Actions runs it directly. Run `npm run build` before you push changes to `src/`.

## Limitations

- Only asks once per PR. Pushing more commits doesn't make new questions.
- PRs from forks don't get repo secrets, so it only works on PRs from branches in the repo itself.
- Very large PRs get trimmed. The comment tells you which files were skipped.

## Ideas for later

- Skip questions that are too close to ones already in the prep doc (semantic dedup)
- `/explain-this-diff refresh` to regenerate after big pushes
- VS Code sidebar to quiz yourself from the prep doc
- Publish to the GitHub Marketplace
