import BaseService from '../../BaseService.js';
import { MeteringAndBillingService } from "./MeteringService.js";

export class MeteringAndBillingServiceWrapper extends BaseService {

    /** @type {import('./MeteringService').MeteringAndBillingService} */
    meteringAndBillingService = undefined;
    _init() {
        this.meteringAndBillingService = new MeteringAndBillingService({
            kvClientWrapper: this.services.get('puter-kvstore').as('puter-kvstore'),
            superUserService: this.services.get('su'),
            alarmService: this.services.get('alarm'),
        });
    }

    static IMPLEMENTS = {
        ['meteringService']: Object.getOwnPropertyNames(MeteringAndBillingService.prototype)
            .filter(n => n !== 'constructor')
            .reduce((acc, fn) => ({
                ...acc,
                [fn]: async function(...a) {
                    return await this.meteringAndBillingService[fn](...a);
                },
            }), {}),
    };

}
