// ============================================================================
// LAZARUS — DynamoDB Helper
// Fully typed helper with all operations needed across the platform
// ============================================================================

import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  BatchGetCommand,
  BatchWriteCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from './aws-clients';
import { log } from './logger';

export class DynamoDBHelper {
  /**
   * Get a single item by primary key
   */
  async get<T extends Record<string, any>>(
    table: string,
    key: Record<string, string | number>
  ): Promise<T | null> {
    try {
      const result = await dynamoClient.send(
        new GetCommand({ TableName: table, Key: key })
      );
      return (result.Item as T) ?? null;
    } catch (error) {
      log('error', 'DynamoDB get failed', { table, key, error: String(error) });
      throw error;
    }
  }

  /**
   * Put an item with automatic timestamp injection
   */
  async put<T extends Record<string, any>>(
    table: string,
    item: T
  ): Promise<void> {
    const now = new Date().toISOString();
    const enrichedItem = {
      ...item,
      createdAt: (item as Record<string, unknown>)['createdAt'] ?? now,
      updatedAt: now,
    };

    try {
      await dynamoClient.send(
        new PutCommand({ TableName: table, Item: enrichedItem })
      );
    } catch (error) {
      log('error', 'DynamoDB put failed', { table, error: String(error) });
      throw error;
    }
  }

  /**
   * Partial update with automatic expression builder
   */
  async update(
    table: string,
    key: Record<string, string | number>,
    fields: Record<string, unknown>
  ): Promise<void> {
    const now = new Date().toISOString();
    const allFields = { ...fields, updatedAt: now };

    const expressionParts: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};

    let i = 0;
    for (const [fieldName, fieldValue] of Object.entries(allFields)) {
      const nameKey = `#f${i}`;
      const valueKey = `:v${i}`;
      expressionParts.push(`${nameKey} = ${valueKey}`);
      names[nameKey] = fieldName;
      values[valueKey] = fieldValue;
      i++;
    }

