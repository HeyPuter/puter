import { describe, expect, it } from 'vitest';
import { usageBudget } from './usageBudget.js';

describe('usageBudget', () => {
    it('reports the plan alone when no credit has been bought', () => {
        // $0.50 spent of a $9.00 allowance.
        const budget = usageBudget(50_000_000, 850_000_000);
        expect(budget.capacity).toBe(900_000_000);
        expect(budget.percent).toBe(6);
    });

    it('never reports a negative share for an account holding credit', () => {
        // $0.50 spent, $9.00 allowance, $10.00 of purchased credit untouched.
        // The cards used to subtract held credit from spend, which rendered
        // this account at roughly -105% of its own plan.
        const budget = usageBudget(50_000_000, 1_850_000_000);
        expect(budget.percent).toBeGreaterThanOrEqual(0);
        expect(budget.percent).toBe(3);
        expect(budget.capacity).toBe(1_900_000_000);
    });

    it('keeps used, capacity and share consistent once credit is being spent', () => {
        // $12.00 spent: the $9.00 allowance plus $3.00 of a $10.00 top-up,
        // leaving $7.00. Capacity has to stay the full $19.00 — reading it as
        // allowance-plus-what's-left implied $4.00 remaining while the server
        // said $7.00.
        const budget = usageBudget(1_200_000_000, 700_000_000);
        expect(budget.capacity).toBe(1_900_000_000);
        expect(budget.used + 700_000_000).toBe(budget.capacity);
        expect(budget.percent).toBe(63);
    });

    it('reads a spent budget as full rather than overflowing the bar', () => {
        const budget = usageBudget(900_000_000, 0);
        expect(budget.percent).toBe(100);
        expect(budget.barPercent).toBe(100);
    });

    it('answers zero for an account with no budget at all', () => {
        const budget = usageBudget(0, 0);
        expect(budget).toMatchObject({ capacity: 0, percent: 0 });
    });

    it('treats missing numbers as zero rather than rendering NaN', () => {
        expect(usageBudget(undefined, undefined).percent).toBe(0);
        expect(usageBudget(NaN, 100).capacity).toBe(100);
    });
});
