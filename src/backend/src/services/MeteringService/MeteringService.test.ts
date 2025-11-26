import { describe, expect, it } from 'vitest';
import { createTestKernel } from '../../../tools/test.mjs';
import { MeteringServiceWrapper } from './MeteringServiceWrapper.mjs';
import { DBKVServiceWrapper } from '../repositories/DBKVStore/index.mjs';
import { SUService } from '../SUService';
import { AlarmService } from '../../modules/core/AlarmService';
import { EventService } from '../../services/EventService';
import { SqliteDatabaseAccessService } from '../database/SqliteDatabaseAccessService';
import { MeteringService } from './MeteringService';
import * as config from '../../config';
import { CommandService } from '../CommandService';
import { TraceService } from '../TraceService';
import { Actor } from '../auth/Actor';
import { GetUserService } from '../GetUserService';
import { DetailProviderService } from '../DetailProviderService';
describe('MeteringService', async () => {

    config.load_config({
        'services': {
            'database': {
                path: ':memory:',
            },
        },
    });
    const testKernel = await createTestKernel({
        serviceMap: {
            'whoami': DetailProviderService,
            'get-user': GetUserService,
            database: SqliteDatabaseAccessService,
            traceService: TraceService,
            meteringService: MeteringServiceWrapper,
            'puter-kvstore': DBKVServiceWrapper,
            su: SUService,
            alarm: AlarmService,
            event: EventService,
            commands: CommandService,
        },
        initLevelString: 'init',
    });
    await testKernel.services?.get('su').__on('boot.consolidation', []);

    const testSubject = testKernel.services!.get('meteringService') as MeteringServiceWrapper;

    it('should be instantiated', () => {
        expect(testSubject).toBeInstanceOf(MeteringServiceWrapper);
    });

    it('should contain a copy of the public methods of meteringService too', () => {
        // TODO DS: check all public MeteringService exist on the wrapper
    });

    it('should have meteringService instantiated', async () => {
        expect(testSubject.meteringService).toBeInstanceOf(MeteringService);
    });

    it('should record usage for an actor', async () => {
        const res = await testSubject.meteringService.incrementUsage({ type: { user: { uuid: 'test-user-id' } } } as unknown as Actor,
                        'aws-polly:standard:character',
                        1);

        console.log(res);
        expect(res).toBeDefined();
    });

});
