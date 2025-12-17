import { BaseService } from '@heyputer/backend/src/services/BaseService.js';
import { DDBClient } from './DDBClient.js';

/** Wrapping actual implementation to be usable through our core structure */
class DDBClientServiceWrapper extends BaseService {
    ddbClient!: DDBClient;
    _init () {
        this.ddbClient = new DDBClient(this.config as unknown as ConstructorParameters<typeof DDBClient>[0]);
        Object.getOwnPropertyNames(DDBClient.prototype).forEach(fn => {
            if ( fn === 'constructor' ) return;
            this[fn] = (...args: unknown[]) => this.ddbClient[fn](...args);
        });
    }
}

export const DDBClientWrapper = DDBClientServiceWrapper as unknown as DDBClient;
