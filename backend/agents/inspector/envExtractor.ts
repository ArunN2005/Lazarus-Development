// ============================================================================
// LAZARUS — Inspector Env Var Extractor
// Extracts environment variables from source files and classifies them via Haiku
// ============================================================================

import { bedrock, MODELS } from '../../shared/bedrock';
import { log } from '../../shared/logger';
import type { FileAnalysis, TechStack, ClassifiedEnvVar } from '../../shared/types';

// ---------------------------------------------------------------------------
// Raw extraction from file analyses
// ---------------------------------------------------------------------------

export function extractEnvVars(files: FileAnalysis[]): RawEnvVar[] {
  const envMap = new Map<string, RawEnvVar>();

  for (const file of files) {
    for (const varName of (file.envVarRefs ?? file.envVars ?? [])) {
      if (envMap.has(varName)) {
        envMap.get(varName)!.usedInFiles.push(file.filePath);
      } else {
        envMap.set(varName, {
          name: varName,
          usedInFiles: [file.filePath],
          hasDefault: false,
          defaultValue: undefined,
        });
      }
    }
  }

  // Also check for .env / .env.example files
  const envFiles = files.filter(
    (f) =>
      f.filePath.endsWith('.env') ||
      f.filePath.endsWith('.env.example') ||
      f.filePath.endsWith('.env.local') ||
      f.filePath.endsWith('.env.development') ||
      f.filePath.endsWith('.env.production')
  );

  // Note: We only have the file analysis, not the raw content here.
  // The env var refs from the AST parser already extracted the names.
  // For .env files, we rely on the parser having caught them.

  return Array.from(envMap.values());
}

interface RawEnvVar {
  name: string;
  usedInFiles: string[];
  hasDefault: boolean;
  defaultValue?: string;
}

// ---------------------------------------------------------------------------
// Classification via Haiku
// ---------------------------------------------------------------------------

export async function classifyEnvVars(
  rawVars: RawEnvVar[],
  techStack: TechStack
): Promise<ClassifiedEnvVar[]> {
  if (rawVars.length === 0) return [];

  // Some vars can be classified deterministically
  const classified: ClassifiedEnvVar[] = [];
  const needsAI: RawEnvVar[] = [];

  for (const v of rawVars) {
    const deterministic = deterministicClassify(v);
    if (deterministic) {
      classified.push(deterministic);
    } else {
      needsAI.push(v);
    }
  }

  // Use Haiku for remaining vars
  if (needsAI.length > 0) {
    const aiClassified = await aiClassifyBatch(needsAI, techStack);
    classified.push(...aiClassified);
  }

  return classified;
}

// ---------------------------------------------------------------------------
// Deterministic classification
// ---------------------------------------------------------------------------

