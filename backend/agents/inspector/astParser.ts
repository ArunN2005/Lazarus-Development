// ============================================================================
// LAZARUS — Inspector AST Parser
// Parses source files to extract imports, exports, functions, classes, env vars
// ============================================================================

import { type FileAnalysis, type ImportInfo, type ExportInfo, type FunctionInfo } from '../../shared/types';

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

export function parseFile(filePath: string, content: string): FileAnalysis | null {
  const ext = getExtension(filePath);
  const language = detectLanguage(ext);

  if (!language) return null;

  const lines = content.split('\n');
  const lineCount = lines.length;

  const imports = parseImports(content, language);
  const exports = parseExports(content, language);
  const functions = parseFunctions(content, language);
  const classes = parseClasses(content, language);
  const envVarRefs = extractEnvVarReferences(content);
  const hasJSX = language === 'typescript' || language === 'javascript'
    ? detectJSX(content)
    : false;
  const complexity = estimateComplexity(content, language);

  return {
    filePath,
    language,
    extension: getExtension(filePath),
    lineCount,
    sizeBytes: Buffer.byteLength(content, 'utf8'),
    imports,
    exports,
    routes: [],
    functions,
    classes,
    models: [],
    components: [],
    envVars: envVarRefs,
    hooks: [],
    envVarRefs,
    hasJSX,
    complexity: String(complexity),
    isEntryPoint: isEntryPoint(filePath, content, language),
    isConfig: isConfigFile(filePath),
    isTest: isTestFile(filePath),
    hasDefaultExport: exports.some((e) => e.isDefault),
    framework: null, // Set later by stackDetector
    dependencies: imports.map((i) => i.source).filter((s) => !s.startsWith('.')),
  };
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

function getExtension(filePath: string): string {
  const parts = filePath.split('.');
  return parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
}

function detectLanguage(ext: string): string | null {
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml',
    '.md': 'markdown',
    '.mdx': 'markdown',
    '.css': 'css',
    '.scss': 'scss',
    '.less': 'less',
    '.html': 'html',
    '.htm': 'html',
    '.vue': 'vue',
    '.svelte': 'svelte',
    '.rs': 'rust',
    '.go': 'go',
    '.java': 'java',
    '.kt': 'kotlin',
    '.swift': 'swift',
    '.rb': 'ruby',
    '.php': 'php',
    '.sql': 'sql',
    '.graphql': 'graphql',
    '.gql': 'graphql',
    '.sh': 'shell',
    '.bash': 'shell',
    '.zsh': 'shell',
    '.dockerfile': 'dockerfile',
    '.tf': 'terraform',
    '.prisma': 'prisma',
    '.proto': 'protobuf',
    '.xml': 'xml',
    '.env': 'dotenv',
  };

  // Check for special filenames
  return map[ext.toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Import parsing
// ---------------------------------------------------------------------------

function parseImports(content: string, language: string): ImportInfo[] {
  switch (language) {
    case 'typescript':
    case 'javascript':
    case 'vue':
    case 'svelte':
      return parseJSImports(content);
    case 'python':
      return parsePythonImports(content);
    case 'go':
      return parseGoImports(content);
    default:
      return [];
  }
}

function parseJSImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  // ES import statements
  const esImportRegex = /import\s+(?:(?:(\{[^}]*\})|(\*\s+as\s+\w+)|(\w+))(?:\s*,\s*(?:(\{[^}]*\})|(\*\s+as\s+\w+)|(\w+)))?\s+from\s+)?['"]([@\w\/.\\-]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = esImportRegex.exec(content)) !== null) {
    const source = match[7];
    const names: string[] = [];

    // Named imports
    if (match[1]) {
      const named = match[1].replace(/[{}]/g, '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      names.push(...named);
    }
    // Namespace import
    if (match[2]) {
      names.push(match[2].replace(/\*\s+as\s+/, '').trim());
    }
    // Default import
    if (match[3]) {
      names.push(match[3]);
    }

    imports.push({
      source,
      specifiers: names,
      names,
      isDefault: !!match[3],
      isNamespace: !!match[2],
      isDynamic: false,
    });
  }

  // require() calls
  const requireRegex = /(?:const|let|var)\s+(?:(\{[^}]*\})|(\w+))\s*=\s*require\s*\(\s*['"]([@\w\/.\\-]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(content)) !== null) {
    const source = match[3];
    const names: string[] = [];

    if (match[1]) {
      const named = match[1].replace(/[{}]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
      names.push(...named);
    }
    if (match[2]) {
      names.push(match[2]);
    }

    imports.push({
      source,
      specifiers: names,
      names,
      isDefault: !!match[2],
      isNamespace: false,
      isDynamic: false,
    });
  }

  // Dynamic imports
  const dynamicImportRegex = /import\s*\(\s*['"]([@\w\/.\\-]+)['"]\s*\)/g;
  while ((match = dynamicImportRegex.exec(content)) !== null) {
    imports.push({
      source: match[1],
      specifiers: [],
      names: [],
      isDefault: false,
      isNamespace: false,
      isDynamic: true,
    });
  }

  return imports;
}

function parsePythonImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  // from X import Y
  const fromImportRegex = /^from\s+([\w.]+)\s+import\s+(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = fromImportRegex.exec(content)) !== null) {
    const source = match[1];
    const items = match[2].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    imports.push({
      source,
      specifiers: items,
      names: items,
      isDefault: false,
      isNamespace: false,
      isDynamic: false,
    });
  }

  // import X
  const importRegex = /^import\s+([\w.]+)(?:\s+as\s+(\w+))?$/gm;
  while ((match = importRegex.exec(content)) !== null) {
    const names = [match[2] ?? match[1].split('.').pop() ?? match[1]];
    imports.push({
      source: match[1],
      specifiers: names,
      names,
      isDefault: true,
      isNamespace: false,
      isDynamic: false,
    });
  }

  return imports;
}

function parseGoImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const match = content.match(/import\s*\(([\s\S]*?)\)/);
  
  if (match) {
    const lines = match[1].split('\n');
    for (const line of lines) {
      const trimmed = line.trim().replace(/"/g, '').trim();
      if (trimmed && !trimmed.startsWith('//')) {
        const goNames = [trimmed.split('/').pop() ?? trimmed];
        imports.push({
          source: trimmed,
          specifiers: goNames,
          names: goNames,
          isDefault: false,
          isNamespace: false,
          isDynamic: false,
        });
      }
    }
  }

  // Single import
  const singleRegex = /^import\s+"([^"]+)"/gm;
  let singleMatch: RegExpExecArray | null;
  while ((singleMatch = singleRegex.exec(content)) !== null) {
    const singleNames = [singleMatch[1].split('/').pop() ?? singleMatch[1]];
    imports.push({
      source: singleMatch[1],
      specifiers: singleNames,
      names: singleNames,
      isDefault: false,
      isNamespace: false,
      isDynamic: false,
    });
  }

  return imports;
}

