// ============================================================================
// LAZARUS — Builder Diff Computer
// Computes unified diffs between original and generated files
// ============================================================================

import type { FileDiff } from '../../shared/types';

// ---------------------------------------------------------------------------
// Main diff function
// ---------------------------------------------------------------------------

export function computeDiff(
  original: string,
  generated: string,
  originalPath: string,
  generatedPath: string
): FileDiff {
  const originalLines = original.split('\n');
  const generatedLines = generated.split('\n');

  const hunks = computeHunks(originalLines, generatedLines);

  let additions = 0;
  let deletions = 0;

  for (const hunk of hunks) {
    for (const change of hunk.changes) {
      if (change.type === 'add') additions++;
      else if (change.type === 'del') deletions++;
    }
  }

  return {
    originalPath,
    generatedPath,
    hunks,
    additions,
    deletions,
    isBinary: false,
  };
}

// ---------------------------------------------------------------------------
// Hunk computation (simplified Myers diff)
// ---------------------------------------------------------------------------

interface DiffHunk {
  originalStart: number;
  originalLength: number;
  generatedStart: number;
  generatedLength: number;
  changes: DiffChange[];
}

interface DiffChange {
  type: 'add' | 'del' | 'context';
  content: string;
  lineNumber: number;
}

function computeHunks(original: string[], generated: string[]): DiffHunk[] {
  // Compute LCS-based diff
  const lcs = computeLCS(original, generated);
  const changes = buildChanges(original, generated, lcs);

  // Group into hunks with context
  return groupIntoHunks(changes, 3);
}

function computeLCS(
  a: string[],
  b: string[]
): Array<[number, number]> {
  const m = a.length;
  const n = b.length;

  // For very large files, use a simplified approach
  if (m * n > 10_000_000) {
    return simplifiedLCS(a, b);
  }

  // Standard DP-based LCS
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to get the actual LCS pairs
  const pairs: Array<[number, number]> = [];
  let i = m;
  let j = n;

  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      pairs.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return pairs;
}

function simplifiedLCS(
  a: string[],
  b: string[]
): Array<[number, number]> {
  // Use a hash-based approach for large files
  const bMap = new Map<string, number[]>();
  for (let j = 0; j < b.length; j++) {
    const line = b[j];
    if (!bMap.has(line)) bMap.set(line, []);
    bMap.get(line)!.push(j);
  }

  const pairs: Array<[number, number]> = [];
  let lastJ = -1;

  for (let i = 0; i < a.length; i++) {
    const positions = bMap.get(a[i]);
    if (positions) {
      // Find the smallest j > lastJ
      for (const j of positions) {
        if (j > lastJ) {
          pairs.push([i, j]);
          lastJ = j;
          break;
        }
      }
    }
  }

  return pairs;
}

function buildChanges(
  original: string[],
  generated: string[],
  lcs: Array<[number, number]>
): DiffChange[] {
  const changes: DiffChange[] = [];
  let oi = 0;
  let gi = 0;
  let li = 0;

  while (oi < original.length || gi < generated.length) {
    if (li < lcs.length) {
      const [lcsO, lcsG] = lcs[li];

      // Deletions before the LCS match
      while (oi < lcsO) {
        changes.push({ type: 'del', content: original[oi], lineNumber: oi + 1 });
        oi++;
      }

      // Additions before the LCS match
      while (gi < lcsG) {
        changes.push({ type: 'add', content: generated[gi], lineNumber: gi + 1 });
        gi++;
      }

      // Context line (LCS match)
      changes.push({ type: 'context', content: original[oi], lineNumber: oi + 1 });
      oi++;
      gi++;
      li++;
    } else {
      // Remaining lines after LCS
      while (oi < original.length) {
        changes.push({ type: 'del', content: original[oi], lineNumber: oi + 1 });
        oi++;
      }
      while (gi < generated.length) {
        changes.push({ type: 'add', content: generated[gi], lineNumber: gi + 1 });
        gi++;
      }
    }
  }

  return changes;
}

function groupIntoHunks(changes: DiffChange[], contextLines: number): DiffHunk[] {
  if (changes.length === 0) return [];

  const hunks: DiffHunk[] = [];
  let currentHunk: DiffChange[] = [];
  let lastNonContextIdx = -1;

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];

    if (change.type !== 'context') {
      // Include context before this change
      const contextStart = Math.max(lastNonContextIdx + 1, i - contextLines);

      if (currentHunk.length === 0) {
        // Start new hunk with context
        for (let j = contextStart; j < i; j++) {
          if (changes[j].type === 'context') {
            currentHunk.push(changes[j]);
          }
        }
      } else {
        // Check if we need to start a new hunk
        const gapSize = i - lastNonContextIdx - 1;
        if (gapSize > contextLines * 2) {
          // Add trailing context to current hunk
          for (let j = lastNonContextIdx + 1; j < lastNonContextIdx + 1 + contextLines && j < i; j++) {
            if (changes[j].type === 'context') {
              currentHunk.push(changes[j]);
            }
          }

          // Finalize current hunk
          hunks.push(buildHunk(currentHunk));
          currentHunk = [];

          // Add leading context for new hunk
          for (let j = Math.max(0, i - contextLines); j < i; j++) {
            if (changes[j].type === 'context') {
              currentHunk.push(changes[j]);
            }
          }
        } else {
          // Add all context between changes
          for (let j = lastNonContextIdx + 1; j < i; j++) {
            currentHunk.push(changes[j]);
          }
        }
      }

      currentHunk.push(change);
      lastNonContextIdx = i;
    }
  }

  // Add trailing context and finalize last hunk
  if (currentHunk.length > 0) {
    for (let j = lastNonContextIdx + 1; j < Math.min(changes.length, lastNonContextIdx + 1 + contextLines); j++) {
      if (changes[j].type === 'context') {
        currentHunk.push(changes[j]);
      }
    }
    hunks.push(buildHunk(currentHunk));
  }

  return hunks;
}

function buildHunk(changes: DiffChange[]): DiffHunk {
  let originalStart = Infinity;
  let generatedStart = Infinity;
  let originalLength = 0;
  let generatedLength = 0;

  for (const change of changes) {
    if (change.type === 'del' || change.type === 'context') {
      originalStart = Math.min(originalStart, change.lineNumber);
      originalLength++;
    }
    if (change.type === 'add' || change.type === 'context') {
      generatedStart = Math.min(generatedStart, change.lineNumber);
      generatedLength++;
    }
  }

  return {
    originalStart: originalStart === Infinity ? 1 : originalStart,
    originalLength,
    generatedStart: generatedStart === Infinity ? 1 : generatedStart,
    generatedLength,
    changes,
  };
}
