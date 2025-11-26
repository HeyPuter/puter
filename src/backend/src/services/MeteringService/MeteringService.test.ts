import { describe, expect, it, vi } from 'vitest';
import { createTestKernel } from '../../../tools/test.mjs';
import * as config from '../../config';
import { Actor } from '../auth/Actor';
import { DBKVServiceWrapper } from '../repositories/DBKVStore/index.mjs';
import { GLOBAL_APP_KEY } from './consts.js';
import { MeteringService } from './MeteringService';
import { MeteringServiceWrapper } from './MeteringServiceWrapper.mjs';

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
            meteringService: MeteringServiceWrapper,
            'puter-kvstore': DBKVServiceWrapper,
        },
        initLevelString: 'init',
        testCore: true,
    });

    const testSubject = testKernel.services!.get('meteringService') as MeteringServiceWrapper;
    const eventService = testKernel.services!.get('event') as EventService;
    const makeActor = (userUuid: string, appUid?: string, email?: string) => {
        const actor = {
            type: {
                user: {
                    uuid: userUuid,
                    ...(email ? { email } : {}),
                },
                ...(appUid ? { app: { uid: appUid } } : {}),
            },
        } as unknown as Actor;
        return actor;
    };

    it('should be instantiated', () => {
        expect(testSubject).toBeInstanceOf(MeteringServiceWrapper);
    });

    it('should contain a copy of the public methods of meteringService too', () => {
        const meteringMethods = Object.getOwnPropertyNames(MeteringService.prototype)
            .filter((name) => name !== 'constructor');
        const wrapperMethods = testSubject as unknown as Record<string, unknown>;
        const missing = meteringMethods.filter((name) => typeof wrapperMethods[name] !== 'function');

        expect(missing).toEqual([]);
    });

    it('should have meteringService instantiated', async () => {
        expect(testSubject.meteringService).toBeInstanceOf(MeteringService);
    });

    it('should record usage for an actor properly', async () => {
        const res = await testSubject.meteringService.incrementUsage({ type: { user: { uuid: 'test-user-id' } } } as unknown as Actor,
                        'aws-polly:standard:character',
                        1);

        // TODO DS: validate the result properly
        expect(res).toBeDefined();
    });

    it('utilRecordUsageObject delegates tracked usage to batchIncrementUsages', () => {
        const actor = makeActor('util-user');
        const spy = vi.spyOn(testSubject.meteringService, 'batchIncrementUsages');

        testSubject.meteringService.utilRecordUsageObject({ read: 2, write: 3 }, actor, 'kv', { write: 50 });

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(actor, [
            { usageType: 'kv:read', usageAmount: 2, costOverride: undefined },
            { usageType: 'kv:write', usageAmount: 3, costOverride: 50 },
        ]);
        spy.mockRestore();
    });

    it('batchIncrementUsages aggregates totals per usage type', async () => {
        const actor = makeActor('batch-user', 'batch-app');

        const res = await testSubject.meteringService.batchIncrementUsages(actor, [
            { usageType: 'kv:write', usageAmount: 2 },
            { usageType: 'kv:read', usageAmount: 3 },
        ]);

        expect(res.total).toBe(439); // (125 * 2) + (63 * 3)
        expect(res['kv:write']).toMatchObject({ units: 2, cost: 250, count: 1 });
        expect(res['kv:read']).toMatchObject({ units: 3, cost: 189, count: 1 });
    });

    it('getActorCurrentMonthUsageDetails groups current app and others', async () => {
        const userId = 'usage-detail-user';
        const actorAppOne = makeActor(userId, 'app-one');
        const actorAppTwo = makeActor(userId, 'app-two');

        await testSubject.meteringService.incrementUsage(actorAppOne, 'kv:write', 1);
        await testSubject.meteringService.incrementUsage(actorAppTwo, 'kv:read', 2);

        const details = await testSubject.meteringService.getActorCurrentMonthUsageDetails(actorAppOne);

        expect(details.usage.total).toBe(251);
        expect(details.appTotals['app-one']).toMatchObject({ total: 125, count: 1 });
        expect(details.appTotals.others).toMatchObject({ total: 126, count: 1 });
    });

    it('getActorCurrentMonthAppUsageDetails returns per-app usage', async () => {
        const actor = makeActor('app-usage-user', 'app-usage-app');
        await testSubject.meteringService.incrementUsage(actor, 'kv:write', 1);

        const usage = await testSubject.meteringService.getActorCurrentMonthAppUsageDetails(actor);

        expect(usage.total).toBe(125);
        expect(usage['kv:write']).toMatchObject({ cost: 125, units: 1, count: 1 });
    });

    it('getActorCurrentMonthAppUsageDetails rejects when actor queries another app', async () => {
        const actor = makeActor('app-usage-user-2', 'app-one');
        await expect(testSubject.meteringService.getActorCurrentMonthAppUsageDetails(actor, 'app-two'))
            .rejects
            .toThrow('Actor can only get usage details for their own app or global app');
    });

    it('getAllowedUsage respects subscription overrides and consumed usage', async () => {
        const actor = makeActor('limited-user');
        const customPolicy = { id: 'tiny', monthUsageAllowance: 10, monthlyStorageAllowance: 0 };
        const detPolicies = eventService.on('metering:registerAvailablePolicies', (_key, data) => {
            data.availablePolicies.push(customPolicy);
        });
        const detUserSub = eventService.on('metering:getUserSubscription', (_key, data) => {
            data.userSubscriptionId = customPolicy.id;
        });

        try {
            await testSubject.meteringService.incrementUsage(actor, 'kv:write', 1);
            const allowed = await testSubject.meteringService.getAllowedUsage(actor);

            expect(allowed.monthUsageAllowance).toBe(10);
            expect(allowed.remaining).toBe(0);
            expect(allowed.addons).toEqual({});
            expect(await testSubject.meteringService.hasAnyUsage(actor)).toBe(false);
            expect(await testSubject.meteringService.hasEnoughCreditsFor(actor, 'kv:read', 1)).toBe(false);
            expect(await testSubject.meteringService.hasEnoughCredits(actor, 1)).toBe(false);
        } finally {
            detPolicies.detach();
            detUserSub.detach();
        }
    });

    it('updateAddonCredit stores addon credits retrievable via getActorAddons', async () => {
        const userId = 'addon-user';
        await testSubject.meteringService.updateAddonCredit(userId, 500);

        const addons = await testSubject.meteringService.getActorAddons(makeActor(userId));

        expect(addons).toMatchObject({ purchasedCredits: 500 });
    });

    it('getGlobalUsage aggregates totals across shards', async () => {
        const actor = makeActor('global-user', 'global-app');
        const before = await testSubject.meteringService.getGlobalUsage();
        await testSubject.meteringService.incrementUsage(actor, 'kv:write', 1);
        const after = await testSubject.meteringService.getGlobalUsage();

        const beforeRecord = before['kv:write'] || { cost: 0, units: 0, count: 0 };
        const afterRecord = after['kv:write'] || { cost: 0, units: 0, count: 0 };

        expect(after.total - before.total).toBe(125);
        expect(afterRecord.cost - beforeRecord.cost).toBe(125);
        expect(afterRecord.units - beforeRecord.units).toBe(1);
        expect(afterRecord.count - beforeRecord.count).toBe(1);
    });

    it('getActorAppUsage rejects when actor is scoped to another app', async () => {
        const actor = makeActor('app-usage-user-3', 'app-one');
        await expect(testSubject.meteringService.getActorAppUsage(actor, 'app-two'))
            .rejects
            .toThrow('Actor can only get usage for their own app');
    });

    it('getActorAppUsage returns zeroed usage when none exists', async () => {
        const actor = makeActor('app-usage-user-4');
        const usage = await testSubject.meteringService.getActorAppUsage(actor, GLOBAL_APP_KEY);

        expect(usage).toMatchObject({ total: 0 });
    });

    it('should record usage for an actor when cost is overwritten', async () => {
        const actor = makeActor('overridden-cost-user');
        const res = await testSubject.meteringService.incrementUsage(actor,
                        'aws-polly:standard:character',
                        10,
                        12);

        expect(res.total).toBe(12);
        expect(res['aws-polly:standard:character']).toMatchObject({ cost: 12, units: 10, count: 1 });
    });
});
