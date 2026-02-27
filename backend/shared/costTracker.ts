// ============================================================================
// LAZARUS — Cost Tracker
// Real-time cost tracking with DynamoDB persistence and WebSocket updates
// ============================================================================

import { db } from './dynamodb';
import { ws, WebSocketHelper } from './websocket';
import { log } from './logger';
import { getConfig } from './config';
import {
  WebSocketEventType,
  type CostEntry,
  type CostBreakdown,
} from './types';
import { MODELS } from './bedrock';

// ---------------------------------------------------------------------------
// Pricing constants
// ---------------------------------------------------------------------------

const BEDROCK_PRICING: Record<string, { inputPer1K: number; outputPer1K: number }> = {
  [MODELS.SONNET]: { inputPer1K: 0.003, outputPer1K: 0.015 },
  [MODELS.HAIKU]: { inputPer1K: 0.00025, outputPer1K: 0.00125 },
};

// Fargate pricing (ap-south-1)
const FARGATE_CPU_PER_VCPU_HOUR = 0.04048;
const FARGATE_MEM_PER_GB_HOUR = 0.004445;

// CodeBuild pricing
const CODEBUILD_PER_BUILD_MINUTE = 0.005;

export class CostTracker {
  /**
   * Record a cost entry for a project
   */
  async record(
    projectId: string,
    service: CostEntry['service'],
    inputTokens: number,
    outputTokens: number,
    operation: string,
    metadata: Record<string, string> = {}
  ): Promise<void> {
    const config = getConfig();
    const cost = this.calculateCost(service, inputTokens, outputTokens);

    const entry: CostEntry = {
      projectId,
      timestamp: new Date().toISOString(),
      service,
      operation,
      inputTokens,
      outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost,
      metadata,
    };

    try {
      // Write cost entry
      await db.put(config.costTrackingTable, entry);

      // Atomic increment on project total cost
      await db.atomicAdd(
        config.projectsTable,
        { projectId },
        'cost',
        cost
      );

      // Send WebSocket cost update
      const totalCost = await this.getTotalCost(projectId);
      await ws.send(
        projectId,
        WebSocketHelper.createEvent(
          WebSocketEventType.COST_UPDATE,
          projectId,
          { cost: totalCost, lastEntry: entry }
        )
      );
    } catch (error) {
      log('error', 'Cost tracking failed', {
        projectId,
        service,
        error: String(error),
      });
      // Don't throw — cost tracking failures should not block the pipeline
    }
  }

  /**
   * Record with cache tokens
   */
  async recordWithCache(
    projectId: string,
    service: CostEntry['service'],
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number,
    cacheWriteTokens: number,
    operation: string
  ): Promise<void> {
    const config = getConfig();

    // Cache pricing: read is 90% cheaper, write is 25% more expensive
    const baseCost = this.calculateCost(service, inputTokens, outputTokens);
    const cacheReadSavings =
      service === 'bedrock_sonnet'
        ? (cacheReadTokens / 1000) * 0.003 * 0.9
        : (cacheReadTokens / 1000) * 0.00025 * 0.9;
    const cacheWriteCost =
      service === 'bedrock_sonnet'
        ? (cacheWriteTokens / 1000) * 0.003 * 0.25
        : (cacheWriteTokens / 1000) * 0.00025 * 0.25;

    const totalCost = baseCost - cacheReadSavings + cacheWriteCost;
    const finalCost = Math.max(0, totalCost);

    const entry: CostEntry = {
      projectId,
      timestamp: new Date().toISOString(),
      service,
      operation,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      cost: finalCost,
      metadata: {},
    };

    try {
      await db.put(config.costTrackingTable, entry);
      await db.atomicAdd(
        config.projectsTable,
        { projectId },
        'cost',
        finalCost
      );
    } catch (error) {
      log('error', 'Cost tracking (cached) failed', {
        projectId,
        error: String(error),
      });
    }
  }

  /**
   * Get total cost for a project
   */
  async getTotalCost(projectId: string): Promise<number> {
    const config = getConfig();
    return db.sumField(
      config.costTrackingTable,
      'projectId',
      projectId,
      'cost'
    );
  }

  /**
   * Get cost breakdown by service
   */
  async getCostBreakdown(projectId: string): Promise<CostBreakdown> {
    const config = getConfig();
    const entries = await db.queryAll<CostEntry>(
      config.costTrackingTable,
      'projectId',
      projectId
    );

    const breakdown: CostBreakdown = {
      total: 0,
      bedrockSonnet: 0,
      bedrockHaiku: 0,
      codebuild: 0,
      ecsFargate: 0,
      appRunner: 0,
      other: 0,
    };

    for (const entry of entries) {
      breakdown.total += entry.cost;
      switch (entry.service) {
        case 'bedrock_sonnet':
          breakdown.bedrockSonnet += entry.cost;
          break;
        case 'bedrock_haiku':
          breakdown.bedrockHaiku += entry.cost;
          break;
        case 'codebuild':
          breakdown.codebuild += entry.cost;
          break;
        case 'ecs_fargate':
          breakdown.ecsFargate += entry.cost;
          break;
        case 'app_runner':
          breakdown.appRunner += entry.cost;
          break;
        default:
          breakdown.other += entry.cost;
      }
    }

    // Round all values
    for (const key of Object.keys(breakdown) as (keyof CostBreakdown)[]) {
      breakdown[key] = Math.round(breakdown[key] * 1_000_000) / 1_000_000;
    }

    return breakdown;
  }

  /**
   * Estimate Bedrock cost without recording
   */
  estimateBedrockCost(
    modelId: string,
    inputTokens: number,
    outputTokens: number
  ): number {
    const pricing = BEDROCK_PRICING[modelId];
    if (!pricing) return 0;

    const inputCost = (inputTokens / 1000) * pricing.inputPer1K;
    const outputCost = (outputTokens / 1000) * pricing.outputPer1K;
    return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
  }

  /**
   * Estimate ECS Fargate cost
   */
  estimateECSCost(
    cpuUnits: number,
    memoryMB: number,
    durationSeconds: number
  ): number {
    const hours = durationSeconds / 3600;
    const vCPUs = cpuUnits / 1024;
    const memGB = memoryMB / 1024;

    const cpuCost = vCPUs * FARGATE_CPU_PER_VCPU_HOUR * hours;
    const memCost = memGB * FARGATE_MEM_PER_GB_HOUR * hours;

    return Math.round((cpuCost + memCost) * 1_000_000) / 1_000_000;
  }

  /**
   * Estimate CodeBuild cost
   */
  estimateCodeBuildCost(durationSeconds: number): number {
    const minutes = Math.ceil(durationSeconds / 60);
    return Math.round(minutes * CODEBUILD_PER_BUILD_MINUTE * 1_000_000) / 1_000_000;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private calculateCost(
    service: CostEntry['service'],
    inputTokens: number,
    outputTokens: number
  ): number {
    switch (service) {
      case 'bedrock_sonnet':
        return this.estimateBedrockCost(MODELS.SONNET, inputTokens, outputTokens);
      case 'bedrock_haiku':
        return this.estimateBedrockCost(MODELS.HAIKU, inputTokens, outputTokens);
      case 'codebuild':
        return this.estimateCodeBuildCost(inputTokens); // inputTokens = durationSeconds
      case 'ecs_fargate':
        return this.estimateECSCost(inputTokens, outputTokens, 0); // repurposed params
      default:
        return 0;
    }
  }
}

// Singleton export
export const costTracker = new CostTracker();