// ---------------------------------------------------------------------------
// Export parsing
// ---------------------------------------------------------------------------

function parseExports(content: string, language: string): ExportInfo[] {
  if (language !== 'typescript' && language !== 'javascript') return [];

  const exports: ExportInfo[] = [];

  // export default
  const defaultExportRegex = /export\s+default\s+(?:(?:class|function|const|let|var)\s+)?(\w+)?/g;
  let match: RegExpExecArray | null;

  while ((match = defaultExportRegex.exec(content)) !== null) {
    exports.push({
      name: match[1] ?? 'default',
      isDefault: true,
      type: 'unknown' as const,
      isType: false,
    });
  }

  // Named exports
  const namedExportRegex = /export\s+(?:(type|interface|enum|const|let|var|function|class|async\s+function)\s+)(\w+)/g;
  while ((match = namedExportRegex.exec(content)) !== null) {
    const kind = match[1];
    exports.push({
      name: match[2],
      isDefault: false,
      type: (kind as ExportInfo['type']) ?? 'unknown',
      isType: kind === 'type' || kind === 'interface',
    });
  }

  // Re-exports
  const reExportRegex = /export\s+\{([^}]*)\}\s+from\s+['"]([@\w\/.\\-]+)['"]/g;
  while ((match = reExportRegex.exec(content)) !== null) {
    const names = match[1].split(',').map((s) => {
      const parts = s.trim().split(/\s+as\s+/);
      return parts[parts.length - 1].trim();
    }).filter(Boolean);

    for (const name of names) {
      exports.push({
        name,
        isDefault: false,
        type: 'unknown' as const,
        isType: false,
      });
    }
  }

  // module.exports
  if (/module\.exports\s*=/.test(content)) {
    exports.push({
      name: 'default',
      isDefault: true,
      type: 'unknown' as const,
      isType: false,
    });
  }

  return exports;
}

