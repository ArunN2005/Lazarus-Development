// ============================================================================
// LAZARUS — Error Classification Engine
// 19-category classifier with regex patterns, severity scoring
// ============================================================================

import { ErrorCategory, FixStrategy, type ClassifiedError } from './types';

// ---------------------------------------------------------------------------
// Pattern definitions for each error category
// ---------------------------------------------------------------------------

interface ErrorPattern {
  category: ErrorCategory;
  patterns: RegExp[];
  severity: number;
  fixStrategy: FixStrategy;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    category: ErrorCategory.MISSING_PACKAGE,
    patterns: [
      /Cannot find module '([^']+)'/i,
      /Module not found:?\s*(?:Error:?\s*)?(?:Can't resolve|Cannot resolve)\s+'([^']+)'/i,
      /Error: Cannot find module '([^']+)'/i,
      /ModuleNotFoundError: No module named '([^']+)'/i,
      /npm ERR! missing:?\s+([^\s]+)/i,
      /Package '([^']+)' is not installed/i,
      /Could not resolve '([^']+)'/i,
      /No such file or directory.*node_modules\/([^/]+)/i,
    ],
    severity: 9,
    fixStrategy: FixStrategy.DETERMINISTIC,
  },
  {
    category: ErrorCategory.VERSION_CONFLICT,
    patterns: [
      /ERESOLVE unable to resolve dependency tree/i,
      /peer dep missing/i,
      /peer dependency .* not installed/i,
      /npm ERR! ERESOLVE/i,
      /conflicting peer dependency/i,
      /Could not resolve dependency/i,
      /version .* doesn't satisfy/i,
      /incompatible peer dependency/i,
    ],
    severity: 8,
    fixStrategy: FixStrategy.DETERMINISTIC,
  },
  {
    category: ErrorCategory.NATIVE_MODULE,
    patterns: [
      /node-pre-gyp|node-gyp/i,
      /Error:.*sharp.*install/i,
      /Cannot find module.*\.node/i,
      /prebuild-install|node-addon-api/i,
      /gyp ERR!/i,
      /node_modules\/.*binding\.gyp/i,
      /Module did not self-register/i,
      /Error:.*bcrypt/i,
      /Error:.*node-sass/i,
      /Error:.*fsevents/i,
    ],
    severity: 8,
    fixStrategy: FixStrategy.DETERMINISTIC,
  },
  {
    category: ErrorCategory.TYPESCRIPT_ERROR,
    patterns: [
      /TS\d+:\s/,
      /error TS\d+/,
      /Type '.*' is not assignable to type/i,
      /Property '.*' does not exist on type/i,
      /Cannot find name '.*'/i,
      /Argument of type '.*' is not assignable/i,
      /Type error:/i,
      /Expected \d+ arguments?, but got \d+/i,
      /has no exported member/i,
    ],
    severity: 7,
    fixStrategy: FixStrategy.AI_SURGICAL,
  },
  {
    category: ErrorCategory.SYNTAX_ERROR,
    patterns: [
      /SyntaxError:/i,
      /Unexpected token/i,
      /Unexpected end of input/i,
      /Missing semicolon/i,
      /Unterminated string/i,
      /Invalid or unexpected token/i,
      /Identifier .* has already been declared/i,
      /Parsing error:/i,
    ],
    severity: 8,
    fixStrategy: FixStrategy.AI_SURGICAL,
  },
  {
    category: ErrorCategory.IMPORT_ERROR,
    patterns: [
      /does not provide an export named/i,
      /is not exported from/i,
      /Cannot use import statement outside a module/i,
      /require\(\) of ES Module/i,
      /ERR_REQUIRE_ESM/i,
      /ERR_MODULE_NOT_FOUND/i,
      /The requested module .* does not provide an export/i,
    ],
    severity: 7,
    fixStrategy: FixStrategy.AI_SURGICAL,
  },
  {
    category: ErrorCategory.EXPORT_ERROR,
    patterns: [
      /export .* was not found in/i,
      /does not contain a default export/i,
      /has no default export/i,
      /attempted import error/i,
    ],
    severity: 7,
    fixStrategy: FixStrategy.AI_SURGICAL,
  },
  {
    category: ErrorCategory.JSX_ERROR,
    patterns: [
      /JSX element .* has no corresponding closing tag/i,
      /Expected corresponding JSX closing tag/i,
      /React is not defined/i,
      /Invalid JSX/i,
      /Adjacent JSX elements must be wrapped/i,
      /JSX element implicitly has type 'any'/i,
    ],
    severity: 7,
    fixStrategy: FixStrategy.AI_SURGICAL,
  },
  {
    category: ErrorCategory.REACT_HOOK_ERROR,
    patterns: [
      /React Hook .* is called conditionally/i,
      /React Hook .* cannot be called at the top level/i,
      /Invalid hook call/i,
      /Hooks can only be called inside/i,
      /Rules of Hooks/i,
      /rendered more hooks than during the previous render/i,
    ],
    severity: 7,
    fixStrategy: FixStrategy.AI_SURGICAL,
  },
  {
    category: ErrorCategory.CSS_ERROR,
    patterns: [
      /Unknown CSS property/i,
      /Invalid CSS/i,
      /postcss/i,
      /tailwind.*error/i,
      /CssSyntaxError/i,
      /Cannot apply unknown utility class/i,
    ],
    severity: 5,
    fixStrategy: FixStrategy.AI_SURGICAL,
  },
  {
    category: ErrorCategory.ESLINT_ERROR,
    patterns: [
      /eslint.*error/i,
      /Parsing error:/i,
      /Rule '.*' definition not found/i,
      /ESLint couldn't determine/i,
    ],
    severity: 4,
    fixStrategy: FixStrategy.AI_SURGICAL,
  },
  {
    category: ErrorCategory.WEBPACK_ERROR,
    patterns: [
      /webpack.*error/i,
      /Module build failed/i,
      /Module parse failed/i,
      /You may need an appropriate loader/i,
      /webpack\.config/i,
    ],
    severity: 6,
    fixStrategy: FixStrategy.AI_SURGICAL,
  },
  {
    category: ErrorCategory.VITE_ERROR,
    patterns: [
      /\[vite\].*error/i,
      /vite.*failed/i,
      /Pre-transform error/i,
      /Rollup failed to resolve/i,
    ],
    severity: 6,
    fixStrategy: FixStrategy.AI_SURGICAL,
  },
  {
    category: ErrorCategory.NEXT_CONFIG_ERROR,
    patterns: [
      /Invalid next\.config/i,
      /next\.config\.js.*error/i,
      /Unrecognized key.*in next\.config/i,
      /experimental\.appDir.*removed/i,
    ],
    severity: 7,
    fixStrategy: FixStrategy.DETERMINISTIC,
  },
  {
    category: ErrorCategory.PORT_CONFLICT,
    patterns: [
      /EADDRINUSE/i,
      /address already in use/i,
      /port .* is already in use/i,
      /listen EADDRINUSE/i,
    ],
    severity: 6,
    fixStrategy: FixStrategy.DETERMINISTIC,
  },
  {
    category: ErrorCategory.PORT_NOT_EXPOSED,
    patterns: [
      /ECONNREFUSED/i,
      /Connection refused/i,
      /connect ECONNREFUSED/i,
      /Could not connect to.*localhost/i,
    ],
    severity: 6,
    fixStrategy: FixStrategy.DETERMINISTIC,
  },
  {
    category: ErrorCategory.ENV_MISSING,
    patterns: [
      /missing.*environment variable/i,
      /env.*not set/i,
      /required.*env.*missing/i,
      /undefined.*process\.env/i,
      /Configuration error:.*missing/i,
      /Error:.*API_KEY.*required/i,
      /Error:.*SECRET.*not defined/i,
    ],
    severity: 8,
    fixStrategy: FixStrategy.USER_INPUT,
  },
  {
    category: ErrorCategory.DB_CONNECTION,
    patterns: [
      /ECONNREFUSED.*(?:5432|3306|27017)/i,
      /MongoServerError/i,
      /SequelizeConnectionRefusedError/i,
      /PrismaClientInitializationError/i,
      /connection.*refused.*database/i,
      /could not connect to server/i,
      /FATAL:.*database.*does not exist/i,
      /Access denied for user/i,
      /Error: connect ECONNREFUSED.*:(?:5432|3306|27017)/i,
    ],
    severity: 9,
    fixStrategy: FixStrategy.DETERMINISTIC,
  },
  {
    category: ErrorCategory.ASYNC_ERROR,
    patterns: [
      /UnhandledPromiseRejection/i,
      /Unhandled promise rejection/i,
      /async.*error/i,
      /await.*is not a function/i,
      /Cannot read properties of undefined/i,
    ],
    severity: 6,
    fixStrategy: FixStrategy.AI_SURGICAL,
  },
  {
    category: ErrorCategory.BUILD_COMMAND_MISSING,
    patterns: [
      /Missing script: "build"/i,
      /npm ERR! Missing script/i,
      /No build script found/i,
      /error Command "build" not found/i,
    ],
    severity: 8,
    fixStrategy: FixStrategy.DETERMINISTIC,
  },
  {
    category: ErrorCategory.PERMISSION_ERROR,
    patterns: [
      /EACCES/i,
      /Permission denied/i,
      /EPERM.*operation not permitted/i,
    ],
    severity: 6,
    fixStrategy: FixStrategy.DETERMINISTIC,
  },
  {
    category: ErrorCategory.MEMORY_ERROR,
    patterns: [
      /JavaScript heap out of memory/i,
      /FATAL ERROR:.*heap/i,
      /allocation failed/i,
      /ENOMEM/i,
    ],
    severity: 7,
    fixStrategy: FixStrategy.DETERMINISTIC,
  },
];

