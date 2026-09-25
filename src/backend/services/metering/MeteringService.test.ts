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
import murmurhash from 'murmurhash';
import type { Actor } from '../../core/actor.ts';
import { SYSTEM_ACTOR, makeActor as resolveActor } from '../../core/actor.ts';
import { PuterServer } from '../../server.ts';
import { bucketTag } from '../../stores/metering/MeteringBufferStore.ts';
import { setupTestServer } from '../../testUtil.ts';
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
    GLOBAL_APP_KEY,
    METRICS_PREFIX,
    METRICS_V2_PREFIX,
    OTHER_USAGE_TYPE,
    PERIOD_ESCAPE,
    POLICY_PREFIX,
    USAGE_DETAIL_SHARD_COUNT,
    V1_CLAIM_THROUGH_MONTH,
} from './consts.ts';
import type { MeteringService } from './MeteringService.ts';
import type { UsageInput } from './types.ts';
import { detailShardOf } from './usageDetail.ts';
import { toMicroCents } from './utils.ts';

/** A month whose recurring-charge claim still uses the v1 key. */
const SEPTEMBER_MONTH_ISO = '2026-09-25T12:00:00Z';
/** A month whose claim uses the v2 key like everything else. */
const OCTOBER_MONTH_ISO = '2026-10-15T12:00:00Z';

const escape = (usageType: string) => usageType.replace(/\./g, PERIOD_ESCAPE);

/** `MeteringService`'s own month string — real clock, whatever it is now. */
const currentMonthString = (): string => {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
};

/**
 * How many `incr` calls one buffered write of `types` costs against the
 * actor's own usage item(s): one totals write plus one per distinct detail
 * shard the types hash to.
 */
const usageWriteCalls = (types: string[]): number =>
    1 + new Set(types.map((t) => detailShardOf(t))).size;

/** `MeteringService`'s private `globalUsageKey`, replicated for assertions. */
const globalUsageKeyFor = (
    userId: string,
    appId: string,
    month: string,
    shardCount: number,
): string =>
    `${METRICS_V2_PREFIX}:puter:${murmurhash.v3(`${userId}:${appId}`) % shardCount}:${month}`;

