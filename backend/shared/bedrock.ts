// ============================================================================
// LAZARUS — Bedrock Helper
// Claude Sonnet/Haiku invocation with streaming, caching, cost tracking
// ============================================================================

import {
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient } from './aws-clients';
import { log } from './logger';

// ---------------------------------------------------------------------------
// Model IDs & Pricing
// ---------------------------------------------------------------------------

// Cross-region inference profile IDs (verified via aws bedrock list-inference-profiles in ap-south-1)
export const MODELS = {
  // Architect / planning — Claude Sonnet 4.6 (global cross-region)
  SONNET: 'global.anthropic.claude-sonnet-4-6',
  // Builder / code generation — Claude Sonnet 4.6 (Opus 4.6 requires Marketplace; Sonnet 4.6 confirmed accessible)
  OPUS: 'global.anthropic.claude-sonnet-4-6',
  // Inspector / lightweight tasks — Claude Haiku 4.5 (global cross-region)
  HAIKU: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
} as const;

const PRICING: Record<string, { inputPer1K: number; outputPer1K: number }> = {
  [MODELS.SONNET]: { inputPer1K: 0.003,   outputPer1K: 0.015   },
  [MODELS.HAIKU]:  { inputPer1K: 0.00025, outputPer1K: 0.00125 },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BedrockMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

interface ContentBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

interface BedrockPayload {
  anthropic_version: string;
  max_tokens: number;
  system?: string | ContentBlock[];
  messages: BedrockMessage[];
}

interface StreamingChunk {
  chunk: string;
  inputTokens: number;
  outputTokens: number;
}

interface InvokeResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

// ---------------------------------------------------------------------------
// Backoff configuration
// ---------------------------------------------------------------------------

const BACKOFF_DELAYS = [1000, 2000, 4000, 8000, 16000, 32000];
const MAX_RETRIES = 6;

export class BedrockHelper {
  /**
   * Invoke model with response streaming
   * Yields chunks as they arrive
   */
  async *invokeStreaming(params: {
    modelId: string;
    payload: BedrockPayload;
  }): AsyncGenerator<StreamingChunk> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await bedrockClient.send(
          new InvokeModelWithResponseStreamCommand({
            modelId: params.modelId,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify(params.payload),
          })
        );

        if (!response.body) {
          throw new Error('No response body from Bedrock');
        }

        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        for await (const event of response.body) {
          if (event.chunk?.bytes) {
            const raw = new TextDecoder().decode(event.chunk.bytes);
            const parsed = JSON.parse(raw);

            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              yield {
                chunk: parsed.delta.text,
                inputTokens: 0,
                outputTokens: 0,
              };
            }

            if (parsed.type === 'message_delta' && parsed.usage) {
              totalOutputTokens = parsed.usage.output_tokens ?? totalOutputTokens;
            }

            if (parsed.type === 'message_start' && parsed.message?.usage) {
              totalInputTokens = parsed.message.usage.input_tokens ?? 0;
            }

            if (parsed.type === 'message_stop') {
              yield {
                chunk: '',
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
              };
            }
          }
        }

        return; // Success
      } catch (error: unknown) {
        lastError = error as Error;
        const err = error as { name?: string };

        if (
          err.name === 'ThrottlingException' ||
          err.name === 'ServiceUnavailableException' ||
          err.name === 'ModelTimeoutException'
        ) {
          if (attempt < MAX_RETRIES) {
            const delay = BACKOFF_DELAYS[attempt] ?? 32000;
            log('warn', `Bedrock throttled, retrying in ${delay}ms`, {
              attempt,
              modelId: params.modelId,
            });
            await this.sleep(delay);
            continue;
          }
        }

        throw error;
      }
    }

    throw lastError ?? new Error('Bedrock streaming failed after all retries');
  }

  /**
   * Invoke model (non-streaming)
   * Supports both object form { modelId, payload } and positional form (payload, modelId)
   */
  async invoke(params: { modelId: string; payload: BedrockPayload }): Promise<InvokeResult>;
  async invoke(payload: BedrockPayload, modelId: string): Promise<InvokeResult>;
  async invoke(
    first: { modelId: string; payload: BedrockPayload } | BedrockPayload,
    second?: string
  ): Promise<InvokeResult> {
    let modelId: string;
    let payload: BedrockPayload;
    if (second) {
      payload = first as BedrockPayload;
      modelId = second;
    } else {
      const p = first as { modelId: string; payload: BedrockPayload };
      modelId = p.modelId;
      payload = p.payload;
    }
    const params = { modelId, payload };
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await bedrockClient.send(
          new InvokeModelCommand({
            modelId: params.modelId,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify(params.payload),
          })
        );

        const body = JSON.parse(new TextDecoder().decode(response.body));

        const content =
          body.content?.[0]?.text ??
          (typeof body.content === 'string' ? body.content : '');

        return {
          content,
          inputTokens: body.usage?.input_tokens ?? 0,
          outputTokens: body.usage?.output_tokens ?? 0,
          cacheReadTokens: body.usage?.cache_read_input_tokens ?? 0,
          cacheWriteTokens: body.usage?.cache_creation_input_tokens ?? 0,
        };
      } catch (error: unknown) {
        lastError = error as Error;
        const err = error as { name?: string };

        if (
          err.name === 'ThrottlingException' ||
          err.name === 'ServiceUnavailableException' ||
          err.name === 'ModelTimeoutException'
        ) {
          if (attempt < MAX_RETRIES) {
            const delay = BACKOFF_DELAYS[attempt] ?? 32000;
            log('warn', `Bedrock throttled, retrying in ${delay}ms`, {
              attempt,
              modelId: params.modelId,
            });
            await this.sleep(delay);
            continue;
          }
        }

        throw error;
      }
    }

    throw lastError ?? new Error('Bedrock invoke failed after all retries');
  }

  /**
   * Invoke with prompt caching enabled
   */
  async invokeWithCache(
    systemPrompt: string,
    userPrompt: string,
    modelId: string,
    maxTokens = 8192
  ): Promise<InvokeResult> {
    const payload: BedrockPayload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: maxTokens,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    };

    return this.invoke({ modelId, payload });
  }

  /**
   * Build Claude Sonnet payload
   * Supports both (system, messages[], maxTokens, useCache) and (system, userPrompt, maxTokens)
   */
  buildSonnetPayload(
    system: string,
    messages: BedrockMessage[],
    maxTokens?: number,
    useCache?: boolean
  ): BedrockPayload;
  buildSonnetPayload(
    system: string,
    userPrompt: string,
    maxTokens?: number
  ): BedrockPayload;
  buildSonnetPayload(
    system: string,
    second: BedrockMessage[] | string,
    maxTokens = 8192,
    useCache = true
  ): BedrockPayload {
    const messages: BedrockMessage[] =
      typeof second === 'string'
        ? [{ role: 'user', content: second }]
        : second;
    return {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: maxTokens,
      system: useCache
        ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
        : system,
      messages,
    };
  }

  /**
   * Build Claude Opus payload — same format as Sonnet, separate method for clarity
   */
  buildOpusPayload(
    system: string,
    messages: BedrockMessage[],
    maxTokens?: number,
    useCache?: boolean
  ): BedrockPayload;
  buildOpusPayload(
    system: string,
    userPrompt: string,
    maxTokens?: number
  ): BedrockPayload;
  buildOpusPayload(
    system: string,
    second: BedrockMessage[] | string,
    maxTokens = 8192,
    useCache = true
  ): BedrockPayload {
    const messages: BedrockMessage[] =
      typeof second === 'string'
        ? [{ role: 'user', content: second }]
        : second;
    return {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: maxTokens,
      system: useCache
        ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
        : system,
      messages,
    };
  }

  /**
   * Build Claude Haiku payload
   * Supports both (system, messages[], maxTokens) and (prompt, maxTokens)
   */
  buildHaikuPayload(
    system: string,
    messages: BedrockMessage[],
    maxTokens?: number
  ): BedrockPayload;
  buildHaikuPayload(
    prompt: string,
    maxTokens: number
  ): BedrockPayload;
  buildHaikuPayload(
    system: string,
    second: BedrockMessage[] | number,
    third?: number
  ): BedrockPayload {
    const messages: BedrockMessage[] =
      typeof second === 'number'
        ? [{ role: 'user', content: system }]
        : second;
    const maxTokens = typeof second === 'number' ? second : (third ?? 4096);
    return {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: maxTokens,
      system,
      messages,
    };
  }

  /**
   * Estimate cost in USD for a given model invocation
   */
  estimateCost(
    modelId: string,
    inputTokens: number,
    outputTokens: number
  ): number {
    const pricing = PRICING[modelId];
    if (!pricing) {
      log('warn', 'Unknown model for cost estimation', { modelId });
      return 0;
    }

    const inputCost = (inputTokens / 1000) * pricing.inputPer1K;
    const outputCost = (outputTokens / 1000) * pricing.outputPer1K;
    return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000; // 6 decimal places
  }

  /**
   * Parse JSON from model response, handling markdown code fences
   */
  static parseJsonResponse<T>(response: string): T {
    let cleaned = response.trim();

    // Remove markdown code fences if present
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }

    cleaned = cleaned.trim();

    return JSON.parse(cleaned) as T;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton export
export const bedrock = new BedrockHelper();