// ---------------------------------------------------------------------------
// Function parsing
// ---------------------------------------------------------------------------

function parseFunctions(content: string, language: string): FunctionInfo[] {
  if (language !== 'typescript' && language !== 'javascript' && language !== 'python') {
    return [];
  }

  const functions: FunctionInfo[] = [];

  if (language === 'typescript' || language === 'javascript') {
    // Function declarations
    const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
    let match: RegExpExecArray | null;

    while ((match = funcRegex.exec(content)) !== null) {
      functions.push({
        name: match[1],
        params: parseParams(match[2]),
        isAsync: content.substring(match.index, match.index + match[0].length).includes('async'),
        isExported: content.substring(match.index, match.index + match[0].length).includes('export'),
        lineNumber: getLineNumber(content, match.index),
      });
    }

    // Arrow functions assigned to variables
    const arrowRegex = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*[^=]+)?\s*=>/g;
    while ((match = arrowRegex.exec(content)) !== null) {
      functions.push({
        name: match[1],
        params: parseParams(match[2]),
        isAsync: content.substring(match.index, match.index + match[0].length).includes('async'),
        isExported: content.substring(match.index, match.index + match[0].length).includes('export'),
        lineNumber: getLineNumber(content, match.index),
      });
    }
  }

  if (language === 'python') {
    const pyFuncRegex = /^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/gm;
    let match: RegExpExecArray | null;

    while ((match = pyFuncRegex.exec(content)) !== null) {
      functions.push({
        name: match[1],
        params: match[2].split(',').map((s) => s.trim().split(':')[0].trim()).filter(Boolean),
        isAsync: match[0].startsWith('async'),
        isExported: !match[1].startsWith('_'),
        lineNumber: getLineNumber(content, match.index),
      });
    }
  }

  return functions;
}

function parseParams(paramStr: string): string[] {
  return paramStr
    .split(',')
    .map((s) => s.trim().split(':')[0].split('=')[0].trim())
    .filter((s) => s && s !== '');
}

// ---------------------------------------------------------------------------
// Class parsing
// ---------------------------------------------------------------------------

function parseClasses(content: string, language: string): string[] {
  if (language !== 'typescript' && language !== 'javascript' && language !== 'python') {
    return [];
  }

  const classes: string[] = [];

  if (language === 'typescript' || language === 'javascript') {
    const classRegex = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = classRegex.exec(content)) !== null) {
      classes.push(match[1]);
    }
  }

  if (language === 'python') {
    const classRegex = /^class\s+(\w+)/gm;
    let match: RegExpExecArray | null;
    while ((match = classRegex.exec(content)) !== null) {
      classes.push(match[1]);
    }
  }

  return classes;
}

// ---------------------------------------------------------------------------
// Env var reference extraction
// ---------------------------------------------------------------------------