function deterministicClassify(v: RawEnvVar): ClassifiedEnvVar | null {
  const name = v.name.toUpperCase();

  // Well-known patterns
  const patterns: Array<{
    pattern: RegExp;
    classification: string;
    required: boolean;
    description: string;
  }> = [
    // Public/client-side vars — safe
    { pattern: /^NEXT_PUBLIC_/, classification: 'PUBLIC', required: false, description: 'Next.js client-side environment variable' },
    { pattern: /^VITE_/, classification: 'PUBLIC', required: false, description: 'Vite client-side environment variable' },
    { pattern: /^REACT_APP_/, classification: 'PUBLIC', required: false, description: 'Create React App client-side environment variable' },

    // Node environment
    { pattern: /^NODE_ENV$/, classification: 'BUILD', required: false, description: 'Node.js environment mode' },
    { pattern: /^NODE_OPTIONS$/, classification: 'BUILD', required: false, description: 'Node.js runtime options' },

    // Port
    { pattern: /^PORT$/, classification: 'BUILD', required: false, description: 'Server port number' },
    { pattern: /^HOST$/, classification: 'BUILD', required: false, description: 'Server host address' },

    // Database URLs (secrets)
    { pattern: /DATABASE_URL/, classification: 'SECRET', required: true, description: 'Database connection string' },
    { pattern: /DB_HOST/, classification: 'SECRET', required: true, description: 'Database host' },
    { pattern: /DB_PASSWORD/, classification: 'SECRET', required: true, description: 'Database password' },
    { pattern: /DB_USER/, classification: 'SECRET', required: true, description: 'Database username' },
    { pattern: /MONGO.*URI/, classification: 'SECRET', required: true, description: 'MongoDB connection URI' },
    { pattern: /REDIS_URL/, classification: 'SECRET', required: true, description: 'Redis connection URL' },

    // API keys and secrets
    { pattern: /API[_-]?KEY/, classification: 'SECRET', required: true, description: 'API key' },
    { pattern: /API[_-]?SECRET/, classification: 'SECRET', required: true, description: 'API secret' },
    { pattern: /SECRET[_-]?KEY/, classification: 'SECRET', required: true, description: 'Secret key' },
    { pattern: /PRIVATE[_-]?KEY/, classification: 'SECRET', required: true, description: 'Private key' },
    { pattern: /ACCESS[_-]?KEY/, classification: 'SECRET', required: true, description: 'Access key' },
    { pattern: /AUTH[_-]?TOKEN/, classification: 'SECRET', required: true, description: 'Authentication token' },
    { pattern: /JWT[_-]?SECRET/, classification: 'SECRET', required: true, description: 'JWT signing secret' },
    { pattern: /SESSION[_-]?SECRET/, classification: 'SECRET', required: true, description: 'Session secret' },
    { pattern: /ENCRYPTION[_-]?KEY/, classification: 'SECRET', required: true, description: 'Encryption key' },
    { pattern: /^PASSWORD$/, classification: 'SECRET', required: true, description: 'Password' },
    { pattern: /WEBHOOK[_-]?SECRET/, classification: 'SECRET', required: true, description: 'Webhook secret' },

    // OAuth
    { pattern: /OAUTH/, classification: 'SECRET', required: true, description: 'OAuth credential' },
    { pattern: /CLIENT[_-]?ID$/, classification: 'SECRET', required: true, description: 'OAuth client ID' },
    { pattern: /CLIENT[_-]?SECRET/, classification: 'SECRET', required: true, description: 'OAuth client secret' },

    // Cloud providers
    { pattern: /AWS_ACCESS_KEY/, classification: 'SECRET', required: true, description: 'AWS access key' },
    { pattern: /AWS_SECRET/, classification: 'SECRET', required: true, description: 'AWS secret key' },
    { pattern: /AWS_REGION/, classification: 'BUILD', required: false, description: 'AWS region' },

    // Third-party services
    { pattern: /STRIPE/, classification: 'SECRET', required: true, description: 'Stripe API credential' },
    { pattern: /SENDGRID/, classification: 'SECRET', required: true, description: 'SendGrid credential' },
    { pattern: /TWILIO/, classification: 'SECRET', required: true, description: 'Twilio credential' },
    { pattern: /OPENAI/, classification: 'SECRET', required: true, description: 'OpenAI API key' },
    { pattern: /FIREBASE/, classification: 'SECRET', required: true, description: 'Firebase credential' },
    { pattern: /SUPABASE/, classification: 'SECRET', required: true, description: 'Supabase credential' },
    { pattern: /CLERK/, classification: 'SECRET', required: true, description: 'Clerk credential' },
    { pattern: /AUTH0/, classification: 'SECRET', required: true, description: 'Auth0 credential' },
    { pattern: /SENTRY/, classification: 'BUILD', required: false, description: 'Sentry DSN' },
    { pattern: /DATADOG/, classification: 'BUILD', required: false, description: 'Datadog configuration' },

    // URLs (usually non-secret)
    { pattern: /^(BASE_)?URL$/, classification: 'BUILD', required: false, description: 'Application URL' },
    { pattern: /API[_-]?URL/, classification: 'BUILD', required: false, description: 'API endpoint URL' },
    { pattern: /NEXTAUTH_URL/, classification: 'BUILD', required: false, description: 'NextAuth.js callback URL' },
    { pattern: /NEXTAUTH_SECRET/, classification: 'SECRET', required: true, description: 'NextAuth.js JWT secret' },

    // Email
    { pattern: /SMTP/, classification: 'SECRET', required: true, description: 'SMTP configuration' },
    { pattern: /MAIL_/, classification: 'SECRET', required: true, description: 'Email configuration' },

    // Build-time
    { pattern: /CI$/, classification: 'BUILD', required: false, description: 'CI environment flag' },
    { pattern: /DEBUG/, classification: 'BUILD', required: false, description: 'Debug mode flag' },
    { pattern: /LOG[_-]?LEVEL/, classification: 'BUILD', required: false, description: 'Logging level' },
    { pattern: /ANALYTICS/, classification: 'PUBLIC', required: false, description: 'Analytics ID' },
  ];

  for (const { pattern, classification, required, description } of patterns) {
    if (pattern.test(name)) {
      return {
        name: v.name,
        classification,
        required,
        description,
        exampleValue: '',
        usedInFiles: v.usedInFiles,
        hasDefault: v.hasDefault,
        defaultValue: v.defaultValue,
        suggestedValue: undefined,
      } as ClassifiedEnvVar;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// AI classification via Haiku
// ---------------------------------------------------------------------------

async function aiClassifyBatch(
  vars: RawEnvVar[],
  techStack: TechStack
): Promise<ClassifiedEnvVar[]> {
  // Process in batches of 20
  const batchSize = 20;
  const results: ClassifiedEnvVar[] = [];

  for (let i = 0; i < vars.length; i += batchSize) {
    const batch = vars.slice(i, i + batchSize);
    const batchResults = await aiClassifySingle(batch, techStack);
    results.push(...batchResults);
  }

  return results;
}

async function aiClassifySingle(
  vars: RawEnvVar[],
  techStack: TechStack
): Promise<ClassifiedEnvVar[]> {
  const varList = vars.map((v) => ({
    name: v.name,
    usedIn: v.usedInFiles.slice(0, 3),
    hasDefault: v.hasDefault,
  }));

  const prompt = `Classify these environment variables for a ${techStack.framework} (${techStack.language}) application.

VARIABLES:
${JSON.stringify(varList, null, 2)}

For each variable, classify as one of:
- SECRET: Sensitive credential that must be provided by user (API keys, passwords, tokens)
- BUILD: Build-time configuration (ports, URLs, feature flags)
- PUBLIC: Client-safe public values (analytics IDs, public API URLs)

Respond with a JSON array:
[
  {
    "name": "VAR_NAME",
    "classification": "SECRET|BUILD|PUBLIC",
    "required": boolean,
    "description": "brief description of what this var is for"
  }
]

Only output the JSON array, nothing else.`;

  try {
    const payload = bedrock.buildHaikuPayload(prompt, 2000);
    const response = await bedrock.invoke(payload, MODELS.HAIKU);

    const parsed = JSON.parse(
      typeof response === 'string' ? response : JSON.stringify(response)
    ) as Array<{
      name: string;
      classification: 'SECRET' | 'BUILD' | 'PUBLIC';
      required: boolean;
      description: string;
    }>;

    return parsed.map((p) => {
      const original = vars.find((v) => v.name === p.name);
      return {
        name: p.name,
        classification: p.classification,
        required: p.required,
        description: p.description,
        exampleValue: '',
        usedInFiles: original?.usedInFiles ?? [],
        hasDefault: original?.hasDefault ?? false,
        defaultValue: original?.defaultValue,
        suggestedValue: undefined,
      } as ClassifiedEnvVar;
    });
  } catch (error) {
    log('warn', 'AI env var classification failed', { error: String(error) });

    // Fallback: mark unknown vars as BUILD (safest default)
    return vars.map((v) => ({
      name: v.name,
      classification: 'BUILD' as const,
      required: false,
      description: 'Unclassified environment variable',
      exampleValue: '',
      usedInFiles: v.usedInFiles,
      hasDefault: v.hasDefault,
      defaultValue: v.defaultValue,
      suggestedValue: undefined,
    } as ClassifiedEnvVar));
  }
}