    try {
      await dynamoClient.send(
        new UpdateCommand({
          TableName: table,
          Key: key,
          UpdateExpression: `SET ${expressionParts.join(', ')}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        })
      );
    } catch (error) {
      log('error', 'DynamoDB update failed', {
        table,
        key,
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Conditional delete
   */
  async delete(
    table: string,
    key: Record<string, string | number>,
    condition?: string
  ): Promise<void> {
    try {
      await dynamoClient.send(
        new DeleteCommand({
          TableName: table,
          Key: key,
          ...(condition ? { ConditionExpression: condition } : {}),
        })
      );
    } catch (error) {
      log('error', 'DynamoDB delete failed', {
        table,
        key,
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Query with pagination support
   */
  async query<T extends Record<string, any>>(
    table: string,
    pkName: string,
    pkValue: string | number,
    options?: {
      skName?: string;
      skValue?: string | number;
      skBeginsWith?: string;
      scanForward?: boolean;
      limit?: number;
      startKey?: Record<string, unknown>;
      filterExpression?: string;
      filterValues?: Record<string, unknown>;
    }
  ): Promise<{ items: T[]; lastKey?: Record<string, unknown> }> {
    let keyExpression = '#pk = :pk';
    const names: Record<string, string> = { '#pk': pkName };
    const values: Record<string, unknown> = { ':pk': pkValue };

    if (options?.skName && options?.skValue !== undefined) {
      keyExpression += ' AND #sk = :sk';
      names['#sk'] = options.skName;
      values[':sk'] = options.skValue;
    } else if (options?.skName && options?.skBeginsWith !== undefined) {
      keyExpression += ' AND begins_with(#sk, :skPrefix)';
      names['#sk'] = options.skName;
      values[':skPrefix'] = options.skBeginsWith;
    }

    if (options?.filterValues) {
      for (const [k, v] of Object.entries(options.filterValues)) {
        values[k] = v;
      }
    }

    try {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: keyExpression,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ScanIndexForward: options?.scanForward ?? true,
          Limit: options?.limit,
          ExclusiveStartKey: options?.startKey as Record<string, unknown>,
          FilterExpression: options?.filterExpression,
        })
      );

      return {
        items: (result.Items ?? []) as T[],
        lastKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
      };
    } catch (error) {
      log('error', 'DynamoDB query failed', {
        table,
        pkName,
        pkValue,
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Query a Global Secondary Index
   */
  async queryGSI<T extends Record<string, any>>(
    table: string,
    indexName: string,
    pkName: string,
    pkValue: string | number,
    options?: {
      skName?: string;
      skValue?: string | number;
      scanForward?: boolean;
      limit?: number;
    }
  ): Promise<T[]> {
    let keyExpression = '#pk = :pk';
    const names: Record<string, string> = { '#pk': pkName };
    const values: Record<string, unknown> = { ':pk': pkValue };

    if (options?.skName && options?.skValue !== undefined) {
      keyExpression += ' AND #sk = :sk';
      names['#sk'] = options.skName;
      values[':sk'] = options.skValue;
    }

    try {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: table,
          IndexName: indexName,
          KeyConditionExpression: keyExpression,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ScanIndexForward: options?.scanForward ?? false,
          Limit: options?.limit,
        })
      );

      return (result.Items ?? []) as T[];
    } catch (error) {
      log('error', 'DynamoDB GSI query failed', {
        table,
        indexName,
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Batch get — handles 100-item limit automatically
   */
  async batchGet<T extends Record<string, any>>(
    table: string,
    keys: Record<string, string | number>[]
  ): Promise<T[]> {
    const results: T[] = [];
    const BATCH_SIZE = 100;

    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const batch = keys.slice(i, i + BATCH_SIZE);

      try {
        const result = await dynamoClient.send(
          new BatchGetCommand({
            RequestItems: {
              [table]: { Keys: batch },
            },
          })
        );

        const items = result.Responses?.[table] ?? [];
        results.push(...(items as T[]));

        // Handle unprocessed keys with retry
        let unprocessed = result.UnprocessedKeys?.[table]?.Keys;
        let retries = 0;
        while (unprocessed && unprocessed.length > 0 && retries < 3) {
          await this.sleep(Math.pow(2, retries) * 100);
          const retryResult = await dynamoClient.send(
            new BatchGetCommand({
              RequestItems: { [table]: { Keys: unprocessed } },
            })
          );
          const retryItems = retryResult.Responses?.[table] ?? [];
          results.push(...(retryItems as T[]));
          unprocessed = retryResult.UnprocessedKeys?.[table]?.Keys;
          retries++;
        }
      } catch (error) {
        log('error', 'DynamoDB batchGet failed', {
          table,
          batchIndex: i,
          error: String(error),
        });
        throw error;
      }
    }

    return results;
  }

  /**
   * Batch write — handles 25-item limit + retry on UnprocessedItems
   */
  async batchWrite(
    table: string,
    items: Record<string, unknown>[]
  ): Promise<void> {
    const BATCH_SIZE = 25;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      const requests = batch.map((item) => ({
        PutRequest: { Item: item },
      }));

      try {
        const result = await dynamoClient.send(
          new BatchWriteCommand({
            RequestItems: { [table]: requests },
          })
        );

        // Retry unprocessed items
        let unprocessed = result.UnprocessedItems?.[table];
        let retries = 0;
        while (unprocessed && unprocessed.length > 0 && retries < 3) {
          await this.sleep(Math.pow(2, retries) * 200);
          const retryResult = await dynamoClient.send(
            new BatchWriteCommand({
              RequestItems: { [table]: unprocessed },
            })
          );
          unprocessed = retryResult.UnprocessedItems?.[table];
          retries++;
        }
      } catch (error) {
        log('error', 'DynamoDB batchWrite failed', {
          table,
          batchIndex: i,
          error: String(error),
        });
        throw error;
      }
    }
  }

  /**
   * Sum a numeric field for a given partition key
   */
  async sumField(
    table: string,
    pkName: string,
    pkValue: string,
    fieldName: string
  ): Promise<number> {
    let total = 0;
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await this.query<Record<string, unknown>>(
        table,
        pkName,
        pkValue,
        { startKey: lastKey }
      );
      for (const item of result.items) {
        const val = item[fieldName];
        if (typeof val === 'number') {
          total += val;
        }
      }
      lastKey = result.lastKey;
    } while (lastKey);

    return total;
  }

  /**
   * Atomic increment on a numeric field
   */
  async atomicAdd(
    table: string,
    key: Record<string, string | number>,
    fieldName: string,
    amount: number
  ): Promise<number> {
    try {
      const result = await dynamoClient.send(
        new UpdateCommand({
          TableName: table,
          Key: key,
          UpdateExpression:
            'SET #field = if_not_exists(#field, :zero) + :amount, #updatedAt = :now',
          ExpressionAttributeNames: {
            '#field': fieldName,
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':amount': amount,
            ':zero': 0,
            ':now': new Date().toISOString(),
          },
          ReturnValues: 'UPDATED_NEW',
        })
      );

      return (result.Attributes?.[fieldName] as number) ?? 0;
    } catch (error) {
      log('error', 'DynamoDB atomicAdd failed', {
        table,
        key,
        fieldName,
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Append an item to a list attribute
   */
  async appendToList(
    table: string,
    key: Record<string, string | number>,
    listFieldName: string,
    item: unknown
  ): Promise<void> {
    try {
      await dynamoClient.send(
        new UpdateCommand({
          TableName: table,
          Key: key,
          UpdateExpression:
            'SET #listField = list_append(if_not_exists(#listField, :emptyList), :newItem), #updatedAt = :now',
          ExpressionAttributeNames: {
            '#listField': listFieldName,
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':newItem': [item],
            ':emptyList': [],
            ':now': new Date().toISOString(),
          },
        })
      );
    } catch (error) {
      log('error', 'DynamoDB appendToList failed', {
        table,
        key,
        listFieldName,
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Transact write — DynamoDB transactions
   */
  async transactWrite(
    items: TransactWriteCommandInput['TransactItems']
  ): Promise<void> {
    try {
      await dynamoClient.send(
        new TransactWriteCommand({ TransactItems: items })
      );
    } catch (error) {
      log('error', 'DynamoDB transactWrite failed', {
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Query all items with automatic pagination
   */
  async queryAll<T extends Record<string, any>>(
    table: string,
    pkName: string,
    pkValue: string | number
  ): Promise<T[]> {
    const allItems: T[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await this.query<T>(table, pkName, pkValue, {
        startKey: lastKey,
      });
      allItems.push(...result.items);
      lastKey = result.lastKey;
    } while (lastKey);

    return allItems;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton export
export const db = new DynamoDBHelper();
