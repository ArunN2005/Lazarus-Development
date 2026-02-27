// ============================================================================
// LAZARUS — Builder File Generator
// Generates individual files using Claude Opus with full context
// ============================================================================

import { bedrock, MODELS } from '../../shared/bedrock';
import { costTracker } from '../../shared/costTracker';
import { log } from '../../shared/logger';
import type {
  MigrationPlan,
  MigrationPlanFile,
  GenerationContext,
  TechStack,
} from '../../shared/types';

// ---------------------------------------------------------------------------
// Main generation function
// ---------------------------------------------------------------------------

export async function generateFile(
  file: MigrationPlanFile,
  context: GenerationContext
): Promise<string> {
  const { projectId, plan, originalFiles, generatedFiles, techStack } = context;

  // Build the generation prompt
  const systemPrompt = buildSystemPrompt(techStack);
  const userPrompt = buildUserPrompt(file, originalFiles ?? new Map(), generatedFiles ?? new Map(), plan!);

  // Use prompt caching for system prompt (shared across all files in project)
  const payload = bedrock.buildOpusPayload(systemPrompt, userPrompt, 8000);

  let response: string;
  try {
    const raw = await bedrock.invoke(payload, MODELS.OPUS);
    response = typeof raw === 'string' ? raw : raw.content;
  } catch (error) {
    log('error', 'Bedrock invocation failed', {
      projectId,
      file: file.targetPath,
      error: String(error),
    });

    // Retry once with smaller context
    const reducedPrompt = buildUserPrompt(
      file,
      originalFiles ?? new Map(),
      generatedFiles ?? new Map(),
      plan!,
      true // reduced context
    );
    const reducedPayload = bedrock.buildOpusPayload(systemPrompt, reducedPrompt, 8000);
    const raw = await bedrock.invoke(reducedPayload, MODELS.OPUS);
    response = typeof raw === 'string' ? raw : raw.content;
  }

  // Extract code from response
  const code = extractCode(response, file.targetPath ?? 'unknown-file');

  // Track cost
  const inputTokens = (systemPrompt.length + userPrompt.length) / 4;
  const outputTokens = response.length / 4;
  await costTracker.recordWithCache(
    projectId,
    'bedrock_opus',
    Math.round(inputTokens),
    Math.round(outputTokens),
    0,
    0,
    'builder_generate'
  );

  return code;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(techStack: TechStack): string {
  return `You are Lazarus Builder, an expert code migration engine. You generate complete, production-ready source files.

TARGET STACK:
- Language: ${techStack.language}
- Framework: ${techStack.framework}
- Build Tool: ${techStack.buildTool}
- Runtime: ${techStack.runtime}
- Styling: ${techStack.styling}
- State Management: ${techStack.stateManagement}
- TypeScript: ${techStack.hasTypeScript}

RULES:
1. Output ONLY the complete file content — no explanations, no markdown
2. Every import must be valid and resolvable
3. Maintain exact functional parity with the original code
4. Use modern best practices for the target stack
5. Keep all comments that explain business logic
6. Use proper TypeScript types (no 'any' unless truly necessary)
7. Handle errors gracefully
8. Preserve all edge cases and error handling from original
9. Use the exact file path specified — don't suggest alternatives
10. If creating a new file (no original), generate idiomatic boilerplate

IMPORTANT:
- Do NOT wrap output in markdown code blocks
- Do NOT include file path comments at the top
- Output ONLY the raw file content
- Ensure the code compiles without errors`;
}

// ---------------------------------------------------------------------------
// User prompt
// ---------------------------------------------------------------------------

function buildUserPrompt(
  file: MigrationPlanFile,
  originalFiles: Map<string, string>,
  generatedFiles: Map<string, string>,
  plan: MigrationPlan,
  reduced = false
): string {
  const parts: string[] = [];

  parts.push(`Generate file: ${file.targetPath}`);
  parts.push(`Action: ${file.action}`);
  parts.push(`Description: ${file.description}`);

  if (file.migrationNotes) {
    parts.push(`\nMIGRATION NOTES:\n${file.migrationNotes}`);
  }

  // Original file content
  if (file.sourcePath && file.action === ('COPY' as string)) {
    const original = originalFiles.get(file.sourcePath);
    if (original) {
      const truncated = reduced ? original.substring(0, 4000) : original;
      parts.push(`\nORIGINAL FILE (${file.sourcePath}):\n${truncated}`);
    }
  }

  // Dependencies — show already-generated files this file imports
  if (file.dependencies && file.dependencies.length > 0 && !reduced) {
    const depContents: string[] = [];

    for (const dep of file.dependencies.slice(0, 5)) {
      const content = generatedFiles.get(dep);
      if (content) {
        // Only show exports & type signatures, not full content
        const summary = extractPublicAPI(content);
        depContents.push(`--- ${dep} ---\n${summary}`);
      }
    }

    if (depContents.length > 0) {
      parts.push(`\nDEPENDENCY FILES (already generated — use these for imports):\n${depContents.join('\n\n')}`);
    }
  }

  // Sibling files in same directory (for import consistency)
  if (!reduced && file.targetPath) {
    const dir = file.targetPath.substring(0, file.targetPath.lastIndexOf('/'));
    const siblings = plan.files
      .filter(
        (f) =>
          f.targetPath &&
          f.targetPath !== file.targetPath &&
          f.targetPath.startsWith(dir + '/') &&
          !f.targetPath.substring(dir.length + 1).includes('/')
      )
      .map((f) => f.targetPath!)
      .slice(0, 10);

    if (siblings.length > 0) {
      parts.push(`\nSIBLING FILES IN SAME DIRECTORY:\n${siblings.join('\n')}`);
    }
  }

  // Complexity hint
  parts.push(`\nCOMPLEXITY: ${file.complexity}`);
  parts.push(`IS CONFIG: ${file.isConfig}`);
  parts.push(`IS ENTRY POINT: ${file.isEntryPoint}`);

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Code extraction
// ---------------------------------------------------------------------------

function extractCode(response: string, filePath: string): string {
  let code = response.trim();

  // Remove markdown code blocks if present
  const codeBlockRegex = /^```(?:\w+)?\s*\n([\s\S]*?)```\s*$/;
  const match = code.match(codeBlockRegex);
  if (match) {
    code = match[1].trim();
  }

  // Remove leading ``` without closing
  if (code.startsWith('```')) {
    const firstNewline = code.indexOf('\n');
    code = code.substring(firstNewline + 1).trim();
    if (code.endsWith('```')) {
      code = code.substring(0, code.length - 3).trim();
    }
  }

  // Remove any "Here's the file:" prefix
  const prefixPatterns = [
    /^Here(?:'s| is) (?:the )?(?:complete )?(?:file|code|content).*?\n/i,
    /^The (?:complete )?(?:file|code|content).*?\n/i,
    /^Below is.*?\n/i,
  ];

  for (const pattern of prefixPatterns) {
    code = code.replace(pattern, '');
  }

  // Validate basic structure
  if (filePath.endsWith('.json') && !code.startsWith('{') && !code.startsWith('[')) {
    // Try to extract JSON from the response
    const jsonMatch = code.match(/[\[{][\s\S]*[\]}]/);
    if (jsonMatch) {
      code = jsonMatch[0];
    }
  }

  return code;
}

// ---------------------------------------------------------------------------
// Extract public API from generated file
// ---------------------------------------------------------------------------

function extractPublicAPI(content: string): string {
  const lines = content.split('\n');
  const apiLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Keep export statements
    if (
      trimmed.startsWith('export ') ||
      trimmed.startsWith('export default') ||
      trimmed.startsWith('module.exports')
    ) {
      apiLines.push(line);

      // If it's a function/class declaration, include the signature
      if (
        trimmed.includes('function ') ||
        trimmed.includes('class ') ||
        trimmed.includes('interface ') ||
        trimmed.includes('type ') ||
        trimmed.includes('enum ')
      ) {
        // Get the full signature (until { or ;)
        continue;
      }
    }

    // Keep import statements
    if (trimmed.startsWith('import ')) {
      apiLines.push(line);
    }

    // Keep interface/type definitions
    if (
      trimmed.startsWith('interface ') ||
      trimmed.startsWith('type ') ||
      trimmed.startsWith('enum ')
    ) {
      apiLines.push(line);
    }
  }

  return apiLines.length > 0
    ? apiLines.join('\n')
    : content.substring(0, 500) + '\n// ... truncated';
}
