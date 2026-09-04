import { describe, expect, it, vi } from 'vitest';

// The tab pulls in the dialog primitives, which pull in the whole window stack.
// Only the tab-object contract is under test here.
vi.mock('../UIAlert.js', () => ({ default: vi.fn() }));
vi.mock('../UIPrompt.js', () => ({ default: vi.fn() }));

globalThis.i18n = (key) => key;
globalThis.html_encode = (value) => String(value);

const { default: TabTeams } = await import('./TabTeams.js');

/**
 * UIDashboard reads exactly these keys off a tab, wraps `html()` in its own
 * `.dashboard-section-<id>` div, and calls `html()` synchronously before the
 * window exists.
 */
describe('the TabTeams tab object', () => {
    it('carries the id UIDashboard turns into the hash and the section class', () => {
        expect(TabTeams.id).toBe('teams');
    });

    it('resolves its label at import time, before any render', () => {
        expect(TabTeams.label).toBe('teams');
    });

    it('exposes an inline svg icon, which is injected unescaped', () => {
        expect(TabTeams.icon.startsWith('<svg')).toBe(true);
    });

    it('has the render and wiring hooks UIDashboard calls', () => {
        expect(typeof TabTeams.html).toBe('function');
        expect(typeof TabTeams.init).toBe('function');
        expect(typeof TabTeams.onActivate).toBe('function');
    });
});

describe('TabTeams.html()', () => {
    it('returns a string synchronously, since it runs before the window is built', () => {
        expect(typeof TabTeams.html()).toBe('string');
    });

    it('renders the section header and the container the tab paints into', () => {
        const h = TabTeams.html();
        expect(h).toContain('dashboard-section-header');
        expect(h).toContain('teams-body');
    });

    it('does not emit its own section wrapper, which UIDashboard already adds', () => {
        expect(TabTeams.html()).not.toContain('dashboard-section-teams');
    });

    it('paints nothing until the first load, so a deployment without teams shows no content', () => {
        expect(TabTeams.html()).toContain('<div class="dashboard-settings-grid teams-body"></div>');
    });
});
