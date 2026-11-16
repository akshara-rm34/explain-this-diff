// Splits a unified diff into per-file chunks, drops files that are noise for
// interview questions (lockfiles, build output, binaries), and fits the rest
// under a character budget. Anything left out is reported, never hidden.

export interface FileDiff {
  path: string;
  text: string;
}

export interface PreparedDiff {
  text: string;
  included: string[];
  skipped: { path: string; reason: string }[];
}

const NOISE_PATTERNS: [RegExp, string][] = [
  [/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/, "lockfile"],
  [/(^|\/)(dist|build|out|vendor|node_modules|\.next|coverage)\//, "build output"],
  [/\.min\.(js|css)$/, "minified"],
  [/\.(js|css)\.map$/, "source map"],
  [/\.d\.ts$/, "generated types"],
  [/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|mp4|mov)$/i, "binary"],
  [/\.snap$/, "snapshot"],
];

export function splitDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  const chunks = diff.split(/^(?=diff --git )/m).filter((c) => c.startsWith("diff --git "));
  for (const chunk of chunks) {
    const header = chunk.slice(0, chunk.indexOf("\n"));
    // "diff --git a/foo b/foo" -> take the b/ side so renames show the new name
    const match = header.match(/ b\/(.+)$/);
    files.push({ path: match ? match[1] : header, text: chunk });
  }
  return files;
}

function noiseReason(file: FileDiff): string | null {
  for (const [pattern, reason] of NOISE_PATTERNS) {
    if (pattern.test(file.path)) return reason;
  }
  if (/^Binary files .* differ$/m.test(file.text)) return "binary";
  return null;
}

export function prepareDiff(diff: string, maxChars: number): PreparedDiff {
  const included: FileDiff[] = [];
  const skipped: PreparedDiff["skipped"] = [];

  for (const file of splitDiff(diff)) {
    const reason = noiseReason(file);
    if (reason) skipped.push({ path: file.path, reason });
    else included.push(file);
  }

  // Smallest files first: more files fit, and a huge generated-looking file
  // is the one that gets dropped instead of crowding out real changes.
  included.sort((a, b) => a.text.length - b.text.length);

  const kept: FileDiff[] = [];
  let used = 0;
  for (const file of included) {
    if (used + file.text.length > maxChars) {
      skipped.push({ path: file.path, reason: "over size budget" });
      continue;
    }
    kept.push(file);
    used += file.text.length;
  }

  return {
    text: kept.map((f) => f.text).join(""),
    included: kept.map((f) => f.path),
    skipped,
  };
}
