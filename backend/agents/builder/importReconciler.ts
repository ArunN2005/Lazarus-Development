// ============================================================================
// LAZARUS — Builder Import Reconciler
// Scans all generated files and fixes broken imports
// ============================================================================

import { s3 } from '../../shared/s3';
import { bedrock, MODELS } from '../../shared/bedrock';
import { log } from '../../shared/logger';
import { getConfig } from '../../shared/config';
import type { GenerationContext } from '../../shared/types';

// ---------------------------------------------------------------------------
// Main reconciliation
// ---------------------------------------------------------------------------

export async function reconcileImports(
  projectId: string,
  context: GenerationContext
): Promise<number> {
  const config = getConfig();
  let fixedCount = 0;

  // Build a set of all generated file paths
  const allPaths = new Set<string>(context.generatedFiles?.keys() ?? []);

  // Build a map of exported symbols per file
  const exportMap = buildExportMap(context.generatedFiles ?? new Map());

  for (const [filePath, content] of (context.generatedFiles ?? new Map())) {
    if (!isJSOrTS(filePath)) continue;

    const fixes = findBrokenImports(filePath, content, allPaths, exportMap);

    if (fixes.length > 0) {
      let fixedContent = content;

      for (const fix of fixes) {
        fixedContent = fixedContent.replace(fix.original, fix.replacement);
      }

      // Upload fixed file
      await s3.uploadText(
        config.projectsBucket,
        `${projectId}/generated/${filePath}`,
        fixedContent
      );

      context.generatedFiles?.set(filePath, fixedContent);
      fixedCount += fixes.length;

      log('info', 'Fixed imports', {
        projectId,
        file: filePath,
        fixes: fixes.length,
      });
    }
  }

  return fixedCount;
}

// ---------------------------------------------------------------------------
// Import analysis
// ---------------------------------------------------------------------------

interface ImportFix {
  original: string;
  replacement: string;
  reason: string;
}

function findBrokenImports(
  filePath: string,
  content: string,
  allPaths: Set<string>,
  exportMap: Map<string, Set<string>>
): ImportFix[] {
  const fixes: ImportFix[] = [];
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));

  // Match import statements
  const importRegex = /^(import\s+(?:(?:\{[^}]*\}|[\w*]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+))['"]([^'"]+)['"](;?\s*)$/gm;
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(content)) !== null) {
    const fullMatch = match[0];
    const prefix = match[1];
    const importPath = match[2];
    const suffix = match[3];

    // Only check relative imports
    if (!importPath.startsWith('.')) continue;

    const resolved = resolveRelativePath(dir, importPath);
    const resolvedWithExt = tryResolveWithExtensions(resolved, allPaths);

    if (!resolvedWithExt) {
      // Import doesn't resolve — try to find the correct path
      const fileName = importPath.split('/').pop() ?? '';
      const candidates = findByFileName(fileName, allPaths);

      if (candidates.length === 1) {
        const newRelativePath = computeRelativePath(dir, candidates[0]);
        fixes.push({
          original: fullMatch,
          replacement: `${prefix}'${newRelativePath}'${suffix}`,
          reason: `Resolved broken import to ${candidates[0]}`,
        });
      } else if (candidates.length > 1) {
        // Pick the closest one
        const closest = candidates.sort(
          (a, b) => pathDistance(filePath, a) - pathDistance(filePath, b)
        )[0];
        const newRelativePath = computeRelativePath(dir, closest);
        fixes.push({
          original: fullMatch,
          replacement: `${prefix}'${newRelativePath}'${suffix}`,
          reason: `Resolved ambiguous import to closest: ${closest}`,
        });
      }
    } else {
      // Check if the import path has an unnecessary extension
      const withoutExt = importPath.replace(/\.(ts|tsx|js|jsx)$/, '');
      if (withoutExt !== importPath) {
        fixes.push({
          original: fullMatch,
          replacement: `${prefix}'${withoutExt}'${suffix}`,
          reason: 'Removed unnecessary file extension from import',
        });
      }
    }
  }

  // Check for named imports that don't exist in the target file
  const namedImportRegex = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = namedImportRegex.exec(content)) !== null) {
    const names = match[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    const importPath = match[2];

    if (!importPath.startsWith('.')) continue;

    const resolved = resolveRelativePath(dir, importPath);
    const resolvedFile = tryResolveWithExtensions(resolved, allPaths);

    if (resolvedFile) {
      const fileExports = exportMap.get(resolvedFile);
      if (fileExports) {
        const missing = names.filter((n) => !fileExports.has(n) && n !== 'type');
        if (missing.length > 0) {
          log('warn', 'Named imports not found in target', {
            file: filePath,
            target: resolvedFile,
            missing,
          });
        }
      }
    }
  }

  return fixes;
}