/** `MeteringService`'s private `appUsageKey`, replicated for assertions. */
const appUsageKeyFor = (
    appId: string,
    userId: string,
    month: string,
    shardCount: number,
): string =>
    `${METRICS_V2_PREFIX}:app:${appId}:${murmurhash.v3(`${appId}${userId}`) % shardCount}:${month}`;

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
        pendingAuxPromises: Set<Promise<unknown>>;
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

        // Usage counters accumulate in a buffer that a background loop writes
        // onward. Stop that loop so tests settle it explicitly and never race
        // a cycle firing mid-assertion.
        await server.stores.meteringBuffer.onServerShutdown();
    });

    afterEach(async () => {
        internals.subscriptionResolvers.length = 0;
        internals.subscriptionResolvers.push(...snapshot.subs);
        internals.defaultSubscriptionResolvers.length = 0;
        internals.defaultSubscriptionResolvers.push(...snapshot.defs);
        internals.extraPolicies.length = 0;
        internals.extraPolicies.push(...snapshot.pols);

        // Drain this test's fire-and-forget aux writes so none of them land
        // during the next test's window and get caught by its incr spy.
        await Promise.allSettled([...internals.pendingAuxPromises]);
    });

    afterAll(async () => {
        (target.constructor as typeof MeteringService).GLOBAL_SHARD_COUNT =
            originalShardCount;
        (target.constructor as typeof MeteringService).APP_SHARD_COUNT =
            originalShardCount;
        await server?.shutdown();
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

        // A resolver can name a policy nobody registered — an extension that
        // failed to load, or a plan renamed on one side only. Every caller
        // reads fields straight off the result, so handing back a policy is
        // the difference between a downgrade and a 500 on every gated route.
        it('falls back to a free policy when a resolver names an unregistered plan', async () => {
            target.registerSubscriptionResolver(async () => 'ghost-plan');

            const policy = await target.getActorSubscription(actor);
            expect(policy.id).toBe(DEFAULT_FREE_SUBSCRIPTION);
            expect(policy.monthUsageAllowance).toBeGreaterThan(0);
        });

        it('falls back when the default resolver names one too', async () => {
            target.registerSubscriptionResolver(async () => 'ghost-plan');
            target.registerDefaultSubscriptionResolver(
                async () => 'ghost-default',
            );

            const tempActor: Actor = { user: makeUser({ email: null }) };
            const policy = await target.getActorSubscription(tempActor);
            expect(policy.id).toBe(DEFAULT_TEMP_SUBSCRIPTION);
        });

        // Rate and concurrency gates resolve the subscription on every gated
        // request, and a resolver may reach a remote store to answer. Without
        // the cache, adding a tiered limit to a hot route would add a round
        // trip to that route.
        it('resolves once per actor within the cache window', async () => {
            const stub = vi.fn(async () => null);
            target.registerSubscriptionResolver(stub);

            await target.getActorSubscription(actor);
            await target.getActorSubscription(actor);
            await target.getActorSubscription(actor);

            expect(stub).toHaveBeenCalledTimes(1);
        });

        it('caches per actor, not globally', async () => {
            const other: Actor = { user: makeUser({ email: null }) };
            const stub = vi.fn(async () => null);
            target.registerSubscriptionResolver(stub);

            expect((await target.getActorSubscription(actor)).id).toBe(
                DEFAULT_FREE_SUBSCRIPTION,
            );
            expect((await target.getActorSubscription(other)).id).toBe(
                DEFAULT_TEMP_SUBSCRIPTION,
            );
            expect(stub).toHaveBeenCalledTimes(2);
        });

        it('re-resolves after the entry is invalidated', async () => {
            const stub = vi.fn(async () => null);
            target.registerSubscriptionResolver(stub);

            await target.getActorSubscription(actor);
            expect(stub).toHaveBeenCalledTimes(1);

            // What a purchase or cancellation calls, so a new plan applies
            // to the very next request rather than at the end of the window.
            target.invalidateActorSubscription(actor.user!.uuid as string);

            await target.getActorSubscription(actor);
            expect(stub).toHaveBeenCalledTimes(2);
        });

        it('announces an invalidation so other nodes drop their copy too', async () => {
            const seen = vi.fn();
            server.clients.event.on(
                'outer.pubsub.metering.subscription-changed',
                seen,
            );

            target.invalidateActorSubscription('some-user-uuid');

            // `outer.pubsub.*` is the channel that reaches sibling nodes and
            // peer clusters — a local-only drop would leave every other node
            // serving the old tier until its entry expired.
            expect(seen).toHaveBeenCalledWith(
                'outer.pubsub.metering.subscription-changed',
                { userUuid: 'some-user-uuid' },
                expect.anything(),
            );
            server.clients.event.off(
                'outer.pubsub.metering.subscription-changed',
                seen,
            );
        });

        it('drops its own copy when another node announces a change', async () => {
            const stub = vi.fn(async () => null);
            target.registerSubscriptionResolver(stub);

            await target.getActorSubscription(actor);
            expect(stub).toHaveBeenCalledTimes(1);

            // What arrives on a node that did not handle the purchase.
            server.clients.event.emit(
                'outer.pubsub.metering.subscription-changed',
                { userUuid: actor.user!.uuid as string },
                {},
            );
            await vi.waitFor(async () => {
                await target.getActorSubscription(actor);
                expect(stub).toHaveBeenCalledTimes(2);
            });
        });

        it('re-resolves once the cache window has passed', async () => {
            const stub = vi.fn(async () => null);
            target.registerSubscriptionResolver(stub);

            await target.getActorSubscription(actor);
            const cacheMs = (
                target.constructor as unknown as {
                    SUBSCRIPTION_CACHE_MS: number;
                }
            ).SUBSCRIPTION_CACHE_MS;
            const now = Date.now();
            vi.spyOn(Date, 'now').mockReturnValue(now + cacheMs + 1);
            await target.getActorSubscription(actor);
            vi.mocked(Date.now).mockRestore();

            expect(stub).toHaveBeenCalledTimes(2);
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
                expect.stringContaining(actor.user!.email!),
                expect.objectContaining({ usageType: 'kv:read' }),
                'info',
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
            const appActor: Actor = resolveActor({
                user: makeUser(),
                app: { uid: 'my-app', id: 1 },
            });
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

        it('charges the allowance first and records the split on the month record', async () => {
            const overActor: Actor = { user: makeUser() };
            const sub = await target.getActorSubscription(overActor);
            await target.updateAddonCredit(overActor.user.uuid!, 5_000_000);

            // One increment that straddles the boundary: the allowance part
            // lands in `allowanceUsed`, only the rest draws down credit.
            await target.incrementUsage(
                overActor,
                'kv:read',
                1,
                sub.monthUsageAllowance + 1_000_000,
            );

            await waitFor(async () => {
                const { usage } =
                    await target.getActorCurrentMonthUsageDetails(overActor);
                expect(usage.allowanceUsed).toBe(sub.monthUsageAllowance);
                expect(usage.total).toBe(sub.monthUsageAllowance + 1_000_000);
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
                // The account is named by email — what someone reading the
                // alert needs to look it up.
                expect.stringContaining(overActor.user!.email!),
                expect.stringContaining('exceeded their usage allowance'),
                expect.objectContaining({ totalUsage: expect.any(Number) }),
                // Chat-only severity — records and de-dupes but doesn't page.
                'info',
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
            // The registered-user free allowance is 50e6 micro-cents. Purchased
            // credit of 75e6 (1.5x) makes the full budget run dry at 125e6 —
            // between the 2x (100e6) and 3x (150e6) allowance marks — so a small
            // expense just past it crosses a from-zero multiple (old: pages)
            // without crossing a net-of-credit multiple (new: quiet).
            const creditActor: Actor = { user: makeUser() };
            const sub = await target.getActorSubscription(creditActor);
            expect(sub.monthUsageAllowance).toBe(50_000_000);
            await target.updateAddonCredit(creditActor.user.uuid!, 75_000_000);

            // Burn the allowance + all credit and a bit beyond, one legit jump.
            await target.incrementUsage(creditActor, 'ai:chat', 1, 140_000_000);

            // A small further expense crosses the 3x-from-zero mark but is still
            // well within (credit + 2x allowance) — it must stay quiet.
            const alarmSpy = vi.spyOn(server.clients.alarm, 'create');
            await target.incrementUsage(creditActor, 'ai:chat', 1, 15_000_000);

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
                'info',
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
            const incrSpy = vi.spyOn(server.stores.meteringBuffer, 'incr');
            const auxSpy = vi.spyOn(server.stores.meteringBuffer, 'incrAux');
            const result = await target.batchIncrementUsages(actor, [
                { usageType: '', usageAmount: 1, costOverride: 10 },
                { usageType: 'kv:write', usageAmount: 0, costOverride: 20 },
            ]);
            expect(result).toEqual({ total: 0 });
            expect(incrSpy).not.toHaveBeenCalled();
            expect(auxSpy).not.toHaveBeenCalled();
            incrSpy.mockRestore();
            auxSpy.mockRestore();
        });

        // The per-app aggregate is what an app's developer reads. Usage with no
        // app behind it belongs to nobody there, and writing it anyway costs a
        // record per shard on every increment — which, now that ordinary
        // traffic is metered, is most of them.
        it('writes no per-app aggregate for an actor with no app', async () => {
            const auxSpy = vi.spyOn(server.stores.meteringBuffer, 'incrAux');
            await target.batchIncrementUsages(actor, [
                { usageType: 'egress:bytes', usageAmount: 10, costOverride: 1 },
            ]);
            const keys = auxSpy.mock.calls.map(([input]) => input.key);
            expect(
                keys.some((key) => key.startsWith(`${METRICS_V2_PREFIX}:app:`)),
            ).toBe(false);
            auxSpy.mockRestore();
        });

        it('still writes the per-app aggregate for an app actor', async () => {
            const appActor: Actor = resolveActor({
                ...actor,
                app: { uid: 'batch-app' },
            });
            await target.batchIncrementUsages(appActor, [
                { usageType: 'egress:bytes', usageAmount: 10, costOverride: 1 },
            ]);
            await server.stores.meteringBuffer.flushCycle();

            const ctor = target.constructor as typeof MeteringService;
            const appKey = appUsageKeyFor(
                'batch-app',
                appActor.user!.uuid!,
                currentMonthString(),
                ctor.APP_SHARD_COUNT,
            );
            const { res } = await server.stores.kv.get({ key: appKey });
            expect(res).toMatchObject({ total: expect.any(Number) });
        });

        it('writes the global and per-app aggregates as {total} only, once per call', async () => {
            const appActor: Actor = resolveActor({
                ...actor,
                app: { uid: 'agg-app' },
            });
            const ctor = target.constructor as typeof MeteringService;
            const month = currentMonthString();
            const globalKey = globalUsageKeyFor(
                appActor.user!.uuid!,
                'agg-app',
                month,
                ctor.GLOBAL_SHARD_COUNT,
            );
            const appKey = appUsageKeyFor(
                'agg-app',
                appActor.user!.uuid!,
                month,
                ctor.APP_SHARD_COUNT,
            );

            const auxSpy = vi.spyOn(server.stores.meteringBuffer, 'incrAux');
            await target.incrementUsage(appActor, 'kv:read', 1, 10);
            await server.stores.meteringBuffer.flushCycle();

            const globalCalls = auxSpy.mock.calls.filter(
                ([input]) => input.key === globalKey,
            );
            const appCalls = auxSpy.mock.calls.filter(
                ([input]) => input.key === appKey,
            );
            expect(globalCalls).toHaveLength(1);
            expect(appCalls).toHaveLength(1);
            auxSpy.mockRestore();

            const { res: globalRes } = await server.stores.kv.get({
                key: globalKey,
            });
            const { res: appRes } = await server.stores.kv.get({
                key: appKey,
            });
            // Shared shards accumulate across the whole suite, so only the
            // shape — total only, nothing per-type — is asserted here.
            expect(Object.keys(globalRes as object)).toEqual(['total']);
            expect(Object.keys(appRes as object)).toEqual(['total']);
        });

        it('raises an alarm for any negative costOverride in the batch', async () => {
            const alarmSpy = vi.spyOn(server.clients.alarm, 'create');
            await target.batchIncrementUsages(actor, [
                { usageType: 'kv:read', usageAmount: 1, costOverride: -7 },
            ]);
            expect(alarmSpy).toHaveBeenCalledWith(
                expect.stringContaining('negative cost'),
                expect.stringContaining(actor.user!.email!),
                expect.objectContaining({ usageType: 'kv:read' }),
                'info',
            );
            alarmSpy.mockRestore();
        });
    });

    // ── bufferIncrementUsages ────────────────────────────────────────

    describe('bufferIncrementUsages', () => {
        it('writes nothing until the buffer is flushed', async () => {
            target.bufferIncrementUsages(actor, [
                {
                    usageType: 'egress:bytes',
                    usageAmount: 100,
                    costOverride: 5,
                },
            ]);
            const before = await target.getActorCurrentMonthUsageDetails(actor);
            expect(before.usage.total ?? 0).toBe(0);

            await target.flushBufferedUsages();

            const after = await target.getActorCurrentMonthUsageDetails(actor);
            expect(after.usage.total).toBe(5);
            expect(after.usage[escape('egress:bytes')]).toMatchObject({
                units: 100,
                cost: 5,
            });
        });

        it('collapses an actor’s buffered usage into one write per type', async () => {
            for (let i = 0; i < 5; i++) {
                target.bufferIncrementUsages(actor, [
                    {
                        usageType: 'egress:bytes',
                        usageAmount: 10,
                        costOverride: 2,
                    },
                    {
                        usageType: 'storage:read:ops',
                        usageAmount: 1,
                        costOverride: 1,
                    },
                ]);
            }
            const incrSpy = vi.spyOn(server.stores.meteringBuffer, 'incr');
            await target.flushBufferedUsages();
            // One usage write (pre-cutover) or one totals + per-shard detail
            // write (from the cutover on) for all ten buffered events, plus
            // the settle write that records the allowance/credit split.
            expect(incrSpy).toHaveBeenCalledTimes(
                usageWriteCalls(['egress:bytes', 'storage:read:ops']) + 1,
            );
            incrSpy.mockRestore();

            const { usage } =
                await target.getActorCurrentMonthUsageDetails(actor);
            expect(usage[escape('egress:bytes')]).toMatchObject({
                units: 50,
                cost: 10,
                // One write stands in for all five requests.
                count: 1,
            });
            expect(usage[escape('storage:read:ops')]).toMatchObject({
                units: 5,
                cost: 5,
            });
        });

        it('keeps actors and their apps in separate buckets', async () => {
            const other = makeActor();
            const appActor: Actor = resolveActor({
                ...actor,
                app: { uid: 'app-1' },
            });
            target.bufferIncrementUsages(actor, [
                { usageType: 'egress:bytes', usageAmount: 10, costOverride: 1 },
            ]);
            target.bufferIncrementUsages(appActor, [
                { usageType: 'egress:bytes', usageAmount: 20, costOverride: 2 },
            ]);
            target.bufferIncrementUsages(other, [
                { usageType: 'egress:bytes', usageAmount: 40, costOverride: 4 },
            ]);
            await target.flushBufferedUsages();

            const mine = await target.getActorCurrentMonthUsageDetails(actor);
            const theirs = await target.getActorCurrentMonthUsageDetails(other);
            expect(mine.usage.total).toBe(3);
            expect(theirs.usage.total).toBe(4);
            await waitFor(async () => {
                const appUsage = await target.getActorAppUsage(
                    appActor,
                    'app-1',
                );
                expect(appUsage.total).toBe(2);
            });
        });

        it('ignores the system actor, empty lists, and unusable entries', async () => {
            const incrSpy = vi.spyOn(server.stores.meteringBuffer, 'incr');
            target.bufferIncrementUsages(SYSTEM_ACTOR, [
                { usageType: 'egress:bytes', usageAmount: 1, costOverride: 1 },
            ]);
            target.bufferIncrementUsages(actor, []);
            target.bufferIncrementUsages(actor, [
                { usageType: '', usageAmount: 5, costOverride: 5 },
                { usageType: 'egress:bytes', usageAmount: 0, costOverride: 5 },
            ]);
            await target.flushBufferedUsages();
            expect(incrSpy).not.toHaveBeenCalled();
            incrSpy.mockRestore();
        });

        // A cycle holds a bucket for every actor active in the window. Firing
        // them all into one tick is how a flush becomes a latency spike for
        // everything else on those connections.
        it('paces the writes rather than releasing every bucket at once', async () => {
            const concurrency = (target.constructor as typeof MeteringService)
                .USAGE_FLUSH_CONCURRENCY;
            let inFlight = 0;
            let peak = 0;
            const spy = vi
                .spyOn(server.stores.meteringBuffer, 'incr')
                .mockImplementation(async () => {
                    inFlight++;
                    peak = Math.max(peak, inFlight);
                    await new Promise((resolve) => setTimeout(resolve, 1));
                    inFlight--;
                    return { res: { total: 0 }, exact: false };
                });

            try {
                for (let i = 0; i < concurrency * 3; i++) {
                    target.bufferIncrementUsages(makeActor(), [
                        {
                            usageType: 'egress:bytes',
                            usageAmount: 1,
                            costOverride: 1,
                        },
                    ]);
                }
                await target.flushBufferedUsages();
                // Per bucket: the usage write(s) plus the allowance settle.
                expect(spy).toHaveBeenCalledTimes(
                    concurrency * 3 * (usageWriteCalls(['egress:bytes']) + 1),
                );
                expect(peak).toBeLessThanOrEqual(concurrency);
            } finally {
                spy.mockRestore();
            }
        });

        it('joins a cycle already running instead of stacking another', async () => {
            let started = 0;
            const spy = vi
                .spyOn(server.stores.meteringBuffer, 'incr')
                .mockImplementation(async () => {
                    started++;
                    await new Promise((resolve) => setTimeout(resolve, 20));
                    return { res: { total: 0 }, exact: false };
                });

            try {
                target.bufferIncrementUsages(actor, [
                    {
                        usageType: 'egress:bytes',
                        usageAmount: 1,
                        costOverride: 1,
                    },
                ]);
                await Promise.all([
                    target.flushBufferedUsages(),
                    target.flushBufferedUsages(),
                    target.flushBufferedUsages(),
                ]);
                // One cycle ran (usage write(s) + allowance settle), not three.
                expect(started).toBe(usageWriteCalls(['egress:bytes']) + 1);
            } finally {
                spy.mockRestore();
            }
        });

        it('flushes early once too many actors are buffered', async () => {
            const limit = (target.constructor as typeof MeteringService)
                .USAGE_BUFFER_LIMIT;
            (target.constructor as typeof MeteringService).USAGE_BUFFER_LIMIT =
                2;
            try {
                for (const each of [makeActor(), makeActor()]) {
                    target.bufferIncrementUsages(each, [
                        {
                            usageType: 'egress:bytes',
                            usageAmount: 1,
                            costOverride: 1,
                        },
                    ]);
                }
                await waitFor(() => {
                    expect(
                        (
                            target as unknown as {
                                usageBuffer: Map<string, unknown>;
                            }
                        ).usageBuffer.size,
                    ).toBe(0);
                });
            } finally {
                (
                    target.constructor as typeof MeteringService
                ).USAGE_BUFFER_LIMIT = limit;
            }
        });

        it('drains on prepare-shutdown, while the layers it writes through are up', async () => {
            target.bufferIncrementUsages(actor, [
                {
                    usageType: 'egress:bytes',
                    usageAmount: 4_096,
                    costOverride: 512,
                },
            ]);

            // Prepare runs before any teardown, while connections are still open.
            await target.onServerPrepareShutdown();

            expect(
                (target as unknown as { usageBuffer: Map<string, unknown> })
                    .usageBuffer.size,
            ).toBe(0);
            const { usage } =
                await target.getActorCurrentMonthUsageDetails(actor);
            expect(usage[escape('egress:bytes')]).toMatchObject({
                units: 4_096,
                cost: 512,
            });
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
            const appA: Actor = resolveActor({
                user: { uuid: userId },
                app: { uid: 'A', id: 1 },
            });
            const appB: Actor = resolveActor({
                user: { uuid: userId },
                app: { uid: 'B', id: 2 },
            });
            await target.incrementUsage(appA, 'kv:read', 1, 100);
            await target.incrementUsage(appB, 'kv:read', 1, 50);
            // appTotals is a prefix listing of the persisted store, not the
            // buffer — it only sees an app's total once it has been flushed.
            await server.stores.meteringBuffer.flushCycle();

            const result = await target.getActorCurrentMonthUsageDetails({
                user: { uuid: userId },
            });
            expect(result.usage.total).toBe(150);
            expect(result.appTotals.A?.total).toBe(100);
            expect(result.appTotals.B?.total).toBe(50);
        });

        it('filters appTotals by actor.app.uid and rolls others into "others"', async () => {
            const userId = actor.user.uuid;
            const appA: Actor = resolveActor({
                user: { uuid: userId },
                app: { uid: 'A', id: 1 },
            });
            const appB: Actor = resolveActor({
                user: { uuid: userId },
                app: { uid: 'B', id: 2 },
            });
            await target.incrementUsage(appA, 'kv:read', 1, 100);
            await target.incrementUsage(appB, 'kv:read', 1, 50);
            await server.stores.meteringBuffer.flushCycle();

            const r = await target.getActorCurrentMonthUsageDetails(appA);
            expect(r.appTotals.A?.total).toBe(100);
            expect(r.appTotals.others?.total).toBe(50);
            expect(r.appTotals).not.toHaveProperty('B');
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
            const appActor: Actor = resolveActor({
                user: makeUser(),
                app: { uid: 'my-app', id: 1 },
            });
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
            const appActor: Actor = resolveActor({
                user: makeUser(),
                app: { uid: 'my-app', id: 1 },
            });
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
            const appActor: Actor = resolveActor({
                user: userOnly.user,
                app: { uid: 'my-app', id: 1 },
            });
            await waitFor(async () => {
                const r = await target.getActorCurrentMonthAppUsageDetails(
                    appActor,
                    GLOBAL_APP_KEY,
                );
                expect(r.total).toBe(60);
            });
        });

        it('forbids an app actor from querying another app', async () => {
            const appActor: Actor = resolveActor({
                user: makeUser(),
                app: { uid: 'mine', id: 1 },
            });
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
                | { cost: number; units: number; count: number }
                | undefined;
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

        it('re-anchors allowanceUsed so the adjusted total is what the allowance is billed', async () => {
            const sub = await target.getActorSubscription(actor);
            await target.updateAddonCredit(actor.user.uuid!, 5_000_000);

            // Overspend so the month holds allowance + credit-charged spend.
            await target.incrementUsage(
                actor,
                'kv:read',
                1,
                sub.monthUsageAllowance + 5_000_000,
            );
            expect(await target.getRemainingUsage(actor)).toBe(0);

            // Support sets the month back down: the new total is billed to
            // the allowance in full and the rest of it reopens.
            const result = await target.setActorCurrentMonthUsageTotal(
                actor,
                1_000,
            );
            expect(result.total).toBe(1_000);
            expect(result.allowanceUsed).toBe(1_000);
            expect(await target.getRemainingUsage(actor)).toBe(
                sub.monthUsageAllowance - 1_000,
            );
        });

        it('stays set once the adjustment has been written onward', async () => {
            await target.incrementUsage(actor, 'kv:read', 1, 10_000);
            await server.stores.meteringBuffer.flushCycle();

            await target.setActorCurrentMonthUsageTotal(actor, 0);
            // The adjustment is buffered like any other amount, so the read
            // that matters is the one after it has settled — a correction that
            // only holds until then is a correction nobody keeps.
            await server.stores.meteringBuffer.flushCycle();

            const { usage } =
                await target.getActorCurrentMonthUsageDetails(actor);
            expect(usage.total).toBe(0);
            expect(usage.allowanceUsed).toBe(0);
        });

        it('repairs a cached view that has drifted from the record', async () => {
            await target.incrementUsage(actor, 'kv:read', 1, 10_000);
            await server.stores.meteringBuffer.flushCycle();

            // Whatever the drift came from, re-applying the total the record
            // already holds is the support-facing repair for it, so it has to
            // take even though there is nothing to write.
            const key = `${METRICS_V2_PREFIX}:actor:${actor.user.uuid}:${new Date().toISOString().slice(0, 7)}`;
            await server.clients.redis.hset(
                `meter:b:{${bucketTag(key)}}:${key}`,
                'total',
                '999999',
            );

            await target.setActorCurrentMonthUsageTotal(actor, 10_000);

            const { usage } =
                await target.getActorCurrentMonthUsageDetails(actor);
            expect(usage.total).toBe(10_000);
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
            const appActor: Actor = resolveActor({
                user: makeUser(),
                app: { uid: 'mine', id: 1 },
            });
            await expect(
                target.getActorAppUsage(appActor, 'theirs'),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('rejects an actor with no user uuid', async () => {
            await expect(
                target.getActorAppUsage({ user: { uuid: '' } }, 'app'),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it("never leaks the item's own call count as a top-level field, while appTotals still reports it", async () => {
            const appActor: Actor = resolveActor({
                user: makeUser(),
                app: { uid: 'count-app', id: 1 },
            });
            // Several calls so the actor-app item's own `count` is > 1 and
            // distinguishable from a per-API record's `count`.
            await target.incrementUsage(appActor, 'kv:read', 1, 10);
            await target.incrementUsage(appActor, 'kv:read', 1, 5);
            await target.incrementUsage(appActor, 'kv:write', 1, 3);
            await server.stores.meteringBuffer.flushCycle();

            const appUsage = await target.getActorAppUsage(
                appActor,
                'count-app',
            );
            expect(appUsage.count).toBeUndefined();
            expect(typeof appUsage.total).toBe('number');
            // Every other key is a per-API record, not a bare number.
            for (const [key, value] of Object.entries(appUsage)) {
                if (key === 'total') continue;
                expect(typeof value).toBe('object');
            }

            const detailed =
                await target.getActorCurrentMonthAppUsageDetails(
                    appActor,
                    'count-app',
                );
            expect(detailed.count).toBeUndefined();

            // appTotals reads the same item separately and still has count.
            const { appTotals } =
                await target.getActorCurrentMonthUsageDetails(appActor);
            expect(appTotals['count-app']).toEqual({ total: 18, count: 3 });
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

        it('keeps the allowance and credit pools separate across a mid-month upgrade', async () => {
            const freeSub = await target.getActorSubscription(actor);
            const freeAllowance = freeSub.monthUsageAllowance;
            await target.updateAddonCredit(actor.user.uuid!, 5_000_000);

            // Exhaust the free allowance, then draw 2_000_000 from credit.
            await target.incrementUsage(actor, 'kv:read', 1, freeAllowance);
            await target.incrementUsage(actor, 'kv:read', 1, 2_000_000);
            await waitFor(async () => {
                const addons = await target.getActorAddons(actor);
                expect(addons.consumedPurchaseCredits).toBe(2_000_000);
            });

            // Upgrade mid-month to ten times the allowance. The allowance
            // pool reopens (freeAllowance of 10x used); the credit pool is
            // exactly where it was (2 of 5 consumed).
            const paid = {
                id: 'upgrade-paid',
                monthUsageAllowance: freeAllowance * 10,
                monthlyStorageAllowance: 1024 * 1024 * 1024,
            };
            target.registerPolicy(paid);
            target.registerSubscriptionResolver(async () => 'upgrade-paid');
            target.invalidateActorSubscription(actor.user.uuid!);

            const allowed = await target.getAllowedUsage(actor);
            expect(allowed.remaining).toBe(freeAllowance * 9 + 3_000_000);
            expect(allowed.addons.consumedPurchaseCredits).toBe(2_000_000);

            // Further spend consumes the reopened allowance, not credit.
            await target.incrementUsage(actor, 'kv:read', 1, freeAllowance * 9);
            const addons = await target.getActorAddons(actor);
            expect(addons.consumedPurchaseCredits).toBe(2_000_000);
            expect((await target.getAllowedUsage(actor)).remaining).toBe(
                3_000_000,
            );

            // Only once the new allowance is full does credit drain again.
            await target.incrementUsage(actor, 'kv:read', 1, 1_000_000);
            await waitFor(async () => {
                const after = await target.getActorAddons(actor);
                expect(after.consumedPurchaseCredits).toBe(3_000_000);
            });
        });

        it('falls back to the pre-split reading for month records without allowanceUsed', async () => {
            const sub = await target.getActorSubscription(actor);
            await target.updateAddonCredit(actor.user.uuid!, 5_000_000);
            await server.stores.kv.incr({
                key: `${POLICY_PREFIX}:actor:${actor.user.uuid}:addons`,
                pathAndAmountMap: { consumedPurchaseCredits: 5_000_000 },
            });

            // A legacy month record: total spans allowance + credit overage,
            // no allowanceUsed split recorded.
            const month = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;
            await server.stores.meteringBuffer.incr({
                key: `${METRICS_V2_PREFIX}:actor:${actor.user.uuid}:${month}`,
                pathAndAmountMap: {
                    total: sub.monthUsageAllowance + 5_000_000,
                },
            });

            // Pre-split behavior: the whole total counts against the
            // allowance (capped at it), so nothing changes at the deploy
            // that introduced the field.
            const allowed = await target.getAllowedUsage(actor);
            expect(allowed.remaining).toBe(0);
        });

        it('never trusts a stored allowanceUsed past the month total', async () => {
            const sub = await target.getActorSubscription(actor);
            const month = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;

            // A corrupt record: allowanceUsed grew past the total (a raced
            // or repeated write). The split is bookkeeping over the total,
            // so the total is the most the allowance can have been charged.
            await server.stores.meteringBuffer.incr({
                key: `${METRICS_V2_PREFIX}:actor:${actor.user.uuid}:${month}`,
                pathAndAmountMap: {
                    total: 1_000_000,
                    allowanceUsed: sub.monthUsageAllowance + 99_000_000,
                },
            });

            const allowed = await target.getAllowedUsage(actor);
            expect(allowed.remaining).toBe(sub.monthUsageAllowance - 1_000_000);
        });

        it('folds the legacy baseline in exactly once under concurrent increments', async () => {
            const sub = await target.getActorSubscription(actor);
            const month = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;

            // Legacy spend with no split recorded — one page load then fires
            // many metered requests at once, all seeing the field absent.
            await server.stores.meteringBuffer.incr({
                key: `${METRICS_V2_PREFIX}:actor:${actor.user.uuid}:${month}`,
                pathAndAmountMap: { total: 10_000 },
            });

            await Promise.all(
                Array.from({ length: 8 }, () =>
                    target.incrementUsage(actor, 'kv:read', 1, 1_000),
                ),
            );

            const { usage } =
                await target.getActorCurrentMonthUsageDetails(actor);
            expect(usage.total).toBe(18_000);
            // Without the claim, every concurrent settle re-adds the ~10_000
            // baseline and the month reads as nearly exhausted.
            expect(usage.allowanceUsed).toBe(18_000);
            const allowed = await target.getAllowedUsage(actor);
            expect(allowed.remaining).toBe(sub.monthUsageAllowance - 18_000);
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

        it('reads only the actor month key, not the per-app breakdown', async () => {
            const getSpy = vi.spyOn(server.stores.meteringBuffer, 'get');
            await target.getAllowedUsage(actor);

            expect(getSpy).toHaveBeenCalledTimes(1);
            const [{ key: calledKey }] = getSpy.mock.calls[0]!;
            const month = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;
            expect(calledKey).toBe(
                `${METRICS_V2_PREFIX}:actor:${actor.user.uuid}:${month}`,
            );
            getSpy.mockRestore();
        });
    });

    // ── hasAnyUsageCached ────────────────────────────────────────────

    describe('hasAnyUsageCached', () => {
        type CreditCache = Map<
            string,
            { hasCredits: boolean; expiresAt: number }
        >;
        const creditCache = () =>
            (target as unknown as { creditCache: CreditCache }).creditCache;
        const creditRefreshes = () =>
            (
                target as unknown as {
                    creditRefreshes: Map<string, Promise<void>>;
                }
            ).creditRefreshes;

        it('answers the same as hasAnyUsage', async () => {
            const sub = await target.getActorSubscription(actor);
            expect(await target.hasAnyUsageCached(actor)).toBe(true);

            await target.incrementUsage(
                actor,
                'kv:read',
                1,
                sub.monthUsageAllowance,
            );
            expect(await target.hasAnyUsageCached(actor)).toBe(false);
        });

        it('is answered by the increment that spent the budget, without a read of its own', async () => {
            const sub = await target.getActorSubscription(actor);
            // Nothing has asked about this actor yet, so the only thing that
            // can have filled the cache is the increment itself.
            expect(creditCache().has(actor.user.uuid!)).toBe(false);

            await target.incrementUsage(
                actor,
                'kv:read',
                1,
                sub.monthUsageAllowance,
            );

            const entry = creditCache().get(actor.user.uuid!);
            expect(entry?.hasCredits).toBe(false);

            const usageSpy = vi.spyOn(target, 'getActorAddons');
            expect(await target.hasAnyUsageCached(actor)).toBe(false);
            expect(usageSpy).not.toHaveBeenCalled();
            usageSpy.mockRestore();
        });

        it('serves a stale answer and replaces it behind the request', async () => {
            expect(await target.hasAnyUsageCached(actor)).toBe(true);

            const sub = await target.getActorSubscription(actor);
            await server.stores.meteringBuffer.incr({
                key: `${METRICS_V2_PREFIX}:actor:${actor.user.uuid}:${new Date().toISOString().slice(0, 7)}`,
                pathAndAmountMap: { total: sub.monthUsageAllowance },
            });

            const entry = creditCache().get(actor.user.uuid!)!;
            entry.expiresAt = Date.now() - 1;

            // The stale answer is what this call returns...
            expect(await target.hasAnyUsageCached(actor)).toBe(true);
            // ...and the refresh it kicked off is what the next one sees.
            await creditRefreshes().get(actor.user.uuid!);
            expect(await target.hasAnyUsageCached(actor)).toBe(false);
        });

        it('shares one refresh across concurrent callers with nothing cached', async () => {
            expect(creditCache().has(actor.user.uuid!)).toBe(false);

            const addonsSpy = vi.spyOn(target, 'getActorAddons');
            const answers = await Promise.all(
                Array.from({ length: 8 }, () =>
                    target.hasAnyUsageCached(actor),
                ),
            );

            expect(answers).toEqual(Array(8).fill(true));
            // Without single-flight this is one read per caller — the cache is
            // empty until the first refresh resolves, so every one of them
            // misses.
            expect(addonsSpy).toHaveBeenCalledTimes(1);
            expect(creditRefreshes().size).toBe(0);
            addonsSpy.mockRestore();
        });

        it('drops the cached answer when credit is added', async () => {
            const sub = await target.getActorSubscription(actor);
            await target.incrementUsage(
                actor,
                'kv:read',
                1,
                sub.monthUsageAllowance,
            );
            expect(await target.hasAnyUsageCached(actor)).toBe(false);

            await target.updateAddonCredit(actor.user.uuid!, 5_000);
            expect(await target.hasAnyUsageCached(actor)).toBe(true);
        });

        it('drops the cached answer when the subscription changes', async () => {
            expect(await target.hasAnyUsageCached(actor)).toBe(true);
            expect(creditCache().has(actor.user.uuid!)).toBe(true);

            target.invalidateActorSubscription(actor.user.uuid!);
            expect(creditCache().has(actor.user.uuid!)).toBe(false);
        });

        it('treats a policy with no metered allowance as never out of budget', async () => {
            target.registerPolicy({
                id: 'test-unmetered',
                monthUsageAllowance: 0,
                monthlyStorageAllowance: 0,
            } as never);
            target.registerSubscriptionResolver(() => 'test-unmetered');
            target.invalidateActorSubscription(actor.user.uuid!);

            const addonsSpy = vi.spyOn(target, 'getActorAddons');
            expect(await target.hasAnyUsageCached(actor)).toBe(true);
            // An unmetered policy has nothing to run out of, so the reads that
            // would answer the question are never made.
            expect(addonsSpy).not.toHaveBeenCalled();
            addonsSpy.mockRestore();
        });

        it('does not block when the balance cannot be read', async () => {
            const failing = vi
                .spyOn(target, 'getActorAddons')
                .mockRejectedValue(new Error('store down'));
            expect(await target.hasAnyUsageCached(actor)).toBe(true);
            failing.mockRestore();
        });

        it('has no answer to give for an actor with no user', async () => {
            expect(await target.hasAnyUsageCached({ user: {} } as Actor)).toBe(
                true,
            );
        });
    });

    // ── getGlobalUsage ───────────────────────────────────────────────

    describe('getGlobalUsage', () => {
        // The global view is read straight from the store, and aggregate
        // counters are written onward a cycle at a time. Flush until the view
        // stops moving so a baseline isn't polluted by usage other tests left
        // buffered.
        const settledGlobalUsage = async () => {
            let previous = Number.NaN;
            for (let attempt = 0; attempt < 20; attempt++) {
                await server.stores.meteringBuffer.flushCycle();
                const usage = await target.getGlobalUsage();
                if (usage.total === previous) return usage;
                previous = usage.total;
            }
            throw new Error('global usage never settled');
        };

        it('aggregates increments across actors into the same global view', async () => {
            const before = await settledGlobalUsage();
            const user1: Actor = { user: makeUser() };
            const user2: Actor = { user: makeUser() };
            await target.incrementUsage(user1, 'kv:read', 1, 100);
            await target.incrementUsage(user2, 'kv:read', 1, 200);

            const now = await settledGlobalUsage();
            expect(now.total - before.total).toBe(300);
        });

        it('returns total only, with no per-model breakdown', async () => {
            const user1: Actor = { user: makeUser() };
            await target.incrementUsage(user1, 'kv:read', 1, 100);

            const usage = await settledGlobalUsage();

            expect(typeof usage.total).toBe('number');
            expect(Object.keys(usage)).toEqual(['total']);
        });
    });

    // ── KV layout sanity check ───────────────────────────────────────

    describe('KV layout', () => {
        it('writes the actor monthly record at the expected key shape', async () => {
            await target.incrementUsage(actor, 'kv:read', 1, 100);
            // Counters are written onward a cycle at a time, so settle first
            // and then assert where the data actually landed.
            await server.stores.meteringBuffer.flushCycle();
            const month = `${new Date().getUTCFullYear()}-${String(
                new Date().getUTCMonth() + 1,
            ).padStart(2, '0')}`;
            const key = `${METRICS_V2_PREFIX}:actor:${actor.user.uuid}:${month}`;
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

    // ── Buffered counters ────────────────────────────────────────────

    describe('buffered usage counters', () => {
        const actorKey = (usageActor: Actor) => {
            const now = new Date();
            const month = `${now.getUTCFullYear()}-${String(
                now.getUTCMonth() + 1,
            ).padStart(2, '0')}`;
            return `${METRICS_V2_PREFIX}:actor:${usageActor.user!.uuid}:${month}`;
        };

        it('accumulates a running total without a write per call', async () => {
            const bufActor: Actor = { user: makeUser() };
            const key = actorKey(bufActor);

            const first = await target.incrementUsage(
                bufActor,
                'ai:chat',
                1,
                100,
            );
            const second = await target.incrementUsage(
                bufActor,
                'ai:chat',
                1,
                150,
            );

            expect(first.total).toBe(100);
            expect(second.total).toBe(250);
            // Nothing recorded yet — the flush loop is the only writer.
            const { res: beforeFlush } = await server.stores.kv.get({ key });
            expect(beforeFlush).toBeNull();

            await server.stores.meteringBuffer.flushCycle();
            const { res: afterFlush } = await server.stores.kv.get({ key });
            expect(afterFlush).toMatchObject({ total: 250 });
        });

        it('takes an exact reading once usage approaches the allowance', async () => {
            const bufActor: Actor = { user: makeUser() };
            const key = actorKey(bufActor);
            const allowance = (await target.getActorSubscription(bufActor))
                .monthUsageAllowance;

            await target.incrementUsage(
                bufActor,
                'ai:chat',
                1,
                Math.round(allowance * 0.85),
            );
            await server.stores.meteringBuffer.flushCycle();

            // Usage recorded elsewhere for the same account, which this
            // deployment's buffered view has no way to know about.
            const elsewhere = Math.round(allowance * 0.45);
            await server.stores.kv.incr({
                key,
                pathAndAmountMap: { total: elsewhere },
            });

            const step = Math.round(allowance * 0.06);
            const usage = await target.incrementUsage(
                bufActor,
                'ai:chat',
                1,
                step,
            );

            expect(usage.total).toBe(
                Math.round(allowance * 0.85) + elsewhere + step,
            );
        });

        it('stays with the buffered total while far from the allowance', async () => {
            const bufActor: Actor = { user: makeUser() };
            const key = actorKey(bufActor);
            const allowance = (await target.getActorSubscription(bufActor))
                .monthUsageAllowance;
            const started = Math.round(allowance * 0.1);

            await target.incrementUsage(bufActor, 'ai:chat', 1, started);
            await server.stores.meteringBuffer.flushCycle();

            await server.stores.kv.incr({
                key,
                pathAndAmountMap: { total: Math.round(allowance * 0.45) },
            });

            const usage = await target.incrementUsage(
                bufActor,
                'ai:chat',
                1,
                5,
            );

            // Well inside the allowance the decision is the same either way,
            // so this deliberately does not pay for an exact reading.
            expect(usage.total).toBe(started + 5);
        });

        it('still reads exact once the allowance already reads as used up', async () => {
            // The approximate view is only a lower bound — it can never prove
            // headroom is zero on its own, so a near-allowance decision must
            // never skip the exact read just because it already looks spent.
            const bufActor: Actor = { user: makeUser() };
            const allowance = (await target.getActorSubscription(bufActor))
                .monthUsageAllowance;

            await target.incrementUsage(bufActor, 'ai:chat', 1, allowance);
            await server.stores.meteringBuffer.flushCycle();

            const readExactSpy = vi.spyOn(
                server.stores.meteringBuffer,
                'readExact',
            );
            await target.incrementUsage(bufActor, 'ai:chat', 1, 100);

            expect(readExactSpy).toHaveBeenCalled();
            readExactSpy.mockRestore();
        });

        it('charges a downward correction to the allowance, not credits, once a credits-changed event lands', async () => {
            // Reproduces a real bug: a stale cached base left over from before
            // a downward correction (made elsewhere, on another node) routed
            // spend to purchased credit instead of the allowance the
            // correction just freed up.
            const bufActor: Actor = { user: makeUser() };
            const paid = {
                id: 'force-exact-paid',
                monthUsageAllowance: 50_000_000,
                monthlyStorageAllowance: 1024 * 1024 * 1024,
            };
            target.registerPolicy(paid);
            target.registerSubscriptionResolver(async () => 'force-exact-paid');

            // Reaches the full allowance — this node's cached base now holds
            // total/allowanceUsed at 50,000,000.
            await target.incrementUsage(
                bufActor,
                'ai:chat',
                1,
                paid.monthUsageAllowance,
            );
            await server.stores.meteringBuffer.flushCycle();

            // A correction lands elsewhere — a plain overwrite of the stored
            // record, bypassing this node's buffer entirely, the way another
            // deployment's write would.
            const month = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;
            const monthKey = `${METRICS_V2_PREFIX}:actor:${bufActor.user!.uuid}:${month}`;
            await server.stores.kv.set({
                key: monthKey,
                value: { total: 25_000_000, allowanceUsed: 25_000_000 },
            });

            // The correction's own node announces it; this node's listener is
            // what a cross-node broadcast would also reach.
            target.invalidateActorCredits(bufActor.user!.uuid!);

            const usage = await target.incrementUsage(
                bufActor,
                'ai:chat',
                1,
                10_000,
            );

            // `usage` is read before the settle's own allowanceUsed write —
            // the settle's answer is what confirms the split, and the
            // absence of any consumed credit confirms it landed on the
            // allowance rather than the purchased-credit pool.
            expect(usage.total).toBe(25_010_000);
            const addons = await target.getActorAddons(bufActor);
            expect(addons.consumedPurchaseCredits ?? 0).toBe(0);

            const settled =
                await target.getActorCurrentMonthUsageDetails(bufActor);
            expect(settled.usage.allowanceUsed).toBe(25_010_000);
        });

        it('still throttles repeated exact reads within a second outside a force-exact window', async () => {
            // A real interval, not a fake clock — widened well past what this
            // test could plausibly take, so it isn't flaky under load.
            const ctor = target.constructor as typeof MeteringService;
            const originalInterval = ctor.EXACT_READ_MIN_INTERVAL_MS;
            ctor.EXACT_READ_MIN_INTERVAL_MS = 60_000;
            try {
                const bufActor: Actor = { user: makeUser() };
                const allowance = (
                    await target.getActorSubscription(bufActor)
                ).monthUsageAllowance;

                // Already near the allowance — every further call re-triggers
                // the near-allowance check, and the first one already read
                // exact once (stamping the throttle).
                const firstSpend = Math.round(allowance * 0.95);
                await target.incrementUsage(bufActor, 'ai:chat', 1, firstSpend);
                await server.stores.meteringBuffer.flushCycle();

                const month = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;
                const monthKey = `${METRICS_V2_PREFIX}:actor:${bufActor.user!.uuid}:${month}`;
                // Written directly to the store, out of band — a strong read
                // would see it; the throttled buffered view can't.
                await server.stores.kv.incr({
                    key: monthKey,
                    pathAndAmountMap: { total: 1_000_000 },
                });

                const usage = await target.incrementUsage(
                    bufActor,
                    'ai:chat',
                    1,
                    100,
                );
                expect(usage.total).toBe(firstSpend + 100);
            } finally {
                ctor.EXACT_READ_MIN_INTERVAL_MS = originalInterval;
            }
        });
    });

    // ── Monthly recurring charges ────────────────────────────────────

    describe('monthly recurring charges', () => {
        type ChargeEvent = { charges: UsageInput[]; month: string };
        type ChargeListener = (
            key: unknown,
            data: ChargeEvent,
        ) => void | Promise<void>;

        const monthKey = (chargeActor: Actor) => {
            const now = new Date();
            const month = `${now.getUTCFullYear()}-${String(
                now.getUTCMonth() + 1,
            ).padStart(2, '0')}`;
            // The claim shim: September (and earlier) still claims on the v1
            // key; later months claim on v2 like everything else.
            const prefix =
                month <= V1_CLAIM_THROUGH_MONTH
                    ? METRICS_PREFIX
                    : METRICS_V2_PREFIX;
            return `${prefix}:actor:${chargeActor.user!.uuid}:${month}`;
        };

        const claimOf = async (chargeActor: Actor) => {
            const { res } = await server.stores.kv.get({
                key: monthKey(chargeActor),
            });
            return (res as { monthlyChargesApplied?: number } | null)
                ?.monthlyChargesApplied;
        };

        // Every deployment settles a month once and then remembers it; a
        // second deployment (or this one after a restart) starts with an empty
        // memory and has to ask the KV store.
        const forgetSettled = () =>
            (
                target as unknown as { settledActors: Set<string> }
            ).settledActors.clear();

        const registered: ChargeListener[] = [];
        const listen = (fn: ChargeListener) => {
            server.clients.event.on(
                'metering.monthly.charges',
                fn as Parameters<typeof server.clients.event.on>[1],
            );
            registered.push(fn);
            return fn;
        };
        const chargeOnce = (cost: number) =>
            listen(
                vi.fn((_key, data: ChargeEvent) => {
                    data.charges.push({
                        usageType: 'workers:monthly',
                        usageAmount: 1,
                        costOverride: cost,
                    });
                }),
            );

        afterEach(() => {
            for (const fn of registered) {
                server.clients.event.off(
                    'metering.monthly.charges',
                    fn as Parameters<typeof server.clients.event.off>[1],
                );
            }
            registered.length = 0;
        });

        it('applies a listener charge on the first write and returns it in the total', async () => {
            const listener = chargeOnce(700);

            const usage = await target.incrementUsage(actor, 'kv:read', 1, 100);

            expect(listener).toHaveBeenCalledTimes(1);
            expect(usage.total).toBe(800);
            expect(usage['workers:monthly']).toMatchObject({
                cost: 700,
                units: 1,
                count: 1,
            });
        });

        it('applies the charge on a read when the read comes first', async () => {
            chargeOnce(500);

            const { usage } =
                await target.getActorCurrentMonthUsageDetails(actor);

            expect(usage.total).toBe(500);
        });

        it('charges once per month however many calls follow', async () => {
            const listener = chargeOnce(400);

            await target.incrementUsage(actor, 'kv:read', 1, 10);
            await target.incrementUsage(actor, 'kv:read', 1, 10);
            const usage = await target.getActorCurrentMonthUsageDetails(actor);

            expect(listener).toHaveBeenCalledTimes(1);
            expect(usage.usage.total).toBe(420);
        });

        it('charges once when several calls race for the same actor', async () => {
            const listener = chargeOnce(300);

            await Promise.all(
                Array.from({ length: 8 }, () =>
                    target.incrementUsage(actor, 'kv:read', 1, 10),
                ),
            );

            expect(listener).toHaveBeenCalledTimes(1);
            expect(await claimOf(actor)).toBe(1);
        });

        it('does not charge again for a month another deployment already claimed', async () => {
            // Settle a buffered view first, so the claim the other deployment
            // takes next is one this one genuinely cannot see.
            await target.incrementUsage(actor, 'kv:read', 1, 10);
            await server.stores.meteringBuffer.flushCycle();
            await server.stores.kv.incr({
                key: monthKey(actor),
                pathAndAmountMap: { monthlyChargesApplied: 1 },
            });

            const listener = chargeOnce(900);
            const usage = await target.incrementUsage(actor, 'kv:read', 1, 50);

            expect(listener).not.toHaveBeenCalled();
            expect(usage.total).toBe(60);
            // The claim counts every attempt, so the loser is visible as 2.
            expect(await claimOf(actor)).toBe(2);
        });

        it('skips the claim entirely when nothing is listening', async () => {
            await target.incrementUsage(actor, 'kv:read', 1, 100);
            await server.stores.meteringBuffer.flushCycle();

            expect(await claimOf(actor)).toBeUndefined();
        });

        it('leaves the month settled when a listener throws, and the call still succeeds', async () => {
            const listener = listen(
                vi.fn(() => {
                    throw new Error('pricing lookup failed');
                }),
            );

            const usage = await target.incrementUsage(actor, 'kv:read', 1, 100);
            forgetSettled();
            await target.incrementUsage(actor, 'kv:read', 1, 100);

            expect(usage.total).toBe(100);
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('retries on the next call when the claim write fails', async () => {
            const listener = chargeOnce(600);
            const incr = vi
                .spyOn(server.stores.kv, 'incr')
                .mockRejectedValueOnce(new Error('kv unavailable'));

            const first = await target.incrementUsage(actor, 'kv:read', 1, 100);
            expect(listener).not.toHaveBeenCalled();
            expect(first.total).toBe(100);

            incr.mockRestore();
            const second = await target.incrementUsage(
                actor,
                'kv:read',
                1,
                100,
            );

            expect(listener).toHaveBeenCalledTimes(1);
            expect(second.total).toBe(800);
        });

        // An actor with usage earlier in the month has a buffered view already
        // built, and a claim written straight to the KV store does not show up
        // in it until the next flush. That is the window where re-entry has
        // nothing but the in-flight guard to stop it, so these start there.
        const warmBufferedView = async () => {
            await target.incrementUsage(actor, 'kv:read', 1, 10);
            await server.stores.meteringBuffer.flushCycle();
        };

        it('charges once when the listener meters through the service itself', async () => {
            await warmBufferedView();
            const listener = listen(
                vi.fn(async () => {
                    await target.incrementUsage(
                        actor,
                        'workers:monthly',
                        1,
                        20,
                    );
                }),
            );

            const usage = await target.incrementUsage(actor, 'kv:read', 1, 100);

            expect(listener).toHaveBeenCalledTimes(1);
            expect(await claimOf(actor)).toBe(1);
            // Metering itself rather than pushing onto `charges` means the
            // cost lands on the record but misses the total this call already
            // computed — visible from the next read on.
            expect(usage.total).toBe(110);
            const after = await target.getActorCurrentMonthUsageDetails(actor);
            expect(after.usage.total).toBe(130);
        });

        it('charges once even if the settled memory is dropped mid-claim', async () => {
            // The memo is capped and cleared wholesale when it fills, which can
            // land in the window where a listener is still running.
            await warmBufferedView();
            const listener = listen(
                vi.fn(async (_key, data: ChargeEvent) => {
                    forgetSettled();
                    await target.incrementUsage(actor, 'kv:read', 1, 5);
                    data.charges.push({
                        usageType: 'workers:monthly',
                        usageAmount: 1,
                        costOverride: 200,
                    });
                }),
            );

            const usage = await target.incrementUsage(actor, 'kv:read', 1, 100);

            expect(listener).toHaveBeenCalledTimes(1);
            expect(usage.total).toBe(315);
            expect(await claimOf(actor)).toBe(1);
        });

        it('merges every listener into one amount map and one increment', async () => {
            listen(
                vi.fn((_key, data: ChargeEvent) => {
                    data.charges.push(
                        {
                            usageType: 'workers:monthly',
                            usageAmount: 3,
                            costOverride: 300,
                        },
                        {
                            usageType: 'domains:monthly',
                            usageAmount: 1,
                            costOverride: 100,
                        },
                    );
                }),
            );
            listen(
                vi.fn((_key, data: ChargeEvent) => {
                    data.charges.push({
                        usageType: 'workers:monthly',
                        usageAmount: 2,
                        costOverride: 200,
                    });
                }),
            );

            const incr = vi.spyOn(server.stores.meteringBuffer, 'incr');
            const usage = await target.getActorCurrentMonthUsageDetails(actor);

            // Four charges across two listeners fold into one totals write
            // plus one per distinct detail shard; the extra call is the
            // allowance settle.
            expect(incr).toHaveBeenCalledTimes(
                usageWriteCalls(['workers:monthly', 'domains:monthly']) + 1,
            );
            incr.mockRestore();

            // The decoded result is the same either way — this is the
            // invariant the layout split must never break.
            expect(usage.usage.total).toBe(600);
            expect(usage.usage[escape('workers:monthly')]).toMatchObject({
                units: 5,
                cost: 500,
                count: 2,
            });
            expect(usage.usage[escape('domains:monthly')]).toMatchObject({
                units: 1,
                cost: 100,
                count: 1,
            });
        });

        it('bills the user, not the app that happened to trigger it', async () => {
            chargeOnce(700);
            const appActor: Actor = resolveActor({
                ...actor,
                app: { uid: 'app-abc' },
            });

            await target.incrementUsage(appActor, 'kv:read', 1, 50);
            await server.stores.meteringBuffer.flushCycle();

            // The app wears only what it actually spent...
            const appUsage = await target.getActorCurrentMonthAppUsageDetails(
                appActor,
                'app-abc',
            );
            expect(appUsage.total).toBe(50);
            // ...while the recurring charge sits in the user's own bucket.
            const global = await target.getActorCurrentMonthAppUsageDetails(
                actor,
                GLOBAL_APP_KEY,
            );
            expect(global.total).toBe(700);

            const { usage } =
                await target.getActorCurrentMonthUsageDetails(actor);
            expect(usage.total).toBe(750);
        });

        it('charges the user once across several of their apps', async () => {
            const listener = chargeOnce(800);

            await target.incrementUsage(
                resolveActor({ ...actor, app: { uid: 'app-one' } }),
                'kv:read',
                1,
                10,
            );
            await target.incrementUsage(
                resolveActor({ ...actor, app: { uid: 'app-two' } }),
                'kv:read',
                1,
                10,
            );

            expect(listener).toHaveBeenCalledTimes(1);
            expect(await claimOf(actor)).toBe(1);
        });

        it('hands listeners a user-scoped actor', async () => {
            let seen: Actor | undefined;
            listen(
                vi.fn((_key, data: ChargeEvent & { actor: Actor }) => {
                    seen = data.actor;
                }),
            );

            await target.incrementUsage(
                resolveActor({ ...actor, app: { uid: 'app-abc' } }),
                'kv:read',
                1,
                10,
            );

            expect(seen?.user.uuid).toBe(actor.user.uuid);
            expect(seen?.app).toBeUndefined();
        });

        it('ignores charges a listener pushed with no usage type', async () => {
            listen(
                vi.fn((_key, data: ChargeEvent) => {
                    data.charges.push({
                        usageType: '',
                        usageAmount: 1,
                        costOverride: 100,
                    });
                }),
            );

            const usage = await target.incrementUsage(actor, 'kv:read', 1, 50);

            expect(usage.total).toBe(50);
            expect(await claimOf(actor)).toBe(1);
        });

        // The v1 → v2 claim shim: September's claim stays on the v1 key so a
        // user already charged before the switch is never charged twice, and
        // every month after reads the claim off the v2 totals record like
        // everything else.
        describe('v1 → v2 claim shim', () => {
            beforeEach(() => {
                vi.useFakeTimers({ toFake: ['Date'] });
            });
            afterEach(() => {
                vi.useRealTimers();
            });

            it('does not charge again a user whose v1 September key already claimed', async () => {
                vi.setSystemTime(SEPTEMBER_MONTH_ISO);
                const septActor = makeActor();
                await server.stores.kv.incr({
                    key: monthKey(septActor),
                    pathAndAmountMap: { monthlyChargesApplied: 1 },
                });

                const listener = chargeOnce(999);
                const usage = await target.incrementUsage(
                    septActor,
                    'kv:read',
                    1,
                    10,
                );

                expect(listener).not.toHaveBeenCalled();
                expect(usage.total).toBe(10);
                // The claim counts every attempt, so a pre-existing claim of
                // 1 reads back as 2 once this call's own attempt lands.
                expect(await claimOf(septActor)).toBe(2);
            });

            it('charges a user with no v1 September claim exactly once', async () => {
                vi.setSystemTime(SEPTEMBER_MONTH_ISO);
                const septActor = makeActor();
                const listener = chargeOnce(500);

                const first = await target.incrementUsage(
                    septActor,
                    'kv:read',
                    1,
                    10,
                );
                expect(listener).toHaveBeenCalledTimes(1);
                expect(first.total).toBe(510);

                // Simulates another node (or this one restarted): no memory
                // of the claim, so it has to ask the v1 key again — and must
                // still see it as already settled rather than charge again.
                forgetSettled();
                const second = await target.incrementUsage(
                    septActor,
                    'kv:read',
                    1,
                    10,
                );
                expect(listener).toHaveBeenCalledTimes(1);
                expect(second.total).toBe(520);
                // Every attempt bumps the v1 counter, win or lose, so the
                // second (losing) attempt reads back as 2.
                expect(await claimOf(septActor)).toBe(2);
            });

            it('claims on the v2 key in October and charges exactly once', async () => {
                vi.setSystemTime(OCTOBER_MONTH_ISO);
                const octActor = makeActor();
                const listener = chargeOnce(500);

                const first = await target.incrementUsage(
                    octActor,
                    'kv:read',
                    1,
                    10,
                );
                expect(listener).toHaveBeenCalledTimes(1);
                expect(first.total).toBe(510);

                const second = await target.incrementUsage(
                    octActor,
                    'kv:read',
                    1,
                    10,
                );
                expect(listener).toHaveBeenCalledTimes(1);
                expect(second.total).toBe(520);

                const v2Key = `${METRICS_V2_PREFIX}:actor:${octActor.user!.uuid}:2026-10`;
                const { res: v2Record } = await server.stores.kv.get({
                    key: v2Key,
                });
                expect(
                    (v2Record as { monthlyChargesApplied?: number } | null)
                        ?.monthlyChargesApplied,
                ).toBe(1);

                // Nothing this month ever touches the v1 key.
                const v1Key = `${METRICS_PREFIX}:actor:${octActor.user!.uuid}:2026-10`;
                const { res: v1Record } = await server.stores.kv.get({
                    key: v1Key,
                });
                expect(v1Record).toBeNull();
            });

            it('two concurrent claims on the v1 key settle exactly one charge (old-node/new-node race)', async () => {
                vi.setSystemTime(SEPTEMBER_MONTH_ISO);
                const raceActor = makeActor();
                const listener = chargeOnce(450);

                // Bypasses the in-process `claimsInFlight` guard on purpose —
                // that guard only protects one node against itself; this
                // exercises the KV-level race two separate nodes would hit.
                const privateTarget = target as unknown as {
                    claimAndCharge: (
                        a: Actor,
                        userId: string,
                        month: string,
                    ) => Promise<unknown>;
                };
                const [first, second] = await Promise.all([
                    privateTarget.claimAndCharge(
                        raceActor,
                        raceActor.user!.uuid!,
                        '2026-09',
                    ),
                    privateTarget.claimAndCharge(
                        raceActor,
                        raceActor.user!.uuid!,
                        '2026-09',
                    ),
                ]);

                expect([first, second].filter(Boolean)).toHaveLength(1);
                expect(listener).toHaveBeenCalledTimes(1);
                expect(await claimOf(raceActor)).toBe(2);
            });
        });
    });

    // -- Credit holds --------------------------------------------------

    describe('reserveCredits', () => {
        it('takes what an in-flight operation could spend out of the spendable balance', async () => {
            const before = await target.getRemainingUsage(actor);
            expect(before).toBeGreaterThan(0);

            const hold = await target.reserveCredits(actor, 1000);

            expect(await target.getRemainingUsage(actor)).toBe(before - 1000);
            await hold.release();
            expect(await target.getRemainingUsage(actor)).toBe(before);
        });

        it('stacks holds, so parallel operations see each other', async () => {
            const before = await target.getRemainingUsage(actor);

            const first = await target.reserveCredits(actor, 400);
            const second = await target.reserveCredits(actor, 600);

            expect(await target.getRemainingUsage(actor)).toBe(before - 1000);
            await first.release();
            await second.release();
        });

        it('never reports a negative balance, however much is held', async () => {
            const before = await target.getRemainingUsage(actor);
            const hold = await target.reserveCredits(actor, before * 10);

            expect(await target.getRemainingUsage(actor)).toBe(0);
            await hold.release();
        });

        it('leaves the reported balance alone — a hold is not usage', async () => {
            const { remaining } = await target.getAllowedUsage(actor);
            const hold = await target.reserveCredits(actor, 1000);

            expect((await target.getAllowedUsage(actor)).remaining).toBe(
                remaining,
            );
            await hold.release();
        });

        it('releasing twice gives the budget back once', async () => {
            const before = await target.getRemainingUsage(actor);
            const hold = await target.reserveCredits(actor, 500);
            await hold.release();
            await hold.release();

            expect(await target.getRemainingUsage(actor)).toBe(before);
        });

        it('holds nothing for the system actor or a zero amount', async () => {
            const before = await target.getRemainingUsage(actor);
            await (await target.reserveCredits(actor, 0)).release();
            expect(await target.getRemainingUsage(actor)).toBe(before);
        });

        // A stream can outlive the hold's TTL; extending is what keeps its
        // in-flight spend visible for the whole generation.
        it('extend gives a hold another full TTL from now', async () => {
            const before = await target.getRemainingUsage(actor);
            const hold = await target.reserveCredits(actor, 750, {
                ttlMs: 500,
            });

            // Let the original deadline lapse entirely...
            await new Promise((r) => setTimeout(r, 620));
            expect(await target.getRemainingUsage(actor)).toBe(before);

            // ...extending brings the still-running operation's hold back.
            await hold.extend?.();
            expect(await target.getRemainingUsage(actor)).toBe(before - 750);

            await hold.release();
            expect(await target.getRemainingUsage(actor)).toBe(before);
        });

        it('extend after release does not resurrect the hold', async () => {
            const before = await target.getRemainingUsage(actor);
            const hold = await target.reserveCredits(actor, 300);
            await hold.release();
            await hold.extend?.();

            expect(await target.getRemainingUsage(actor)).toBe(before);
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

    // ── Usage detail layout ─────────────────────────────────────────────

    describe('usage detail layout', () => {
        let originalCacheMs: number;
        let originalPathCap: number;

        beforeAll(() => {
            originalCacheMs = (target.constructor as typeof MeteringService)
                .USAGE_DETAIL_CACHE_MS;
            originalPathCap = (target.constructor as typeof MeteringService)
                .USAGE_DETAIL_PATH_CAP;
            // Live reads by default — only the dedicated cache tests below
            // pin this back to a real window.
            (
                target.constructor as typeof MeteringService
            ).USAGE_DETAIL_CACHE_MS = 0;
        });

        afterAll(() => {
            (
                target.constructor as typeof MeteringService
            ).USAGE_DETAIL_CACHE_MS = originalCacheMs;
            (
                target.constructor as typeof MeteringService
            ).USAGE_DETAIL_PATH_CAP = originalPathCap;
        });

        beforeEach(() => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(OCTOBER_MONTH_ISO);
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('keeps the totals item scalar-only across many models', async () => {
            const bufActor: Actor = { user: makeUser() };
            const usages: UsageInput[] = Array.from(
                { length: 300 },
                (_, i) => ({
                    usageType: `provider${i}:model${i}:input`,
                    usageAmount: 1,
                    costOverride: 10,
                }),
            );

            await target.batchIncrementUsages(bufActor, usages);
            await server.stores.meteringBuffer.flushCycle();

            const month = '2026-10';
            const totalsKey = `${METRICS_V2_PREFIX}:actor:${bufActor.user!.uuid}:${month}`;
            const { res } = await server.stores.kv.get({ key: totalsKey });
            const stored = res as Record<string, unknown>;

            expect(stored.total).toBe(3000);
            expect(typeof stored.detailPaths).toBe('number');
            // No per-type keys landed on the totals item itself.
            for (const key of Object.keys(stored)) {
                expect(usages.some((u) => u.usageType.startsWith(key))).toBe(
                    false,
                );
            }
            // 300 types fan out to every shard; slow under a loaded full run.
        }, 30_000);

        it('groups a model’s kinds under the shard its head hashes to', async () => {
            const bufActor: Actor = { user: makeUser() };
            await target.batchIncrementUsages(bufActor, [
                {
                    usageType: 'openai:gpt-5-nano:input',
                    usageAmount: 10,
                    costOverride: 100,
                },
                {
                    usageType: 'openai:gpt-5-nano:output',
                    usageAmount: 5,
                    costOverride: 200,
                },
            ]);
            await server.stores.meteringBuffer.flushCycle();

            const month = '2026-10';
            const userId = bufActor.user!.uuid!;
            let found: Record<string, unknown> | null = null;
            for (let shard = 0; shard < USAGE_DETAIL_SHARD_COUNT; shard++) {
                const { res } = await server.stores.kv.get({
                    key: `${METRICS_V2_PREFIX}:actor:${userId}:detail:${shard}:${month}`,
                });
                if (res) {
                    found = res as Record<string, unknown>;
                    break;
                }
            }

            expect(found).not.toBeNull();
            const head = found!['openai:gpt-5-nano'] as Record<string, unknown>;
            expect(head.input).toEqual({ units: 10, cost: 100, count: 1 });
            expect(head.output).toEqual({ units: 5, cost: 200, count: 1 });
        });

        it('reads the per-model breakdown in one batch of at most 100 keys', async () => {
            const bufActor: Actor = { user: makeUser() };
            await target.incrementUsage(bufActor, 'kv:read', 1, 10);
            await server.stores.meteringBuffer.flushCycle();

            const getSpy = vi.spyOn(server.stores.meteringBuffer, 'get');
            const { usage } =
                await target.getActorCurrentMonthUsageDetails(bufActor);

            // Distinct from the single-key totals read and the (one-app)
            // app-totals read — this is the shard breakdown `getSummed`
            // batches through the same `get`.
            const shardCalls = getSpy.mock.calls.filter(
                (call) => Array.isArray(call[0]?.key) && call[0].key.length > 2,
            );
            expect(shardCalls).toHaveLength(1);
            expect(
                (shardCalls[0]![0].key as string[]).length,
            ).toBeLessThanOrEqual(100);
            expect(usage['kv:read']).toEqual({ units: 1, cost: 10, count: 1 });
            getSpy.mockRestore();
        });

        it('does not read any shard for an actor with no usage this month', async () => {
            const bufActor: Actor = { user: makeUser() };
            const getSummedSpy = vi.spyOn(
                server.stores.meteringBuffer,
                'getSummed',
            );

            const { usage } =
                await target.getActorCurrentMonthUsageDetails(bufActor);

            expect(usage).toEqual({ total: 0 });
            expect(getSummedSpy).not.toHaveBeenCalled();
            getSummedSpy.mockRestore();
        });

        it('serves a cached breakdown while the total stays live', async () => {
            (
                target.constructor as typeof MeteringService
            ).USAGE_DETAIL_CACHE_MS = 60_000;
            try {
                const bufActor: Actor = { user: makeUser() };
                await target.incrementUsage(bufActor, 'kv:read', 1, 10);
                await server.stores.meteringBuffer.flushCycle();

                const first =
                    await target.getActorCurrentMonthUsageDetails(bufActor);
                expect(first.usage['kv:read']).toEqual({
                    units: 1,
                    cost: 10,
                    count: 1,
                });

                // More usage of the same type — the total must reflect it
                // immediately even though the cached breakdown can lag.
                await target.incrementUsage(bufActor, 'kv:read', 1, 5);
                await server.stores.meteringBuffer.flushCycle();

                const second =
                    await target.getActorCurrentMonthUsageDetails(bufActor);
                expect(second.usage.total).toBe(15);
                expect(second.usage['kv:read']).toEqual({
                    units: 1,
                    cost: 10,
                    count: 1,
                });
            } finally {
                (
                    target.constructor as typeof MeteringService
                ).USAGE_DETAIL_CACHE_MS = 0;
            }
        });

        it('folds a flat-shaped record placed on a detail shard exactly once', async () => {
            // The decoder treats a flat record the same as a hierarchical
            // one, whatever put it there.
            const month = '2026-10';
            const userId = `legacy-${Math.random().toString(36).slice(2)}`;
            await server.stores.kv.incr({
                key: `${METRICS_V2_PREFIX}:actor:${userId}:detail:${USAGE_DETAIL_SHARD_COUNT - 1}:${month}`,
                pathAndAmountMap: {
                    'kv:read.units': 2,
                    'kv:read.cost': 20,
                    'kv:read.count': 1,
                },
            });
            await server.stores.kv.incr({
                key: `${METRICS_V2_PREFIX}:actor:${userId}:${month}`,
                pathAndAmountMap: { total: 20 },
            });

            const bufActor: Actor = {
                user: { uuid: userId, username: 'legacy' },
            };
            const { usage } =
                await target.getActorCurrentMonthUsageDetails(bufActor);

            expect(usage['kv:read']).toEqual({ units: 2, cost: 20, count: 1 });
        });

        it('folds a flat-shaped record placed straight on the totals and actor-app items exactly once', async () => {
            // A flat record mixes the total and per-type data in one item —
            // not a detail shard — and must still decode correctly.
            const month = '2026-10';
            const userId = `legacy-totals-${Math.random().toString(36).slice(2)}`;
            const appId = 'app-legacy';
            const flatPathAndAmountMap = {
                total: 20,
                'kv:read.units': 2,
                'kv:read.cost': 20,
                'kv:read.count': 1,
            };
            await server.stores.kv.incr({
                key: `${METRICS_V2_PREFIX}:actor:${userId}:${month}`,
                pathAndAmountMap: flatPathAndAmountMap,
            });
            await server.stores.kv.incr({
                key: `${METRICS_V2_PREFIX}:actor:${userId}:app:${appId}:${month}`,
                pathAndAmountMap: flatPathAndAmountMap,
            });

            const bufActor: Actor = {
                user: { uuid: userId, username: 'legacy' },
            };
            const { usage } =
                await target.getActorCurrentMonthUsageDetails(bufActor);
            expect(usage.total).toBe(20);
            expect(usage['kv:read']).toEqual({ units: 2, cost: 20, count: 1 });

            const appUsage = await target.getActorCurrentMonthAppUsageDetails(
                bufActor,
                appId,
            );
            expect(appUsage.total).toBe(20);
            expect(appUsage['kv:read']).toEqual({
                units: 2,
                cost: 20,
                count: 1,
            });
        });

        it('folds detail past a lowered cap into other, keeping totals exact', async () => {
            (
                target.constructor as typeof MeteringService
            ).USAGE_DETAIL_PATH_CAP = 5;
            try {
                const bufActor: Actor = { user: makeUser() };
                const usages: UsageInput[] = Array.from(
                    { length: 8 },
                    (_, i) => ({
                        usageType: `provider${i}:model${i}:input`,
                        usageAmount: 1,
                        costOverride: 10,
                    }),
                );

                await target.batchIncrementUsages(bufActor, usages);
                const { usage } =
                    await target.getActorCurrentMonthUsageDetails(bufActor);

                expect(usage.total).toBe(80);

                // At most 5 types keep their own row; the rest collapse into
                // `other` — which of the 8 doesn't matter here.
                const admitted = usages.filter((u) => usage[u.usageType]);
                expect(admitted.length).toBeLessThanOrEqual(5);
                const other = usage[OTHER_USAGE_TYPE] as
                    | { cost: number }
                    | undefined;
                expect(other).toBeDefined();

                // Nothing was lost, only regrouped: every admitted type's
                // cost plus `other`'s adds back to the exact total.
                const admittedCost = admitted.reduce(
                    (sum, u) =>
                        sum + (usage[u.usageType] as { cost: number }).cost,
                    0,
                );
                expect(admittedCost + other!.cost).toBe(80);
            } finally {
                (
                    target.constructor as typeof MeteringService
                ).USAGE_DETAIL_PATH_CAP = originalPathCap;
            }
        });

        it('keeps a type already known its own row even once the cap is full', async () => {
            (
                target.constructor as typeof MeteringService
            ).USAGE_DETAIL_PATH_CAP = 5;
            try {
                const bufActor: Actor = { user: makeUser() };
                await target.incrementUsage(
                    bufActor,
                    'openai:gpt-5-nano:input',
                    1,
                    10,
                );
                // Fill the rest of the cap with other types.
                await target.batchIncrementUsages(
                    bufActor,
                    Array.from({ length: 4 }, (_, i) => ({
                        usageType: `provider${i}:model${i}:input`,
                        usageAmount: 1,
                        costOverride: 10,
                    })),
                );

                // The cap is now full — a brand-new type would fold into
                // `other`, but more of an already-known one must not.
                await target.incrementUsage(
                    bufActor,
                    'openai:gpt-5-nano:input',
                    1,
                    5,
                );
                const { usage } =
                    await target.getActorCurrentMonthUsageDetails(bufActor);

                expect(usage['openai:gpt-5-nano:input']).toEqual({
                    units: 2,
                    cost: 15,
                    count: 2,
                });
            } finally {
                (
                    target.constructor as typeof MeteringService
                ).USAGE_DETAIL_PATH_CAP = originalPathCap;
            }
        });

        it('does not expose detailPaths as a usage type', async () => {
            const bufActor: Actor = { user: makeUser() };
            await target.incrementUsage(bufActor, 'kv:read', 1, 10);

            const { usage } =
                await target.getActorCurrentMonthUsageDetails(bufActor);

            expect(usage.detailPaths).toBeUndefined();
        });

        it('still charges the allowance when writing detail fails', async () => {
            const bufActor: Actor = { user: makeUser() };
            const realIncr = server.stores.meteringBuffer.incr.bind(
                server.stores.meteringBuffer,
            );
            const incrSpy = vi
                .spyOn(server.stores.meteringBuffer, 'incr')
                .mockImplementation(
                    async (input: Parameters<typeof realIncr>[0]) => {
                        if (input.key.includes(':detail:'))
                            throw new Error('shard write boom');
                        return realIncr(input);
                    },
                );
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});

            const usage = await target.incrementUsage(
                bufActor,
                'kv:read',
                1,
                10,
            );
            incrSpy.mockRestore();
            warnSpy.mockRestore();

            // `usage` predates the settle's own allowanceUsed write (same as
            // any other call) — a fresh read is what confirms the charge.
            expect(usage.total).toBe(10);
            const settled =
                await target.getActorCurrentMonthUsageDetails(bufActor);
            expect(settled.usage.allowanceUsed).toBe(10);
        });

        it('still charges the allowance when the detail write throws outright', async () => {
            const bufActor: Actor = { user: makeUser() };
            // A synchronous throw escapes #recordDetail's own per-write
            // catches, so only the billing path's guard stands in the way.
            const auxSpy = vi
                .spyOn(server.stores.meteringBuffer, 'incrAux')
                .mockImplementation(() => {
                    throw new Error('aux boom');
                });
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});

            const usage = await target.incrementUsage(
                bufActor,
                'kv:read',
                1,
                10,
            );
            auxSpy.mockRestore();
            warnSpy.mockRestore();

            expect(usage.total).toBe(10);
            const settled =
                await target.getActorCurrentMonthUsageDetails(bufActor);
            expect(settled.usage.allowanceUsed).toBe(10);
        });

        it('still invalidates credits on a correction when writing detail fails', async () => {
            const bufActor: Actor = { user: makeUser() };
            await target.incrementUsage(bufActor, 'kv:read', 1, 10);

            const realIncr = server.stores.meteringBuffer.incr.bind(
                server.stores.meteringBuffer,
            );
            const incrSpy = vi
                .spyOn(server.stores.meteringBuffer, 'incr')
                .mockImplementation(
                    async (input: Parameters<typeof realIncr>[0]) => {
                        if (input.key.includes(':detail:'))
                            throw new Error('shard write boom');
                        return realIncr(input);
                    },
                );
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            const invalidateSpy = vi.spyOn(target, 'invalidateActorCredits');

            await target.setActorCurrentMonthUsageTotal(bufActor, 5);
            incrSpy.mockRestore();
            warnSpy.mockRestore();

            expect(invalidateSpy).toHaveBeenCalledWith(bufActor.user!.uuid);
            invalidateSpy.mockRestore();
        });

        it('keeps a colon-free type and its own kinds both readable, and counts both as new', async () => {
            const bufActor: Actor = { user: makeUser() };
            // "kv" (head-only) and "kv:read" (head "kv", kind "read") share a
            // shard item — both land under the same top-level key there.
            await target.incrementUsage(bufActor, 'kv', 1, 10);
            await target.incrementUsage(bufActor, 'kv:read', 1, 20);
            await server.stores.meteringBuffer.flushCycle();

            const { usage } =
                await target.getActorCurrentMonthUsageDetails(bufActor);

            expect(usage.kv).toEqual({ units: 1, cost: 10, count: 1 });
            expect(usage['kv:read']).toEqual({ units: 1, cost: 20, count: 1 });

            const month = '2026-10';
            const totalsKey = `${METRICS_V2_PREFIX}:actor:${bufActor.user!.uuid}:${month}`;
            const { res } = await server.stores.kv.get({ key: totalsKey });
            expect((res as { detailPaths?: number })?.detailPaths).toBe(2);
        });
    });

    // ── appTotals (prefix listing) ──────────────────────────────────────

    describe('appTotals (prefix listing)', () => {
        let originalCacheMs: number;

        beforeAll(() => {
            originalCacheMs = (target.constructor as typeof MeteringService)
                .USAGE_DETAIL_CACHE_MS;
            (
                target.constructor as typeof MeteringService
            ).USAGE_DETAIL_CACHE_MS = 0;
        });
        afterAll(() => {
            (
                target.constructor as typeof MeteringService
            ).USAGE_DETAIL_CACHE_MS = originalCacheMs;
        });

        it('lists every app the actor used this month, with total and count', async () => {
            const bufActor: Actor = { user: makeUser() };
            const appOne = resolveActor({
                ...bufActor,
                app: { uid: 'app-one' },
            });
            await target.incrementUsage(appOne, 'kv:read', 1, 10);
            await target.incrementUsage(appOne, 'kv:read', 1, 5);
            await target.incrementUsage(
                resolveActor({ ...bufActor, app: { uid: 'app-two' } }),
                'kv:read',
                1,
                20,
            );
            await server.stores.meteringBuffer.flushCycle();

            const { appTotals } =
                await target.getActorCurrentMonthUsageDetails(bufActor);

            expect(appTotals['app-one']).toEqual({ total: 15, count: 2 });
            expect(appTotals['app-two']).toEqual({ total: 20, count: 1 });
        });

        it('merges a buffered, not-yet-flushed delta into the listing', async () => {
            const bufActor: Actor = { user: makeUser() };
            const appActor = resolveActor({
                ...bufActor,
                app: { uid: 'app-buffered' },
            });
            await target.incrementUsage(appActor, 'kv:read', 1, 10);
            await server.stores.meteringBuffer.flushCycle();
            // Not flushed — the key already exists (listable), but this
            // increment is still only in the buffer.
            await target.incrementUsage(appActor, 'kv:read', 1, 5);

            const { appTotals } =
                await target.getActorCurrentMonthUsageDetails(bufActor);
            expect(appTotals['app-buffered']).toEqual({ total: 15, count: 2 });
        });

        it('never lists a detail or appdetail shard as an app', async () => {
            const bufActor: Actor = { user: makeUser() };
            await target.incrementUsage(
                resolveActor({ ...bufActor, app: { uid: 'app-shard' } }),
                'openai:gpt-5-nano:input',
                1,
                10,
            );
            await server.stores.meteringBuffer.flushCycle();

            const { appTotals } =
                await target.getActorCurrentMonthUsageDetails(bufActor);
            expect(Object.keys(appTotals)).toEqual(['app-shard']);
        });

        it("ignores another month's app totals", async () => {
            const bufActor: Actor = { user: makeUser() };
            await server.stores.kv.incr({
                key: `${METRICS_V2_PREFIX}:actor:${bufActor.user!.uuid}:app:app-old:2020-01`,
                pathAndAmountMap: { total: 999, count: 1 },
            });
            await target.incrementUsage(
                resolveActor({ ...bufActor, app: { uid: 'app-new' } }),
                'kv:read',
                1,
                10,
            );
            await server.stores.meteringBuffer.flushCycle();

            const { appTotals } =
                await target.getActorCurrentMonthUsageDetails(bufActor);
            expect(appTotals['app-old']).toBeUndefined();
            expect(appTotals['app-new']).toEqual({ total: 10, count: 1 });
        });

        it('an app actor sees only its own total, with everyone else folded into others', async () => {
            const bufActor: Actor = { user: makeUser() };
            await target.incrementUsage(
                resolveActor({ ...bufActor, app: { uid: 'app-mine' } }),
                'kv:read',
                1,
                10,
            );
            await target.incrementUsage(
                resolveActor({ ...bufActor, app: { uid: 'app-theirs' } }),
                'kv:read',
                1,
                20,
            );
            await server.stores.meteringBuffer.flushCycle();

            const appActor = resolveActor({
                ...bufActor,
                app: { uid: 'app-mine' },
            });
            const { appTotals } =
                await target.getActorCurrentMonthUsageDetails(appActor);

            expect(appTotals['app-mine']).toEqual({ total: 10, count: 1 });
            expect(appTotals['app-theirs']).toBeUndefined();
            expect(appTotals.others).toEqual({ total: 20, count: 1 });
        });

        it('caches the app-totals listing and invalidates it on a correction', async () => {
            (
                target.constructor as typeof MeteringService
            ).USAGE_DETAIL_CACHE_MS = 60_000;
            try {
                const bufActor: Actor = { user: makeUser() };
                await target.incrementUsage(
                    resolveActor({ ...bufActor, app: { uid: 'app-cached' } }),
                    'kv:read',
                    1,
                    10,
                );
                await server.stores.meteringBuffer.flushCycle();

                const first =
                    await target.getActorCurrentMonthUsageDetails(bufActor);
                expect(first.appTotals['app-cached']).toEqual({
                    total: 10,
                    count: 1,
                });

                const listSpy = vi.spyOn(server.stores.kv, 'list');
                await target.getActorCurrentMonthUsageDetails(bufActor);
                expect(listSpy).not.toHaveBeenCalled();

                await target.setActorCurrentMonthUsageTotal(bufActor, 50);
                await target.getActorCurrentMonthUsageDetails(bufActor);
                expect(listSpy).toHaveBeenCalled();
                listSpy.mockRestore();
            } finally {
                (
                    target.constructor as typeof MeteringService
                ).USAGE_DETAIL_CACHE_MS = 0;
            }
        });

        it('a user with 150 apps still returns every one of them', async () => {
            const bufActor: Actor = { user: makeUser() };
            const month = currentMonthString();
            // Seeded directly: 150 full increments flush ~600 keys and time
            // out under coverage.
            await Promise.all(
                Array.from({ length: 150 }, (_, i) =>
                    server.stores.kv.incr({
                        key: `${METRICS_V2_PREFIX}:actor:${bufActor.user!.uuid}:app:app-${i}:${month}`,
                        pathAndAmountMap: { total: 1, count: 1 },
                    }),
                ),
            );

            const { appTotals } =
                await target.getActorCurrentMonthUsageDetails(bufActor);
            expect(Object.keys(appTotals)).toHaveLength(150);
            expect(appTotals['app-77']).toEqual({ total: 1, count: 1 });
        }, 30_000);
    });

    // ── The removed `:apps:` item ────────────────────────────────────────

    describe('no more per-actor apps item', () => {
        it('never writes the old unsharded apps-totals key', async () => {
            const bufActor: Actor = { user: makeUser() };
            const month = currentMonthString();
            await target.incrementUsage(
                resolveActor({ ...bufActor, app: { uid: 'app-x' } }),
                'kv:read',
                1,
                10,
            );
            await server.stores.meteringBuffer.flushCycle();

            const { res } = await server.stores.kv.get({
                key: `${METRICS_V2_PREFIX}:actor:${bufActor.user!.uuid}:apps:${month}`,
            });
            expect(res).toBeNull();
        });
    });
});