function extractEnvVarReferences(content: string): string[] {
  const vars = new Set<string>();

  // process.env.X
  const processEnvRegex = /process\.env\.(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = processEnvRegex.exec(content)) !== null) {
    vars.add(match[1]);
  }

  // process.env['X'] or process.env["X"]
  const processEnvBracketRegex = /process\.env\[['"](\w+)['"]\]/g;
  while ((match = processEnvBracketRegex.exec(content)) !== null) {
    vars.add(match[1]);
  }

  // os.environ / os.getenv
  const pythonEnvRegex = /os\.(?:environ(?:\.get)?\s*\(\s*|getenv\s*\(\s*)['"](\w+)['"]/g;
  while ((match = pythonEnvRegex.exec(content)) !== null) {
    vars.add(match[1]);
  }

  // import.meta.env.X (Vite)
  const viteEnvRegex = /import\.meta\.env\.(\w+)/g;
  while ((match = viteEnvRegex.exec(content)) !== null) {
    vars.add(match[1]);
  }

  // NEXT_PUBLIC_ in JSX/TSX
  const nextPublicRegex = /\b(NEXT_PUBLIC_\w+)\b/g;
  while ((match = nextPublicRegex.exec(content)) !== null) {
    vars.add(match[1]);
  }

  return Array.from(vars);
}

// ---------------------------------------------------------------------------
// JSX detection
// ---------------------------------------------------------------------------

function detectJSX(content: string): boolean {
  return /<\w+[\s/>]/.test(content) && /(import|from)\s+['"]react/.test(content);
}

// ---------------------------------------------------------------------------
// Complexity estimation
// ---------------------------------------------------------------------------

function estimateComplexity(content: string, language: string): number {
  let score = 0;

  // Cyclomatic complexity estimation
  const conditionals = (content.match(/\b(if|else if|switch|case|catch|while|for|do)\b/g) ?? []).length;
  score += conditionals;

  // Ternary operators
  score += (content.match(/\?[^?]/g) ?? []).length;

  // Logical operators
  score += (content.match(/&&|\|\|/g) ?? []).length;

  // Nested callbacks / promises
  score += (content.match(/\.then\s*\(/g) ?? []).length;
  score += (content.match(/\.catch\s*\(/g) ?? []).length;

  // Line count factor
  const lines = content.split('\n').length;
  if (lines > 500) score += 10;
  else if (lines > 200) score += 5;
  else if (lines > 100) score += 2;

  return score;
}

// ---------------------------------------------------------------------------
// File classification helpers
// ---------------------------------------------------------------------------

function isEntryPoint(filePath: string, content: string, language: string): boolean {
  const entryNames = [
    'index', 'main', 'app', 'server', 'handler',
    'lambda', 'worker', 'cli', 'start', 'boot',
  ];

  const fileName = filePath.split('/').pop()?.split('.')[0]?.toLowerCase() ?? '';
  if (entryNames.includes(fileName)) return true;

  // package.json "main" field
  if (filePath.endsWith('package.json')) return true;

  // Python entry points
  if (language === 'python' && content.includes("if __name__ == '__main__'")) return true;

  // Express/Fastify server
  if (/\.listen\s*\(\s*\d+|createServer\s*\(/.test(content)) return true;

  return false;
}

function isConfigFile(filePath: string): boolean {
  const configPatterns = [
    /^\.env/,
    /\.config\.(ts|js|mjs|cjs)$/,
    /tsconfig.*\.json$/,
    /package\.json$/,
    /webpack/,
    /vite\.config/,
    /next\.config/,
    /tailwind\.config/,
    /postcss\.config/,
    /babel\.config/,
    /\.babelrc/,
    /\.eslintrc/,
    /\.prettierrc/,
    /jest\.config/,
    /vitest\.config/,
    /rollup\.config/,
    /Dockerfile/i,
    /docker-compose/i,
    /Makefile/i,
    /\.github\//,
    /requirements\.txt/,
    /pyproject\.toml/,
    /setup\.(py|cfg)/,
    /Pipfile/,
    /poetry\.lock/,
    /Cargo\.toml/,
    /go\.(mod|sum)/,
  ];

  return configPatterns.some((p) => p.test(filePath));
}

function isTestFile(filePath: string): boolean {
  const testPatterns = [
    /\.test\.(ts|tsx|js|jsx)$/,
    /\.spec\.(ts|tsx|js|jsx)$/,
    /__tests__\//,
    /test_.*\.py$/,
    /.*_test\.py$/,
    /tests?\//,
    /\.stories\.(ts|tsx|js|jsx)$/,
    /\.e2e\./,
    /cypress\//,
    /playwright\//,
  ];

  return testPatterns.some((p) => p.test(filePath));
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function getLineNumber(content: string, index: number): number {
  return content.substring(0, index).split('\n').length;
}
