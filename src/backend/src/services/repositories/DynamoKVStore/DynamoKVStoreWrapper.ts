import { BaseService } from '@heyputer/backend/src/services/BaseService.js';
import { DynamoKVStore } from './DynamoKVStore.js';

/**
 * Wrapping implemenation for traits registration and use in our core structure
 */
class DynamoKVStoreServiceWrapper extends BaseService {

    kvStore!: DynamoKVStore;
    _init () {
        this.kvStore = new DynamoKVStore({
            ddbClient: this.services.get('dynamoDb'),
            sqlClient: this.services.get('database'),
            meteringService: this.services.get('meteringService').meteringService,
            tableName: this.config.tableName || 'store-kv-v1',
        });
        Object.getOwnPropertyNames(DynamoKVStore.prototype).forEach(fn => {
            if ( fn === 'constructor' ) return;
            this[fn] = (...args: unknown[]) => this.kvStore[fn](...args);
        });
    }
    static IMPLEMENTS = {
        ['puter-kvstore']: Object.getOwnPropertyNames(DynamoKVStore.prototype)
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
