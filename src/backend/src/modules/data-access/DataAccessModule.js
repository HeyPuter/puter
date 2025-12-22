import { AdvancedBase } from '@heyputer/putility';
import AppService from './AppService.js';

export class DataAccessModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        services.registerService('app', AppService);
    }
}
