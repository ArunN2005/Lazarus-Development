// ============================================================================
// LAZARUS — Secrets Manager Helper
// With 60-second in-memory caching for hot-path secret reads
// ============================================================================

import {
  GetSecretValueCommand,
  CreateSecretCommand,
  UpdateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';
import { secretsClient } from './aws-clients';
import { log } from './logger';

interface CachedSecret {
  value: string;
  cachedAt: number;
}

const CACHE_TTL_MS = 60_000; // 60 seconds

export class SecretsHelper {
  private cache: Map<string, CachedSecret> = new Map();

  /**
   * Get a secret string value with 60s in-memory cache
   */
  async getSecret(secretId: string): Promise<string> {
    // Check cache
    const cached = this.cache.get(secretId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.value;
    }

    try {
      const result = await secretsClient.send(
        new GetSecretValueCommand({ SecretId: secretId })
      );

      const value = result.SecretString ?? '';
      this.cache.set(secretId, { value, cachedAt: Date.now() });
      return value;
    } catch (error) {
      log('error', 'Secrets getSecret failed', {
        secretId,
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Create or update a secret value
   */
  async putSecret(secretId: string, value: string): Promise<void> {
    try {
      const exists = await this.secretExists(secretId);
      if (exists) {
        await secretsClient.send(
          new UpdateSecretCommand({
            SecretId: secretId,
            SecretString: value,
          })
        );
      } else {
        await secretsClient.send(
          new CreateSecretCommand({
            Name: secretId,
            SecretString: value,
            Tags: [
              { Key: 'Project', Value: 'Lazarus' },
              { Key: 'Environment', Value: 'production' },
            ],
          })
        );
      }

      // Invalidate cache
      this.cache.delete(secretId);
    } catch (error) {
      log('error', 'Secrets putSecret failed', {
        secretId,
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Store a JSON object as a secret
   */
  async putSecretJson<T extends Record<string, unknown>>(
    secretId: string,
    obj: T
  ): Promise<void> {
    await this.putSecret(secretId, JSON.stringify(obj));
  }

  /**
   * Get and parse a JSON secret
   */
  async getSecretJson<T>(secretId: string): Promise<T> {
    const raw = await this.getSecret(secretId);
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      log('error', 'Secrets JSON parse failed', {
        secretId,
        error: String(error),
      });
      throw new Error(`Secret ${secretId} is not valid JSON`);
    }
  }

  /**
   * Delete a secret with no recovery option
   */
  async deleteSecret(
    secretId: string,
    forceDelete = true
  ): Promise<void> {
    try {
      await secretsClient.send(
        new DeleteSecretCommand({
          SecretId: secretId,
          ForceDeleteWithoutRecovery: forceDelete,
        })
      );
      this.cache.delete(secretId);
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === 'ResourceNotFoundException') {
        return; // Already deleted
      }
      log('error', 'Secrets deleteSecret failed', {
        secretId,
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Check if a secret exists
   */
  async secretExists(secretId: string): Promise<boolean> {
    try {
      await secretsClient.send(
        new DescribeSecretCommand({ SecretId: secretId })
      );
      return true;
    } catch (error: unknown) {
      if (error instanceof ResourceNotFoundException) {
        return false;
      }
      // For other errors, also treat as not found to be safe
      const err = error as { name?: string };
      if (err.name === 'ResourceNotFoundException') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Clear cache (useful for testing)
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Singleton export
export const secrets = new SecretsHelper();
