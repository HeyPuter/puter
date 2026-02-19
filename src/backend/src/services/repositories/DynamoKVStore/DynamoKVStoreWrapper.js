import { BaseService } from '@heyputer/backend/src/services/BaseService.js';
import { DynamoKVStore } from './DynamoKVStore.js';
class DynamoKVStoreServiceWrapper extends BaseService {
    kvStore;
    async _init () {
        this.kvStore = new DynamoKVStore({
            ddbClient: this.services.get('dynamo'),
            sqlClient: this.services.get('database').get(),
            meteringService: this.services.get('meteringService').meteringService,
            tableName: this.config.tableName || 'store-kv-v1',
        });
        await this.kvStore.createTableIfNotExists();
        Object.getOwnPropertyNames(DynamoKVStore.prototype).forEach(fn => {
            if ( fn === 'constructor' )
            {
                return;
            }
            this[fn] = (...args) => this.kvStore[fn](...args);
        });
    }
    async registerHealthcheck () {
        const healthcheckService = this.services.get('server-health');
        healthcheckService.add_check('kv-store', async () => {
            try {
                const passed = await this.services.get('su').sudo(async () => {
                    const rand = Math.floor(Math.random() * 1000000);
                    await this.kvStore.set({ key: 'healthTestKey', value: rand });
                    const setRight = await this.kvStore.get({ key: 'healthTestKey' }) === rand;
                    await this.kvStore.del({ key: 'healthTestKey' });
                    return setRight;
                });
                if ( ! passed ) {
                    throw new Error('KV Store healthcheck failed: set/get mismatch');
                }
            }
            catch (e) {
                throw new Error(`KV Store healthcheck failed: ${e.message}`);
            }
        }).on_fail(async () => {
            await this.services.get('dynamo').recreateClient();
        });
    }
    static IMPLEMENTS = {
        'puter-kvstore': Object.getOwnPropertyNames(DynamoKVStore.prototype)
            .filter(n => n !== 'constructor')
            .reduce((acc, fn) => ({
                ...acc,
                [fn]: async function (...a) {
                    return await this.kvStore[fn](...a);
                },
            }), {}),
    };
}
export const DynamoKVStoreWrapper = DynamoKVStoreServiceWrapper;
//# sourceMappingURL=DynamoKVStoreWrapper.js.map