// ---------------------------------------------------------------------------
// Noise filter patterns (lines that look like errors but aren't)
// ---------------------------------------------------------------------------

const NOISE_PATTERNS = [
  /^npm warn/i,
  /^npm notice/i,
  /^deprecated/i,
  /added \d+ packages/i,
  /up to date/i,
  /^  at /i, // Stack trace lines
  /^\s*$/,
  /^>\s/,
  /Already up to date/i,
];

// ---------------------------------------------------------------------------
// Severity map
// ---------------------------------------------------------------------------

const SEVERITY_MAP: Record<ErrorCategory, number> = {
  [ErrorCategory.MISSING_PACKAGE]: 9,
  [ErrorCategory.VERSION_CONFLICT]: 8,
  [ErrorCategory.NATIVE_MODULE]: 8,
  [ErrorCategory.TYPESCRIPT_ERROR]: 7,
  [ErrorCategory.SYNTAX_ERROR]: 8,
  [ErrorCategory.IMPORT_ERROR]: 7,
  [ErrorCategory.EXPORT_ERROR]: 7,
  [ErrorCategory.JSX_ERROR]: 7,
  [ErrorCategory.REACT_HOOK_ERROR]: 7,
  [ErrorCategory.CSS_ERROR]: 5,
  [ErrorCategory.ESLINT_ERROR]: 4,
  [ErrorCategory.WEBPACK_ERROR]: 6,
  [ErrorCategory.VITE_ERROR]: 6,
  [ErrorCategory.NEXT_CONFIG_ERROR]: 7,
  [ErrorCategory.PORT_CONFLICT]: 6,
  [ErrorCategory.PORT_NOT_EXPOSED]: 6,
  [ErrorCategory.ENV_MISSING]: 8,
  [ErrorCategory.DB_CONNECTION]: 9,
  [ErrorCategory.ASYNC_ERROR]: 6,
  [ErrorCategory.BUILD_COMMAND_MISSING]: 8,
  [ErrorCategory.PERMISSION_ERROR]: 6,
  [ErrorCategory.MEMORY_ERROR]: 7,
  [ErrorCategory.UNKNOWN]: 5,
};

