import { describe, expect, it } from 'vitest';
import { addonCreditsRemaining, usageBudget } from './usageBudget.js';

const info = (allowance, addons = {}) => ({
    monthUsageAllowance: allowance,
    addons,
});

describe('usageBudget', () => {
    it('anchors the bar to the monthly allowance', () => {
        // $0.50 of a $9.00 allowance spent, no top-up.
        const budget = usageBudget(
            { total: 50_000_000, allowanceUsed: 50_000_000 },
            info(900_000_000),
        );
        expect(budget.capacity).toBe(900_000_000);
        expect(budget.used).toBe(50_000_000);
        expect(budget.percent).toBe(6);
    });

    it('leaves add-on credit out of the monthly meter', () => {
        // $0.50 of a $9.00 allowance spent, $10.00 add-on untouched: the
        // plan meter reads the plan alone and never goes negative.
        const budget = usageBudget(
            { total: 50_000_000, allowanceUsed: 50_000_000 },
            info(900_000_000, {
                purchasedCredits: 1_000_000_000,
                consumedPurchaseCredits: 0,
            }),
        );
        expect(budget.capacity).toBe(900_000_000);
        expect(budget.used).toBe(50_000_000);
        expect(budget.percent).toBe(6);
    });

    it('reads a full plan once the allowance is spent and add-on credit pays', () => {
        const budget = usageBudget(
            { total: 29_500_000_000, allowanceUsed: 9_500_000_000 },
            info(9_500_000_000, {
                purchasedCredits: 20_000_000_000,
                consumedPurchaseCredits: 20_000_000_000,
            }),
        );
        expect(budget.used).toBe(9_500_000_000);
        expect(budget.percent).toBe(100);
        expect(budget.barPercent).toBe(100);
    });

    it('counts only allowance-charged spend against the plan', () => {
        // $9.11 of allowance used this month; the total also carries spend
        // that purchased credit already paid for.
        const budget = usageBudget(
            { total: 1_500_000_000, allowanceUsed: 911_000_000 },
            info(9_500_000_000),
        );
        expect(budget.used).toBe(911_000_000);
        expect(budget.percent).toBe(10);
    });

    it('never trusts a reported allowanceUsed past the month total', () => {
        // A corrupt record: the split grew past the spend it splits (a raced
        // server write). The bar reads the total — the same clamp the server
        // applies to remaining — instead of overstating past 100%.
        const budget = usageBudget(
            { total: 1_840_000_000, allowanceUsed: 20_722_300_000 },
            info(19_000_000_000, {
                purchasedCredits: 40_000_000_000,
                consumedPurchaseCredits: 40_000_000_000,
            }),
        );
        expect(budget.used).toBe(1_840_000_000);
        expect(budget.percent).toBe(10);
        expect(budget.barPercent).toBeCloseTo(9.68, 1);
    });

    it('falls back to the capped total for records without the split', () => {
        // Legacy record: no allowanceUsed. Everything up to the allowance
        // counts, and an overshot total still reads as a full plan.
        const budget = usageBudget({ total: 1_000_000_000 }, info(900_000_000));
        expect(budget.used).toBe(900_000_000);
        expect(budget.percent).toBe(100);
        expect(budget.barPercent).toBe(100);
    });

    it('answers zero for an account with no budget at all', () => {
        const budget = usageBudget({ total: 0 }, info(0));
        expect(budget).toMatchObject({ capacity: 0, used: 0, percent: 0 });
    });

    it('treats missing objects and numbers as zero rather than rendering NaN', () => {
        expect(usageBudget(undefined, undefined).percent).toBe(0);
        expect(usageBudget(null, info(NaN)).capacity).toBe(0);
        expect(usageBudget({ total: NaN }, info(100)).capacity).toBe(100);
        expect(usageBudget({ total: NaN }, info(100)).percent).toBe(0);
    });
});

describe('addonCreditsRemaining', () => {
    it('is null for an account that never had add-on credit', () => {
        expect(addonCreditsRemaining(info(900_000_000))).toBeNull();
        expect(addonCreditsRemaining(info(900_000_000, { purchasedCredits: 0 }))).toBeNull();
        expect(addonCreditsRemaining(undefined)).toBeNull();
    });

    it('reports what is left of the pool', () => {
        expect(addonCreditsRemaining(info(900_000_000, {
            purchasedCredits: 2_500,
            consumedPurchaseCredits: 850,
        }))).toBe(1_650);
    });

    it('reads zero, not null or negative, once the pool is spent', () => {
        expect(addonCreditsRemaining(info(0, {
            purchasedCredits: 1_000,
            consumedPurchaseCredits: 1_200,
        }))).toBe(0);
    });

    it('treats a missing or bad consumed value as nothing spent', () => {
        expect(addonCreditsRemaining(info(0, {
            purchasedCredits: 1_000,
            consumedPurchaseCredits: NaN,
        }))).toBe(1_000);
    });
});
