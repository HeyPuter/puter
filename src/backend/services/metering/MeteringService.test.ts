import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { Actor } from '../../core/actor.ts';
import { SYSTEM_ACTOR } from '../../core/actor.ts';
import { PuterServer } from '../../server.ts';
import { setupTestServer } from '../../testUtil.ts';
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
    GLOBAL_APP_KEY,
    METRICS_PREFIX,
    PERIOD_ESCAPE,
    POLICY_PREFIX,
} from './consts.ts';
import type { MeteringService } from './MeteringService.ts';
import { toMicroCents } from './utils.ts';

const escape = (usageType: string) => usageType.replace(/\./g, PERIOD_ESCAPE);

describe('MeteringService', () => {
    let server: PuterServer;
    let target: MeteringService;
    let originalShardCount: number;

    // Resolvers and extra policies are stored on private fields of the service
    // and there's no public reset. Tests that register hooks pollute later
    // tests, so we snapshot the originals once and restore after each test.
    type Internals = {
        subscriptionResolvers: unknown[];
        defaultSubscriptionResolvers: unknown[];
        extraPolicies: unknown[];
    };
    let internals: Internals;
    let snapshot: {
        subs: unknown[];
        defs: unknown[];
        pols: unknown[];
    };

    beforeAll(async () => {
        server = await setupTestServer();
        target = server.services.metering;
        // Smaller shard count makes getGlobalUsage cheap in tests; the
        // production value (10000) means ~100 batchGet round-trips per call.
        originalShardCount = (target.constructor as typeof MeteringService)
            .GLOBAL_SHARD_COUNT;
        (target.constructor as typeof MeteringService).GLOBAL_SHARD_COUNT = 4;
        (target.constructor as typeof MeteringService).APP_SHARD_COUNT = 4;

        internals = target as unknown as Internals;
        snapshot = {
            subs: [...internals.subscriptionResolvers],
            defs: [...internals.defaultSubscriptionResolvers],
            pols: [...internals.extraPolicies],
        };
    });

    afterEach(() => {
        internals.subscriptionResolvers.length = 0;
        internals.subscriptionResolvers.push(...snapshot.subs);
        internals.defaultSubscriptionResolvers.length = 0;
        internals.defaultSubscriptionResolvers.push(...snapshot.defs);
        internals.extraPolicies.length = 0;
        internals.extraPolicies.push(...snapshot.pols);
    });

    afterAll(async () => {
        (target.constructor as typeof MeteringService).GLOBAL_SHARD_COUNT =
            originalShardCount;
        (target.constructor as typeof MeteringService).APP_SHARD_COUNT =
            originalShardCount;
        await server.shutdown();
    });

    // Each test uses a fresh user so KV state from one test never leaks into
    // the next. Email present → registered-user policy; absent → temp.
    let actor: Actor;
    const makeUser = (
        overrides: Partial<Actor['user']> = {},
    ): Actor['user'] => ({
        uuid: `meter-user-${Math.random().toString(36).slice(2)}`,
        username: 'meter-user',
        email: 'meter@test.com',
        ...overrides,
    });
    const makeActor = (overrides: Partial<Actor> = {}): Actor => ({
        user: makeUser(),
        ...overrides,
    });
    beforeEach(() => {
        actor = makeActor();
    });

    // Aux KV writes inside increment paths are fire-and-forget; this helper
    // polls until the assertion passes so tests stay deterministic without
    // arbitrary sleeps.
    const waitFor = (fn: () => unknown | Promise<unknown>) =>
        vi.waitFor(fn, { timeout: 2000, interval: 10 });

    // ── Subscriptions ────────────────────────────────────────────────

    describe('getActorSubscription', () => {
        it('returns the registered-user free policy for a user with email', async () => {
            const policy = await target.getActorSubscription(actor);
            expect(policy.id).toBe(DEFAULT_FREE_SUBSCRIPTION);
            expect(policy.monthUsageAllowance).toBeGreaterThan(0);
        });

        it('returns the temp policy for a user without email', async () => {
            const tempActor: Actor = {
                user: makeUser({ email: null }),
            };
            const policy = await target.getActorSubscription(tempActor);
            expect(policy.id).toBe(DEFAULT_TEMP_SUBSCRIPTION);
        });

        it('uses the first non-empty subscription resolver', async () => {
            const customPolicy = {
                id: 'custom-paid',
                monthUsageAllowance: toMicroCents(10),
                monthlyStorageAllowance: 1024 * 1024 * 1024,
            };
            target.registerPolicy(customPolicy);
            const stub = vi.fn(async () => 'custom-paid');
            target.registerSubscriptionResolver(stub);

            const policy = await target.getActorSubscription(actor);
            expect(policy.id).toBe('custom-paid');
            expect(stub).toHaveBeenCalledWith(actor);
        });

        it('falls through to the default resolver when the primary returns nothing', async () => {
            const customDefault = {
                id: 'custom-default',
                monthUsageAllowance: toMicroCents(2),
                monthlyStorageAllowance: 1024 * 1024 * 1024,
            };
            target.registerPolicy(customDefault);
            target.registerSubscriptionResolver(async () => null);
            target.registerDefaultSubscriptionResolver(
                async () => 'custom-default',
            );
            const policy = await target.getActorSubscription(actor);
            expect(policy.id).toBe('custom-default');
        });

        it('rejects an actor with no user uuid', async () => {
            await expect(
                target.getActorSubscription({
                    user: { uuid: '' },
                }),
            ).rejects.toMatchObject({ statusCode: 403 });
        });
    });

    // ── Addons ───────────────────────────────────────────────────────

    describe('getActorAddons / updateAddonCredit', () => {
        it('returns an empty addon map for a fresh user', async () => {
            const addons = await target.getActorAddons(actor);
            expect(addons).toEqual({});
        });

        it('updateAddonCredit increments purchasedCredits', async () => {
            await target.updateAddonCredit(actor.user.uuid!, 1000);
            const addons = await target.getActorAddons(actor);
            expect(addons.purchasedCredits).toBe(1000);

            await target.updateAddonCredit(actor.user.uuid!, 500);
            const updated = await target.getActorAddons(actor);
            expect(updated.purchasedCredits).toBe(1500);
        });

        it('updateAddonCredit throws without a userId', async () => {
            await expect(target.updateAddonCredit('', 100)).rejects.toThrow();
        });

        it('rejects getActorAddons for an actor with no user uuid', async () => {
            await expect(
                target.getActorAddons({ user: { uuid: '' } }),
            ).rejects.toMatchObject({ statusCode: 403 });
        });
    });

    // ── incrementUsage ───────────────────────────────────────────────

    describe('incrementUsage', () => {
        it('records cost, units, and count for a single usage type', async () => {
            const cost = 250;
            const result = await target.incrementUsage(
                actor,
                'kv:read',
                4,
                cost,
            );
            expect(result.total).toBe(cost);
            const record = result['kv:read'];
            expect(record).toMatchObject({ cost, units: 4, count: 1 });
        });

        it('escapes dots in usage type names so KV nested paths do not collide', async () => {
            await target.incrementUsage(actor, 'driver.foo.bar', 2, 100);
            const { usage } =
                await target.getActorCurrentMonthUsageDetails(actor);
            // Returned shape uses the escaped key (raw KV layout).
            const record = (usage as Record<string, unknown>)[
                escape('driver.foo.bar')
            ];
            expect(record).toMatchObject({ cost: 100, units: 2, count: 1 });
        });

        it('accumulates across calls', async () => {
            await target.incrementUsage(actor, 'kv:read', 1, 10);
            const second = await target.incrementUsage(actor, 'kv:read', 3, 20);
            expect(second.total).toBe(30);
            expect(second['kv:read']).toMatchObject({
                cost: 30,
                units: 4,
                count: 2,
            });
        });

        it('returns a zero result for a system actor and writes nothing', async () => {
            const result = await target.incrementUsage(
                SYSTEM_ACTOR,
                'kv:read',
                1,
                100,
            );
            expect(result).toEqual({ total: 0 });
        });

        it.each([
            ['zero amount', 'kv:read', 0],
            ['empty usage type', '', 1],
        ])('skips when %s', async (_label, type, amount) => {
            const result = await target.incrementUsage(actor, type, amount, 5);
            expect(result).toEqual({ total: 0 });

            const { usage } =
                await target.getActorCurrentMonthUsageDetails(actor);
            expect(usage.total ?? 0).toBe(0);
        });

        it('normalizes a negative usageAmount to 1', async () => {
            const result = await target.incrementUsage(
                actor,
                'kv:read',
                -5,
                10,
            );
            expect(result['kv:read']).toMatchObject({ units: 1 });
        });

        it('normalizes a negative costOverride to 1 and raises an alarm', async () => {
            const alarmSpy = vi.spyOn(server.clients.alarm, 'create');
            const result = await target.incrementUsage(
                actor,
                'kv:read',
                1,
                -42,
            );
            expect(result['kv:read']).toMatchObject({ cost: 1, units: 1 });
            expect(alarmSpy).toHaveBeenCalledWith(
                expect.stringContaining('negative cost'),
                expect.any(String),
                expect.objectContaining({ usageType: 'kv:read' }),
            );
            alarmSpy.mockRestore();
        });

        it('treats a missing costOverride as zero cost', async () => {
            const result = await target.incrementUsage(actor, 'kv:read', 2);
            expect(result.total).toBe(0);
            expect(result['kv:read']).toMatchObject({
                cost: 0,
                units: 2,
                count: 1,
            });
        });

        it('writes the per-actor / per-app aux record', async () => {
            const appActor: Actor = {
                user: makeUser(),
                app: { uid: 'my-app', id: 1 },
            };
            await target.incrementUsage(appActor, 'kv:read', 1, 100);
            await waitFor(async () => {
                const u = await target.getActorAppUsage(appActor, 'my-app');
                expect(u.total).toBe(100);
            });
        });

        it('consumes purchased credits once monthly allowance is exceeded', async () => {
            const overActor: Actor = { user: makeUser() };
            const sub = await target.getActorSubscription(overActor);
            await target.updateAddonCredit(overActor.user.uuid!, 5_000_000);

            // Spend the entire monthly allowance — no overage yet.
            await target.incrementUsage(
                overActor,
                'kv:read',
                1,
                sub.monthUsageAllowance,
            );
            // First overage of 1_000_000 micro-cents should pull from credits.
            await target.incrementUsage(overActor, 'kv:read', 1, 1_000_000);

            await waitFor(async () => {
                const addons = await target.getActorAddons(overActor);
                expect(addons.consumedPurchaseCredits).toBe(1_000_000);
            });
        });
    });

    // ── overuse alarm ────────────────────────────────────────────────

    describe('overuse alarm', () => {
        const wasOveruseAlarmed = (alarmSpy: ReturnType<typeof vi.spyOn>) =>
            alarmSpy.mock.calls.some(
                (call) =>
                    typeof call[0] === 'string' &&
                    call[0].includes('usage exceeded'),
            );

        it('does not alarm when a single large request crosses the limit in one shot', async () => {
            const bigActor: Actor = { user: makeUser() };
            const sub = await target.getActorSubscription(bigActor);
            const alarmSpy = vi.spyOn(server.clients.alarm, 'create');

            // Previous usage was 0 (under the allowance) — one big request that
            // blows straight past several multiples is legitimate, not abuse.
            await target.incrementUsage(
                bigActor,
                'ai:chat',
                1,
                sub.monthUsageAllowance * 5,
            );

            expect(wasOveruseAlarmed(alarmSpy)).toBe(false);
            alarmSpy.mockRestore();
        });

        it('does not alarm on further usage past the limit until the next multiple is crossed', async () => {
            const overActor: Actor = { user: makeUser() };
            const sub = await target.getActorSubscription(overActor);

            // Take them just over the allowance (into the 1x–2x band).
            await target.incrementUsage(
                overActor,
                'ai:chat',
                1,
                sub.monthUsageAllowance,
            );

            // A small further expense stays within the same band — no new
            // multiple crossed, so it shouldn't page.
            const alarmSpy = vi.spyOn(server.clients.alarm, 'create');
            await target.incrementUsage(overActor, 'ai:chat', 1, 1_000);

            expect(wasOveruseAlarmed(alarmSpy)).toBe(false);
            alarmSpy.mockRestore();
        });

        it('alarms when a whole multiple of the allowance is crossed while already over', async () => {
            const overActor: Actor = { user: makeUser() };
            const sub = await target.getActorSubscription(overActor);

            // First expense takes them to the limit (1x) — no alarm yet.
            await target.incrementUsage(
                overActor,
                'ai:chat',
                1,
                sub.monthUsageAllowance,
            );

            // Spy only on the expense that crosses into 2x while already over.
            const alarmSpy = vi.spyOn(server.clients.alarm, 'create');
            await target.incrementUsage(
                overActor,
                'ai:chat',
                1,
                sub.monthUsageAllowance,
            );

            expect(alarmSpy).toHaveBeenCalledWith(
                expect.stringContaining('usage exceeded'),
                expect.stringContaining('exceeded their usage allowance'),
                expect.objectContaining({ totalUsage: expect.any(Number) }),
                // Non-paging severity — records and de-dupes but doesn't page on-call.
                'warning',
            );
            alarmSpy.mockRestore();
        });

        it('does not alarm while purchased credits still cover the overage', async () => {
            const creditActor: Actor = { user: makeUser() };
            const sub = await target.getActorSubscription(creditActor);
            await target.updateAddonCredit(
                creditActor.user.uuid!,
                5_000_000_000,
            );

            // Cross to 2x — would page if not for the credits covering it.
            await target.incrementUsage(
                creditActor,
                'ai:chat',
                1,
                sub.monthUsageAllowance,
            );

            const alarmSpy = vi.spyOn(server.clients.alarm, 'create');
            await target.incrementUsage(
                creditActor,
                'ai:chat',
                1,
                sub.monthUsageAllowance,
            );

            expect(wasOveruseAlarmed(alarmSpy)).toBe(false);
            alarmSpy.mockRestore();
        });

        it('does not alarm while the actor is spending down purchased credit', async () => {
            const creditActor: Actor = { user: makeUser() };
            const sub = await target.getActorSubscription(creditActor);
            // Three allowances' worth of purchased credit on top of the monthly
            // allowance — a total budget of 4x the allowance.
            await target.updateAddonCredit(
                creditActor.user.uuid!,
                sub.monthUsageAllowance * 3,
            );

            const alarmSpy = vi.spyOn(server.clients.alarm, 'create');
            // Burn through the entire budget (allowance + all purchased credit).
            // A user actively spending paid-for credit must never page, and even
            // landing exactly at the budget shouldn't yet.
            await target.incrementUsage(
                creditActor,
                'ai:chat',
                1,
                sub.monthUsageAllowance * 3,
            );
            await target.incrementUsage(
                creditActor,
                'ai:chat',
                1,
                sub.monthUsageAllowance,
            );

            expect(wasOveruseAlarmed(alarmSpy)).toBe(false);
            alarmSpy.mockRestore();
        });

        it('does not page the moment purchased credit runs dry between allowance marks', async () => {
            // Regression: the alarm used to count allowance multiples from zero
            // and only gate on the credit being gone, so the first expense after
            // a user's purchased credit ran out would page even though they had
            // just been spending credit they paid for. The purchased credit must
            // shift the baseline the multiples are measured from.
            //
            // The registered-user free allowance is 25e6 micro-cents. Purchased
            // credit of 37.5e6 (1.5x) makes the full budget run dry at 62.5e6 —
            // between the 2x (50e6) and 3x (75e6) allowance marks — so a small
            // expense just past it crosses a from-zero multiple (old: pages)
            // without crossing a net-of-credit multiple (new: quiet).
            const creditActor: Actor = { user: makeUser() };
            const sub = await target.getActorSubscription(creditActor);
            expect(sub.monthUsageAllowance).toBe(25_000_000);
            await target.updateAddonCredit(creditActor.user.uuid!, 37_500_000);

            // Burn the allowance + all credit and a bit beyond, one legit jump.
            await target.incrementUsage(creditActor, 'ai:chat', 1, 70_000_000);

            // A small further expense crosses the 3x-from-zero mark but is still
            // well within (credit + 2x allowance) — it must stay quiet.
            const alarmSpy = vi.spyOn(server.clients.alarm, 'create');
            await target.incrementUsage(creditActor, 'ai:chat', 1, 7_500_000);

            expect(wasOveruseAlarmed(alarmSpy)).toBe(false);
            alarmSpy.mockRestore();
        });

        it('alarms once usage reaches purchased credit + 2x the monthly allowance', async () => {
            const creditActor: Actor = { user: makeUser() };
            const sub = await target.getActorSubscription(creditActor);
            const credit = sub.monthUsageAllowance * 3;
            await target.updateAddonCredit(creditActor.user.uuid!, credit);

            // Consume the allowance + all purchased credit and land one band
            // past the budget in a single jump — legitimate, so no alarm yet.
            await target.incrementUsage(
                creditActor,
                'ai:chat',
                1,
                sub.monthUsageAllowance * 4,
            );

            // The next allowance-sized expense crosses into 2x-past-the-credit
            // and is what should finally page.
            const alarmSpy = vi.spyOn(server.clients.alarm, 'create');
            await target.incrementUsage(
                creditActor,
                'ai:chat',
                1,
                sub.monthUsageAllowance,
            );

            expect(alarmSpy).toHaveBeenCalledWith(
                expect.stringContaining('usage exceeded'),
                expect.stringContaining('exceeded their usage allowance'),
                expect.objectContaining({ purchasedCredits: credit }),
                'warning',
            );
            alarmSpy.mockRestore();
        });
    });

    // ── batchIncrementUsages ─────────────────────────────────────────

    describe('batchIncrementUsages', () => {
        it('aggregates multiple usages into a single actor record', async () => {
            const result = await target.batchIncrementUsages(actor, [
                { usageType: 'kv:read', usageAmount: 2, costOverride: 100 },
                { usageType: 'kv:write', usageAmount: 1, costOverride: 50 },
                { usageType: 'kv:read', usageAmount: 3, costOverride: 30 },
            ]);
            expect(result.total).toBe(180);
            expect(result['kv:read']).toMatchObject({
                cost: 130,
                units: 5,
                count: 2,
            });
            expect(result['kv:write']).toMatchObject({
                cost: 50,
                units: 1,
                count: 1,
            });
        });

        it('returns zero for an empty list', async () => {
            const result = await target.batchIncrementUsages(actor, []);
            expect(result).toEqual({ total: 0 });
        });

        it('returns zero for a system actor and writes nothing', async () => {
            const result = await target.batchIncrementUsages(SYSTEM_ACTOR, [
                { usageType: 'kv:read', usageAmount: 1, costOverride: 100 },
            ]);
            expect(result).toEqual({ total: 0 });
        });

        it('skips items with missing fields but still writes the rest', async () => {
            const result = await target.batchIncrementUsages(actor, [
                { usageType: 'kv:read', usageAmount: 1, costOverride: 10 },
                { usageType: '', usageAmount: 1, costOverride: 999 },
                { usageType: 'kv:write', usageAmount: 0, costOverride: 999 },
                { usageType: 'kv:write', usageAmount: 2, costOverride: 20 },
            ]);
            expect(result.total).toBe(30);
            expect(result['kv:read']).toMatchObject({ count: 1, units: 1 });
            expect(result['kv:write']).toMatchObject({ count: 1, units: 2 });
        });

        it('returns zero and writes nothing when every item is skipped', async () => {
            const incrSpy = vi.spyOn(server.stores.kv, 'incr');
            const result = await target.batchIncrementUsages(actor, [
                { usageType: '', usageAmount: 1, costOverride: 10 },
                { usageType: 'kv:write', usageAmount: 0, costOverride: 20 },
            ]);
            expect(result).toEqual({ total: 0 });
            expect(incrSpy).not.toHaveBeenCalled();
            incrSpy.mockRestore();
        });

        it('raises an alarm for any negative costOverride in the batch', async () => {
            const alarmSpy = vi.spyOn(server.clients.alarm, 'create');
            await target.batchIncrementUsages(actor, [
                { usageType: 'kv:read', usageAmount: 1, costOverride: -7 },
            ]);
            expect(alarmSpy).toHaveBeenCalledWith(
                expect.stringContaining('negative cost'),
                expect.any(String),
                expect.objectContaining({ usageType: 'kv:read' }),
            );
            alarmSpy.mockRestore();
        });
    });

    // ── utilRecordUsageObject ────────────────────────────────────────

    describe('utilRecordUsageObject', () => {
        it('prefixes each usage kind with the modelPrefix and applies overrides', async () => {
            const result = await target.utilRecordUsageObject(
                { prompt_tokens: 100, completion_tokens: 50 },
                actor,
                'gpt-4',
                { prompt_tokens: 1000 },
            );
            expect(result['gpt-4:prompt_tokens']).toMatchObject({
                cost: 1000,
                units: 100,
                count: 1,
            });
            // No override → cost defaults to 0
            expect(result['gpt-4:completion_tokens']).toMatchObject({
                cost: 0,
                units: 50,
                count: 1,
            });
            expect(result.total).toBe(1000);
        });

        it('ignores non-numeric override values', async () => {
            const result = await target.utilRecordUsageObject(
                { prompt_tokens: 1 },
                actor,
                'm',
                { prompt_tokens: Number.NaN },
            );
            expect(result['m:prompt_tokens']).toMatchObject({ cost: 0 });
        });
    });

    // ── getActorCurrentMonthUsageDetails ─────────────────────────────

    describe('getActorCurrentMonthUsageDetails', () => {
        it('returns an empty envelope for a fresh user', async () => {
            const result = await target.getActorCurrentMonthUsageDetails(actor);
            expect(result.usage).toEqual({ total: 0 });
            expect(result.appTotals).toEqual({});
        });

        it('returns the recorded usage and app totals after increments', async () => {
            const userId = actor.user.uuid;
            const appA: Actor = {
                user: { uuid: userId },
                app: { uid: 'A', id: 1 },
            };
            const appB: Actor = {
                user: { uuid: userId },
                app: { uid: 'B', id: 2 },
            };
            await target.incrementUsage(appA, 'kv:read', 1, 100);
            await target.incrementUsage(appB, 'kv:read', 1, 50);

            await waitFor(async () => {
                const r = await target.getActorCurrentMonthUsageDetails({
                    user: { uuid: userId },
                });
                expect(r.appTotals.A?.total).toBe(100);
                expect(r.appTotals.B?.total).toBe(50);
            });

            const result = await target.getActorCurrentMonthUsageDetails({
                user: { uuid: userId },
            });
            expect(result.usage.total).toBe(150);
        });

        it('filters appTotals by actor.app.uid and rolls others into "others"', async () => {
            const userId = actor.user.uuid;
            const appA: Actor = {
                user: { uuid: userId },
                app: { uid: 'A', id: 1 },
            };
            const appB: Actor = {
                user: { uuid: userId },
                app: { uid: 'B', id: 2 },
            };
            await target.incrementUsage(appA, 'kv:read', 1, 100);
            await target.incrementUsage(appB, 'kv:read', 1, 50);

            await waitFor(async () => {
                const r = await target.getActorCurrentMonthUsageDetails(appA);
                expect(r.appTotals.A?.total).toBe(100);
                expect(r.appTotals.others?.total).toBe(50);
                expect(r.appTotals).not.toHaveProperty('B');
            });
        });

        it('rejects an actor with no user uuid', async () => {
            await expect(
                target.getActorCurrentMonthUsageDetails({
                    user: { uuid: '' },
                }),
            ).rejects.toMatchObject({ statusCode: 403 });
        });
    });

    // ── getActorCurrentMonthAppUsageDetails ──────────────────────────

    describe('getActorCurrentMonthAppUsageDetails', () => {
        it('returns the per-app record for an explicit appId', async () => {
            const appActor: Actor = {
                user: makeUser(),
                app: { uid: 'my-app', id: 1 },
            };
            await target.incrementUsage(appActor, 'kv:read', 1, 250);
            await waitFor(async () => {
                const r = await target.getActorCurrentMonthAppUsageDetails(
                    appActor,
                    'my-app',
                );
                expect(r.total).toBe(250);
            });
        });

        it('defaults to the actor app id when none is supplied', async () => {
            const appActor: Actor = {
                user: makeUser(),
                app: { uid: 'my-app', id: 1 },
            };
            await target.incrementUsage(appActor, 'kv:read', 1, 75);
            await waitFor(async () => {
                const r =
                    await target.getActorCurrentMonthAppUsageDetails(appActor);
                expect(r.total).toBe(75);
            });
        });

        it('allows an app actor to query the global namespace', async () => {
            const userOnly: Actor = { user: makeUser() };
            await target.incrementUsage(userOnly, 'kv:read', 1, 60);
            const appActor: Actor = {
                user: userOnly.user,
                app: { uid: 'my-app', id: 1 },
            };
            await waitFor(async () => {
                const r = await target.getActorCurrentMonthAppUsageDetails(
                    appActor,
                    GLOBAL_APP_KEY,
                );
                expect(r.total).toBe(60);
            });
        });

        it('forbids an app actor from querying another app', async () => {
            const appActor: Actor = {
                user: makeUser(),
                app: { uid: 'mine', id: 1 },
            };
            await expect(
                target.getActorCurrentMonthAppUsageDetails(
                    appActor,
                    'someone-else',
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('rejects an actor with no user uuid', async () => {
            await expect(
                target.getActorCurrentMonthAppUsageDetails({
                    user: { uuid: '' },
                }),
            ).rejects.toMatchObject({ statusCode: 403 });
        });
    });

    // ── setActorCurrentMonthUsageTotal ───────────────────────────────

    describe('setActorCurrentMonthUsageTotal', () => {
        it('sets the total via a manual_adjustment delta when no usage exists', async () => {
            const result = await target.setActorCurrentMonthUsageTotal(
                actor,
                500,
            );
            expect(result.total).toBe(500);
            const adj = (result as Record<string, unknown>)
                .manual_adjustment as
                { cost: number; units: number; count: number } | undefined;
            expect(adj).toMatchObject({ cost: 500, units: 500, count: 1 });
        });

        it('applies a delta against an existing total', async () => {
            await target.incrementUsage(actor, 'kv:read', 1, 100);
            const result = await target.setActorCurrentMonthUsageTotal(
                actor,
                300,
            );
            expect(result.total).toBe(300);
        });

        it('is a no-op when delta is zero', async () => {
            await target.incrementUsage(actor, 'kv:read', 1, 100);
            const result = await target.setActorCurrentMonthUsageTotal(
                actor,
                100,
            );
            expect(result.total).toBe(100);
        });

        it('rejects a negative total', async () => {
            await expect(
                target.setActorCurrentMonthUsageTotal(actor, -1),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects a non-finite total', async () => {
            await expect(
                target.setActorCurrentMonthUsageTotal(actor, Number.NaN),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects an actor with no user uuid', async () => {
            await expect(
                target.setActorCurrentMonthUsageTotal(
                    { user: { uuid: '' } },
                    100,
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });
    });

    // ── getActorAppUsage ─────────────────────────────────────────────

    describe('getActorAppUsage', () => {
        it('returns zero for an app the user has no usage in', async () => {
            const result = await target.getActorAppUsage(actor, 'untouched');
            expect(result.total).toBe(0);
        });

        it('forbids an app actor from reading another app', async () => {
            const appActor: Actor = {
                user: makeUser(),
                app: { uid: 'mine', id: 1 },
            };
            await expect(
                target.getActorAppUsage(appActor, 'theirs'),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('rejects an actor with no user uuid', async () => {
            await expect(
                target.getActorAppUsage({ user: { uuid: '' } }, 'app'),
            ).rejects.toMatchObject({ statusCode: 403 });
        });
    });

    // ── allowance / credits ──────────────────────────────────────────

    describe('getRemainingUsage / getAllowedUsage / hasAnyUsage / hasEnoughCredits', () => {
        it('a fresh user has the full subscription allowance remaining', async () => {
            const allowed = await target.getAllowedUsage(actor);
            expect(allowed.remaining).toBe(allowed.monthUsageAllowance);
            expect(allowed.monthUsageAllowance).toBeGreaterThan(0);
            expect(allowed.addons).toEqual({});
        });

        it('subtracts spent usage from remaining', async () => {
            await target.incrementUsage(actor, 'kv:read', 1, 1_000);
            const allowed = await target.getAllowedUsage(actor);
            expect(allowed.remaining).toBe(allowed.monthUsageAllowance - 1_000);
        });

        it('adds purchased credits to remaining', async () => {
            await target.updateAddonCredit(actor.user.uuid!, 5_000);
            const allowed = await target.getAllowedUsage(actor);
            expect(allowed.remaining).toBe(allowed.monthUsageAllowance + 5_000);
        });

        it('clamps remaining at zero when over allowance with no credits', async () => {
            const sub = await target.getActorSubscription(actor);
            await target.incrementUsage(
                actor,
                'kv:read',
                1,
                sub.monthUsageAllowance + 5_000,
            );
            const remaining = await target.getRemainingUsage(actor);
            expect(remaining).toBe(0);
        });

        it('hasAnyUsage tracks remaining', async () => {
            const sub = await target.getActorSubscription(actor);
            expect(await target.hasAnyUsage(actor)).toBe(true);
            await target.incrementUsage(
                actor,
                'kv:read',
                1,
                sub.monthUsageAllowance,
            );
            expect(await target.hasAnyUsage(actor)).toBe(false);
        });

        it('does not double-charge same-month overage against remaining (usage total + consumed credits)', async () => {
            const sub = await target.getActorSubscription(actor);
            await target.updateAddonCredit(actor.user.uuid!, 5_000_000);

            // Exhaust the allowance, then overspend by 1_000_000 — the overage
            // is consumed from purchased credits.
            await target.incrementUsage(
                actor,
                'kv:read',
                1,
                sub.monthUsageAllowance,
            );
            await target.incrementUsage(actor, 'kv:read', 1, 1_000_000);
            await waitFor(async () => {
                const addons = await target.getActorAddons(actor);
                expect(addons.consumedPurchaseCredits).toBe(1_000_000);
            });

            // The overage already lives in both this month's usage total and
            // consumedPurchaseCredits; remaining must only be reduced once.
            const allowed = await target.getAllowedUsage(actor);
            expect(allowed.remaining).toBe(4_000_000);
        });

        it('counts consumed credits from prior months against the credit pool only', async () => {
            // Simulate a prior-month overage: consumed credits exist but the
            // current month has no usage (monthly usage keys roll over).
            await target.updateAddonCredit(actor.user.uuid!, 5_000_000);
            await server.stores.kv.incr({
                key: `${POLICY_PREFIX}:actor:${actor.user.uuid}:addons`,
                pathAndAmountMap: { consumedPurchaseCredits: 2_000_000 },
            });

            const allowed = await target.getAllowedUsage(actor);
            expect(allowed.remaining).toBe(
                allowed.monthUsageAllowance + 3_000_000,
            );
        });

        it('hasEnoughCredits compares remaining against the requested amount', async () => {
            await target.updateAddonCredit(actor.user.uuid!, 1_000);
            expect(await target.hasEnoughCredits(actor, 100)).toBe(true);
            expect(
                await target.hasEnoughCredits(actor, Number.MAX_SAFE_INTEGER),
            ).toBe(false);
        });
    });

    // ── getGlobalUsage ───────────────────────────────────────────────

    describe('getGlobalUsage', () => {
        it('aggregates increments across actors into the same global view', async () => {
            const before = await target.getGlobalUsage();
            const user1: Actor = { user: makeUser() };
            const user2: Actor = { user: makeUser() };
            await target.incrementUsage(user1, 'kv:read', 1, 100);
            await target.incrementUsage(user2, 'kv:read', 1, 200);

            await waitFor(async () => {
                const now = await target.getGlobalUsage();
                expect(now.total - before.total).toBe(300);
                const beforeRead = (before['kv:read']?.cost ?? 0) as number;
                const nowRead = (now['kv:read']?.cost ?? 0) as number;
                expect(nowRead - beforeRead).toBe(300);
            });
        });
    });

    // ── KV layout sanity check ───────────────────────────────────────

    describe('KV layout', () => {
        it('writes the actor monthly record at the expected key shape', async () => {
            await target.incrementUsage(actor, 'kv:read', 1, 100);
            const month = `${new Date().getUTCFullYear()}-${String(
                new Date().getUTCMonth() + 1,
            ).padStart(2, '0')}`;
            const key = `${METRICS_PREFIX}:actor:${actor.user.uuid}:${month}`;
            const { res } = await server.stores.kv.get({ key });
            expect(res).toMatchObject({ total: 100 });
        });

        it('persists addons under the policy prefix', async () => {
            await target.updateAddonCredit(actor.user.uuid!, 250);
            const key = `${POLICY_PREFIX}:actor:${actor.user.uuid}:addons`;
            const { res } = await server.stores.kv.get({ key });
            expect(res).toMatchObject({ purchasedCredits: 250 });
        });
    });

    // ── Resolver registration ────────────────────────────────────────

    describe('resolver registration', () => {
        it('a default resolver that throws does not break subscription resolution', async () => {
            target.registerDefaultSubscriptionResolver(async () => {
                throw new Error('boom');
            });
            const policy = await target.getActorSubscription(actor);
            expect(policy.id).toBe(DEFAULT_FREE_SUBSCRIPTION);
        });
    });
});