// ---------------------------------------------------------------------------
// Classification functions
// ---------------------------------------------------------------------------

/**
 * Classify a single log line
 */
export function classifyLogLine(
  line: string
): { category: ErrorCategory; confidence: number } {
  let bestMatch: { category: ErrorCategory; confidence: number } = {
    category: ErrorCategory.UNKNOWN,
    confidence: 0,
  };

  for (const pattern of ERROR_PATTERNS) {
    for (const regex of pattern.patterns) {
      if (regex.test(line)) {
        const confidence = 0.8 + pattern.severity * 0.02;
        if (confidence > bestMatch.confidence) {
          bestMatch = { category: pattern.category, confidence };
        }
      }
    }
  }

  return bestMatch;
}

/**
 * Classify a batch of log lines, deduplicate and sort
 */
export function classifyLogBatch(lines: string[]): ClassifiedError[] {
  const errors: ClassifiedError[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    // Skip noise
    if (isNoise(line)) continue;

    // Only classify lines with error indicators
    if (!hasErrorIndicator(line)) continue;

    const { category, confidence } = classifyLogLine(line);
    if (category === ErrorCategory.UNKNOWN && confidence < 0.3) continue;

    const affectedFile = extractAffectedFile(line);
    const dedupeKey = `${category}:${affectedFile ?? 'unknown'}`;

    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const patternDef = ERROR_PATTERNS.find((p) => p.category === category);

    errors.push({
      category,
      confidence,
      rawMessage: line.trim(),
      affectedFile,
      lineNumber: extractLineNumber(line),
      severity: getSeverityScore(category),
      fixStrategy: patternDef?.fixStrategy ?? FixStrategy.AI_SURGICAL,
    });
  }

  // Sort by severity descending
  errors.sort((a, b) => b.severity - a.severity);

  return errors;
}

