import BaseService from '../../BaseService.js';
import { MeteringAndBillingService } from "./MeteringService.mjs";

export class MeteringAndBillingServiceWrapper extends BaseService {

    /** @type {import('./MeteringService').MeteringAndBillingService} */
    meteringAndBillingService = undefined;
    _init() {
        this.meteringAndBillingService = new MeteringAndBillingService(this.services.get('puter-kvstore').as('puter-kvstore'), this.services.get('su'));
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
