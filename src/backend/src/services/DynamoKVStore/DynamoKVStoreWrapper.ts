import type { DDBClient } from '@heyputer/backend/src/clients/dynamodb/DDBClient.js';
import { BaseService } from '@heyputer/backend/src/services/BaseService.js';
import { randomUUID } from 'node:crypto';
import { kv } from '../../util/kvSingleton.js';
import { DynamoKVStore } from './DynamoKVStore.js';

const SECOND = 1000;
const DDB_OPERATION_LATENCY_FAIL_MS = 2 * SECOND;
const DDB_HEALTHCHECK_NAMESPACE = 'healthcheck';
const DDB_HEALTHCHECK_RESULT_CACHE_WINDOW_SECONDS = 3;

/**
 * Wrapping implemenation for traits registration and use in our core structure
 */
class DynamoKVStoreServiceWrapper extends BaseService {

    kvStore!: DynamoKVStore;
    ddbClient!: DDBClient;
    kvStoreHealthcheckCache_:
        { expiresAtMs: number; passed: boolean } |
        null = null;

    async _init () {
        const tableName = this.config.tableName || 'store-kv-v1';
        this.ddbClient = this.services.get('dynamo') as DDBClient;
        this.kvStore = new DynamoKVStore({
            ddbClient: this.ddbClient,
            sqlClient: this.services.get('database').get(),
            meteringService: this.services.get('meteringService').meteringService,
            tableName,
        });
        await this.kvStore.createTableIfNotExists();

        Object.getOwnPropertyNames(DynamoKVStore.prototype).forEach(fn => {
            if ( fn === 'constructor' ) return;
            this[fn] = (...args: unknown[]) => this.kvStore[fn](...args);
        });

        const checkDdbClientLatency = async () => {
            const healthcheckCacheKey = `dynamodb:healthcheck:last-run:${tableName}`;
            try {
                const cachedHealthcheckResult = await kv.get(healthcheckCacheKey);
                if ( cachedHealthcheckResult ) {
                    try {
                        const parsedCachedResult = JSON.parse(cachedHealthcheckResult);
                        if ( parsedCachedResult?.ok ) {
                            return parsedCachedResult;
                        }
                        throw new Error(parsedCachedResult?.error || 'cached dynamo kv healthcheck failure');
                    } catch ( parseError ) {
                        if ( parseError instanceof SyntaxError ) {
                            // ignore invalid cache payload and run a fresh healthcheck
                        } else {
                            throw parseError;
                        }
                    }
                }
            } catch ( error ) {
                if ( error instanceof Error ) throw error;
                this.log.warn('unable to read dynamo healthcheck result cache; continuing', {
                    error: error instanceof Error ? error.message : String(error),
                });
            }

            const healthcheckKey = randomUUID();
            const key = {
                namespace: DDB_HEALTHCHECK_NAMESPACE,
                key: healthcheckKey,
            };
            const item = {
                ...key,
                value: Date.now(),
            };
            const operationLatenciesMs = {
                set: 0,
                get: 0,
                del: 0,
            };
            const healthcheckResult: {
                ok: boolean;
                checkedAtMs: number;
                operationLatenciesMs: typeof operationLatenciesMs;
                error?: string;
            } = {
                ok: true,
                checkedAtMs: Date.now(),
                operationLatenciesMs,
            };
            const writeHealthcheckResultToCache = async () => {
                try {
                    await kv.set(healthcheckCacheKey, JSON.stringify(healthcheckResult), {
                        EX: DDB_HEALTHCHECK_RESULT_CACHE_WINDOW_SECONDS,
                    });
                } catch ( error ) {
                    this.log.warn('unable to write dynamo healthcheck result cache; continuing', {
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            };

            const runTimedOperation = async <T>(
                operationName: keyof typeof operationLatenciesMs,
                operation: () => Promise<T>,
            ) => {
                const startedAt = Date.now();
                await Promise.race([
                    operation(),
                    new Promise<never>((_resolve, reject) => {
                        setTimeout(() => {
                            reject(new Error(`dynamo kv healthcheck ${operationName} timed out`));
                        }, DDB_OPERATION_LATENCY_FAIL_MS);
                    }),
                ]);
                operationLatenciesMs[operationName] = Date.now() - startedAt;
            };

            try {
                await runTimedOperation('set', async () => {
                    await this.ddbClient.put(tableName, item);
                });
                await runTimedOperation('get', async () => {
                    await this.ddbClient.get(tableName, key);
                });
                await runTimedOperation('del', async () => {
                    await this.ddbClient.del(tableName, key);
                });
            } catch ( error ) {
                healthcheckResult.ok = false;
                healthcheckResult.error = error instanceof Error
                    ? error.message
                    : String(error);
                await writeHealthcheckResultToCache();
                throw new Error(healthcheckResult.error);
            }

            const exceededLatencyThreshold = Object.values(operationLatenciesMs)
                .some(durationMs => durationMs > DDB_OPERATION_LATENCY_FAIL_MS);
            if ( ! exceededLatencyThreshold ) {
                await writeHealthcheckResultToCache();
                return healthcheckResult;
            }

            healthcheckResult.ok = false;
            healthcheckResult.error =
                `dynamo kv healthcheck latency exceeded threshold ${DDB_OPERATION_LATENCY_FAIL_MS}ms`;
            await writeHealthcheckResultToCache();
            throw new Error(healthcheckResult.error);
        };

        const svc_serverHealth = this.services.get('server-health');
        svc_serverHealth.add_check(`dynamo-kv:${tableName}`, async () => {
            await checkDdbClientLatency();
        }).on_fail(async () => {
            try {
                await this.ddbClient.recreateClient();
            } catch ( recreateError ) {
                this.log.error('failed to recreate dynamo client from server-health on_fail', {
                    error: recreateError instanceof Error ? recreateError.message : String(recreateError),
                });
            }
        });
    }

    static IMPLEMENTS = {
        'puter-kvstore': Object.getOwnPropertyNames(DynamoKVStore.prototype)
            .filter(n => n !== 'constructor')
            .reduce((acc, fn) => ({
                ...acc,
                [fn]: async function (...a) {
                    return await (this as DynamoKVStoreServiceWrapper).kvStore[fn](...a);
                },
            }), {}),
    };

}

export type IDynamoKVStoreWrapper = DynamoKVStoreServiceWrapper;

export const DynamoKVStoreWrapper = DynamoKVStoreServiceWrapper as unknown as DynamoKVStore;
