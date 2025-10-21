import BaseService from '../BaseService.js';
import { MeteringService } from './MeteringService.js';

export class MeteringServiceWrapper extends BaseService {

    /** @type {import('./MeteringService.js').MeteringService} */
    meteringService = undefined;
    _init() {
        this.meteringService = new MeteringService({
            kvStore: this.services.get('puter-kvstore').as('puter-kvstore'),
            superUserService: this.services.get('su'),
            alarmService: this.services.get('alarm'),
            eventService: this.services.get('event'),
        });
    }
}