/**
 * Extract affected file path from error message
 */
export function extractAffectedFile(
  line: string,
  projectFiles?: string[]
): string | null {
  // Common patterns for file paths in error messages
  const filePatterns = [
    /(?:in|at|from)\s+(?:\.\/)?([a-zA-Z0-9_\-./]+\.[a-zA-Z]{1,4})/,
    /([a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx|py|java|rb|go|css|scss|html))(?::\d+)?/,
    /Module not found.*'\.\/([^']+)'/,
    /Cannot find module '\.\/([^']+)'/,
    /Error in (.+?)(?::\d+|$)/,
  ];

  for (const pattern of filePatterns) {
    const match = line.match(pattern);
    if (match?.[1]) {
      const candidate = match[1];

      // If projectFiles provided, verify the file exists
      if (projectFiles) {
        const matchingFile = projectFiles.find(
          (f) => f.endsWith(candidate) || f === candidate
        );
        if (matchingFile) return matchingFile;
      }

      // Return candidate even without verification
      if (
        candidate.includes('.') &&
        !candidate.includes(' ') &&
        candidate.length < 200
      ) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Extract line number from error message
 */
export function extractLineNumber(line: string): number | null {
  const patterns = [
    /(?:line|Line)\s+(\d+)/,
    /:(\d+):\d+/,
    /:(\d+)\)/,
    /\((\d+),\s*\d+\)/,
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match?.[1]) {
      const lineNum = parseInt(match[1], 10);
      if (lineNum > 0 && lineNum < 100000) return lineNum;
    }
  }

  return null;
}

/**
 * Get severity score for an error category
 */
export function getSeverityScore(category: ErrorCategory): number {
  return SEVERITY_MAP[category] ?? 5;
}

/**
 * Check if a category requires user input to fix
 */
export function requiresUserInput(category: ErrorCategory): boolean {
  return category === ErrorCategory.ENV_MISSING;
}

/**
 * Check if a category requires DB provisioning
 */
export function requiresDBProvisioning(category: ErrorCategory): boolean {
  return category === ErrorCategory.DB_CONNECTION;
}

/**
 * Get the fix strategy for a category
 */
export function getFixStrategy(category: ErrorCategory): FixStrategy {
  const pattern = ERROR_PATTERNS.find((p) => p.category === category);
  return pattern?.fixStrategy ?? FixStrategy.AI_SURGICAL;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function isNoise(line: string): boolean {
  return NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

function hasErrorIndicator(line: string): boolean {
  const indicators = [
    /error/i,
    /Error/,
    /ERR!/,
    /failed/i,
    /FATAL/i,
    /Cannot/i,
    /could not/i,
    /not found/i,
    /Missing/i,
    /Invalid/i,
    /Unexpected/i,
    /refused/i,
    /denied/i,
    /EACCES/i,
    /ENOENT/i,
    /EADDRINUSE/i,
    /ECONNREFUSED/i,
    /EPERM/i,
    /ENOMEM/i,
    /TypeError/i,
    /ReferenceError/i,
    /SyntaxError/i,
    /TS\d+/,
  ];

  return indicators.some((pattern) => pattern.test(line));
}
