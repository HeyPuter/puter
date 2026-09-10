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

const ready = (over = {}) => ({
    status: 'ready',
    offerings: [offering()],
    current: null,
    ...over,
});

describe('the team plan card', () => {
    it('draws nothing when no catalogue came back', () => {
        // A deployment that sells nothing serves no catalogue.
        for (const plan of [null, undefined, { status: 'unavailable' }, {}]) {
            expect(teamPlanHtml({ plan })).toBe('');
        }
    });

    it('says the team is on the free plan when it has bought nothing', () => {
        const h = teamPlanHtml({ plan: ready(), canBuy: true });
        expect(h).toContain('teams_plan_none');
    });

    it('names the current plan and the accounts billed', () => {
        const h = teamPlanHtml({
            plan: ready({ current: { tier: 'team-basic', name_en: 'Team Basic', status: 'active' } }),
            seats: 3,
        });
        expect(h).toContain('plan=Team Basic');
        expect(h).toContain('seats=3');
    });

    it('uses the singular for one account', () => {
        const h = teamPlanHtml({
            plan: ready({ current: { tier: 'team-basic', status: 'active' } }),
            seats: 1,
        });
        expect(h).toContain('teams_plan_current_one');
        expect(h).not.toContain('teams_plan_current(');
    });

    it('surfaces a status that is not active, so dunning is visible', () => {
        const h = teamPlanHtml({
            plan: ready({ current: { tier: 'team-basic', status: 'past_due' } }),
        });
        expect(h).toContain('past_due');
    });

    it('offers no button for a tier with no configured price', () => {
        // Buying one 422s, so the button must not be there to press.
        const h = teamPlanHtml({
            plan: ready({ offerings: [offering({ available: false })] }),
            canBuy: true,
        });
        expect(h).toContain('teams_plan_unavailable');
        expect(h).not.toContain('teams-plan-buy');
    });

    it('offers no button without a billing extension to act on it', () => {
        const h = teamPlanHtml({ plan: ready(), canBuy: false });
        expect(h).not.toContain('teams-plan-buy');
        // The prices still render; only the action is missing.
        expect(h).toContain('Team Basic');
    });

    it('marks the tier the team already holds instead of offering it again', () => {
        const h = teamPlanHtml({
            plan: ready({ current: { tier: 'team-basic', status: 'active' } }),
            canBuy: true,
        });
        expect(h).toContain('teams_plan_current_badge');
        expect(h).not.toContain('teams-plan-buy');
    });

    it('carries the item id the purchase needs', () => {
        const h = teamPlanHtml({ plan: ready(), canBuy: true });
        expect(h).toContain('data-item-id="puter-team-basic"');
        expect(h).toContain('teams_plan_buy');
    });

    it('says switch, not choose, once a plan is held', () => {
        const h = teamPlanHtml({
            plan: ready({
                offerings: [offering(), offering({ itemId: 'puter-team-pro', tier: 'team-pro', name_en: 'Team Pro' })],
                current: { tier: 'team-basic', status: 'active' },
            }),
            canBuy: true,
        });
        expect(h).toContain('teams_plan_switch');
    });

    it('encodes a name the server supplied', () => {
        const h = teamPlanHtml({
            plan: ready({ offerings: [offering({ name_en: '<script>x</script>' })] }),
        });
        expect(h).not.toContain('<script>');
    });
});