// ---------------------------------------------------------------------------
// Export map builder
// ---------------------------------------------------------------------------

function buildExportMap(files: Map<string, string>): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();

  for (const [filePath, content] of files) {
    if (!isJSOrTS(filePath)) continue;

    const exports = new Set<string>();

    // Named exports
    const namedRegex = /export\s+(?:const|let|var|function|class|interface|type|enum|async\s+function)\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = namedRegex.exec(content)) !== null) {
      exports.add(match[1]);
    }

    // Export { name }
    const braceRegex = /export\s+\{([^}]+)\}/g;
    while ((match = braceRegex.exec(content)) !== null) {
      const names = match[1].split(',').map((s) => {
        const parts = s.trim().split(/\s+as\s+/);
        return parts[parts.length - 1].trim();
      }).filter(Boolean);
      for (const name of names) {
        exports.add(name);
      }
    }

    // Default export
    if (/export\s+default/.test(content)) {
      exports.add('default');
    }

    map.set(filePath, exports);
  }

  return map;
}

// ---------------------------------------------------------------------------
// Path resolution helpers
// ---------------------------------------------------------------------------

function resolveRelativePath(fromDir: string, importPath: string): string {
  const parts = fromDir.split('/').filter(Boolean);

  for (const segment of importPath.split('/')) {
    if (segment === '.') continue;
    if (segment === '..') {
      parts.pop();
    } else {
      parts.push(segment);
    }
  }

  return parts.join('/');
}

function tryResolveWithExtensions(
  resolved: string,
  allPaths: Set<string>
): string | null {
  if (allPaths.has(resolved)) return resolved;

  const extensions = ['.ts', '.tsx', '.js', '.jsx'];
  for (const ext of extensions) {
    if (allPaths.has(resolved + ext)) return resolved + ext;
  }

  // Try index files
  const indexExtensions = ['/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
  for (const ext of indexExtensions) {
    if (allPaths.has(resolved + ext)) return resolved + ext;
  }

  return null;
}

function findByFileName(fileName: string, allPaths: Set<string>): string[] {
  const cleanName = fileName.replace(/\.(ts|tsx|js|jsx)$/, '');
  const results: string[] = [];

  for (const p of allPaths) {
    const pName = p.split('/').pop()?.replace(/\.(ts|tsx|js|jsx)$/, '') ?? '';
    if (pName === cleanName) {
      results.push(p);
    }
  }

  return results;
}

function computeRelativePath(fromDir: string, toPath: string): string {
  const fromParts = fromDir.split('/').filter(Boolean);
  const toParts = toPath.split('/').filter(Boolean);

  // Remove extension from import path
  const toFile = toParts.pop() ?? '';
  const toFileNoExt = toFile.replace(/\.(ts|tsx|js|jsx)$/, '');

  // Find common prefix
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }

  const ups = fromParts.length - common;
  const downs = toParts.slice(common);

  let relativePath = '';
  if (ups === 0) {
    relativePath = './' + [...downs, toFileNoExt].join('/');
  } else {
    relativePath = '../'.repeat(ups) + [...downs, toFileNoExt].join('/');
  }

  return relativePath;
}

function pathDistance(a: string, b: string): number {
  const aParts = a.split('/');
  const bParts = b.split('/');

  let common = 0;
  while (
    common < aParts.length &&
    common < bParts.length &&
    aParts[common] === bParts[common]
  ) {
    common++;
  }

  return (aParts.length - common) + (bParts.length - common);
}

function isJSOrTS(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filePath);
}
