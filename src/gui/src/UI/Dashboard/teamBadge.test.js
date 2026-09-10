import { describe, expect, it } from 'vitest';

globalThis.i18n = (key, args) => `${key}:${(args ?? []).join(',')}`;
globalThis.window = { html_encode: (v) => String(v).replace(/</g, '&lt;') };

const { teamBadgeHtml } = await import('./teamBadge.js');

describe('the sidebar team badge', () => {
    it('names the team for a seat', () => {
        const h = teamBadgeHtml({ team: { uid: 't-1', name: 'Acme Corp' } });
        expect(h).toContain('dashboard-sidebar-team');
        expect(h).toContain('Acme Corp');
    });

    it('says nothing for anyone who is not a seat', () => {
        // whoami omits `team` entirely for an ordinary account or an owner.
        for (const user of [undefined, {}, { team: undefined }, { team: {} }]) {
            expect(teamBadgeHtml(user)).toBe('');
        }
    });

    it('treats a blank name as nothing to say', () => {
        expect(teamBadgeHtml({ team: { uid: 't-1', name: '   ' } })).toBe('');
    });

    it('encodes the name, which an admin chose', () => {
        const h = teamBadgeHtml({ team: { name: '<script>x</script>' } });
        expect(h).not.toContain('<script>');
        expect(h).toContain('&lt;script');
    });

    it('explains itself in the title, for a truncated name', () => {
        const h = teamBadgeHtml({ team: { name: 'Acme' } });
        expect(h).toContain('teams_account_of:Acme');
    });
});
