import { describe, expect, it } from 'vitest';
import { usageBudget } from './usageBudget.js';

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

    it('keeps the capacity at the plan when top-up credit exists', () => {
        // $12.00 of a $95.00 allowance spent, $5.00 top-up untouched: the
        // credit reads as headroom against the plan, never as more plan.
        const budget = usageBudget(
            { total: 1_200_000_000, allowanceUsed: 1_200_000_000 },
            info(9_500_000_000, {
                purchasedCredits: 500_000_000,
                consumedPurchaseCredits: 0,
            }),
        );
        expect(budget.capacity).toBe(9_500_000_000);
        expect(budget.used).toBe(700_000_000);
        expect(budget.percent).toBe(7);
    });

    it('goes negative when unspent top-up exceeds the spend', () => {
        // $0.50 spent, $10.00 credit untouched, $9.00 allowance.
        const budget = usageBudget(
            { total: 50_000_000, allowanceUsed: 50_000_000 },
            info(900_000_000, {
                purchasedCredits: 1_000_000_000,
                consumedPurchaseCredits: 0,
            }),
        );
        expect(budget.used).toBe(-950_000_000);
        expect(budget.percent).toBe(-106);
        expect(budget.barPercent).toBe(0);
    });

    it('ignores credit already consumed — only what is left offsets usage', () => {
        // Allowance exhausted, $200 of top-up bought and fully spent: the
        // month reads as full, not as 200 dollars into the negatives.
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
