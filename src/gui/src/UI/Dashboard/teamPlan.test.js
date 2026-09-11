import { describe, expect, it } from 'vitest';

globalThis.i18n = (key, args) =>
    args && !Array.isArray(args)
        ? `${key}(${Object.entries(args).map(([k, v]) => `${k}=${v}`).join(',')})`
        : key;
globalThis.window = { html_encode: (v) => String(v).replace(/</g, '&lt;') };

const { teamPlanHtml } = await import('./teamPlan.js');

const offering = (over = {}) => ({
    itemId: 'puter-team-basic',
    tier: 'team-basic',
    name_en: 'Team Basic',
    amountPerSeat: 10,
    currency: 'USD',
    available: true,
    ...over,
});

describe('the team plan card', () => {
    const ready = (over = {}) => ({
        status: 'ready',
        offerings: [offering()],
        tierQuantities: {},
        ...over,
    });

    it('draws nothing when no catalogue came back', () => {
        for (const plan of [null, undefined, { status: 'unavailable' }, {}]) {
            expect(teamPlanHtml({ plan })).toBe('');
        }
    });

    it('says plans are per account once something is bought', () => {
        const h = teamPlanHtml({
            plan: ready({ tierQuantities: { 'team-basic': 2 } }),
        });
        expect(h).toContain('teams_plan_per_account_hint');
    });

    it('says nothing is bought when no tier has a seat', () => {
        expect(teamPlanHtml({ plan: ready() })).toContain('teams_plan_none');
    });

    it('shows how many accounts are on each tier', () => {
        const h = teamPlanHtml({
            plan: ready({ tierQuantities: { 'team-basic': 3 } }),
        });
        expect(h).toContain('count=3');
    });

    it('marks a tier with no configured price unavailable', () => {
        // Buying one 422s, so it must not look purchasable.
        const h = teamPlanHtml({
            plan: ready({ offerings: [offering({ available: false })] }),
        });
        expect(h).toContain('teams_plan_unavailable');
    });

    it('offers no assignment hint without a billing extension', () => {
        const h = teamPlanHtml({ plan: ready(), canBuy: false });
        expect(h).not.toContain('teams_plan_assign_hint');
        // Prices still render; only the action is missing.
        expect(h).toContain('Team Basic');
    });

    it('points at the table when a billing extension is present', () => {
        // The card is a summary now; the chooser is per row.
        const h = teamPlanHtml({ plan: ready(), canBuy: true });
        expect(h).toContain('teams_plan_assign_hint');
        expect(h).not.toContain('teams-plan-buy');
    });

    it('surfaces a status that is not active, so dunning is visible', () => {
        const h = teamPlanHtml({ plan: ready({ subStatus: 'past_due' }) });
        expect(h).toContain('past_due');
    });

    it('encodes a name the server supplied', () => {
        const h = teamPlanHtml({
            plan: ready({ offerings: [offering({ name_en: '<script>x</script>' })] }),
        });
        expect(h).not.toContain('<script>');
    });
});
