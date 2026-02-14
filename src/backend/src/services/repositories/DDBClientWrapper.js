import { BaseService } from '@heyputer/backend/src/services/BaseService.js';
import { DDBClient } from './DDBClient.js';
class DDBClientServiceWrapper extends BaseService {
    ddbClient;
    async _construct () {
        this.ddbClient = new DDBClient(this.config);
        await this.ddbClient.ddbClientPromise;
        Object.getOwnPropertyNames(DDBClient.prototype).forEach(fn => {
            if ( fn === 'constructor' )
            {
                return;
            }
            this[fn] = (...args) => this.ddbClient[fn](...args);
        });
    }
}
export const DDBClientWrapper = DDBClientServiceWrapper;
//# sourceMappingURL=DDBClientWrapper.js.map