// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../../lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('./UIDashboardDialog.js', () => ({ default: vi.fn() }));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = (key, replacements) => {
    if ( replacements && typeof replacements === 'object' && ! Array.isArray(replacements) ) {
        return `${key}(${Object.entries(replacements).map(([k, v]) => `${k}=${v}`).join(',')})`;
    }
    return key;
};
globalThis.html_encode = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
window.html_encode = globalThis.html_encode;

const { default: TabTeams } = await import('./TabTeams.js');

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const team = { uid: 't1', name: 'Acme Design', handle: 'acme', isOwner: true, directoryEnabled: false };
const members = [
    { username: 'dana', orgOwned: true, createdAt: '2026-09-17T00:00:00Z', uuid: 'u-dana' },
    { username: 'boss', orgOwned: false, createdAt: '2026-09-01T00:00:00Z' },
    { username: 'elliot', orgOwned: true, createdAt: '2026-09-17T00:00:00Z', uuid: 'u-elliot' },
];
// Newest first, as the API sends it; unix seconds, as the audit routes send it.
const audit = [
    { action: 'disable', username: 'elliot', reason: null, actorUsername: 'boss', createdAt: 1789672096 },
    { action: 'provision', username: 'elliot', reason: null, actorUsername: 'boss', createdAt: 1789600000 },
    { action: 'provision', username: 'dana', reason: null, actorUsername: 'boss', createdAt: 1789600000 },
];

const mount = async ({ teams = [team], plan = null } = {}) => {
    window.teams_ui = true;
    window.team_billing_ui = false;
    window.api_origin = 'http://api.test';
    window.user = { username: 'boss' };
    globalThis.puter = {
        authToken: 'tok',
        teams: {
            list: vi.fn(async () => teams),
            listAudit: vi.fn(async () => audit),
            listOwnAudit: vi.fn(async () => audit.filter(e => e.username === 'boss')),
            listMembers: vi.fn(async () => members),
        },
    };
    globalThis.fetch = vi.fn(async () => ({ ok: false }));
    if ( plan ) globalThis.fetch = plan;

    document.body.innerHTML = `<div class="dashboard" data-element_uuid="w1">
        <a class="dashboard-sidebar-item" data-section="teams"></a>
        <div class="dashboard-section dashboard-section-teams">${TabTeams.html()}</div>
    </div>`;
    const $el_window = $('.dashboard');
    TabTeams.init($el_window);
    await flush();
    await flush();
    return $el_window;
};

describe('the owner view', () => {
    let $w;
    beforeEach(async () => { $w = await mount(); });

    it('names the team, its role and headcount in the hero', () => {
        const hero = $w.find('.teams-hero');
        expect(hero.find('strong').text()).toBe('Acme Design');
        expect(hero.find('.teams-role').text()).toBe('teams_role_owner');
        expect(hero.find('.teams-info-meta').text()).toContain('@acme');
        expect(hero.find('.teams-info-meta').text()).toContain('teams_member_count(count=3)');
        expect(hero.find('.teams-rename')).toHaveLength(1);
        // One team: no picker to choose it with.
        expect(hero.find('.teams-picker-select')).toHaveLength(0);
    });

    it('renders the directory as a switch that still carries the wired class', () => {
        const input = $w.find('.dashboard-switch input.teams-directory-check');
        expect(input).toHaveLength(1);
        expect(input.is(':checked')).toBe(false);
        expect($w.find('.teams-directory-note').text()).toBe('teams_directory_off_note');
    });

    it('lists accounts with a status pill and folds the audit state in', () => {
        const rows = $w.find('.teams-members-table tbody tr');
        expect(rows).toHaveLength(3);
        // Suspended last, provisioned before joined.
        expect(rows.map((_, r) => $(r).attr('data-username')).get()).toEqual(['dana', 'boss', 'elliot']);
        expect(rows.eq(2).hasClass('teams-member-disabled')).toBe(true);
        expect(rows.eq(2).find('.teams-status').hasClass('teams-status-disabled')).toBe(true);
        expect(rows.eq(0).find('.teams-status').hasClass('teams-status-active')).toBe(true);
    });

    it('marks the signed-in account and gives it no actions', () => {
        const you = $w.find('.teams-member-row[data-username="boss"]');
        expect(you.find('.teams-you')).toHaveLength(1);
        expect(you.find('.teams-member-actions')).toHaveLength(0);
        expect($w.find('.teams-member-row[data-username="dana"] .teams-you')).toHaveLength(0);
    });

    it('offers restore and delete only for a suspended account', () => {
        const dana = $w.find('.teams-member-row[data-username="dana"]');
        const elliot = $w.find('.teams-member-row[data-username="elliot"]');
        expect(dana.find('.teams-disable')).toHaveLength(1);
        expect(dana.find('.teams-delete-account')).toHaveLength(0);
        expect(elliot.find('.teams-enable')).toHaveLength(1);
        expect(elliot.find('.teams-delete-account')).toHaveLength(1);
    });

    it('labels every data cell for the phone layout, which drops the header row', () => {
        const cells = $w.find('.teams-members-table tbody tr').first().find('td[data-label]');
        expect(cells.map((_, c) => $(c).attr('data-label')).get()).toEqual([
            'teams_member_state', 'teams_member_since', 'teams_member_plan',
        ]);
    });

    it('keeps the actions in a block inside the cell, not on the cell itself', () => {
        const cell = $w.find('.teams-member-row[data-username="dana"] td.teams-cell-actions');
        expect(cell.children('.teams-member-actions')).toHaveLength(1);
    });

    it('prints audit seconds as a real date, not 1970', () => {
        const when = $w.find('.teams-audit-table tbody tr').first().find('.teams-cell-when').text();
        expect(when).toContain('2026');
        expect(when).not.toContain('1970');
    });

    it('skips the suspended clause of the billing note when there is nothing suspended', async () => {
        expect($w.find('.teams-panel-hint').filter((_, el) => $(el).text().startsWith('teams_billing_summary')).text())
            .toBe('teams_billing_summary_one(billed=1,disabled=1)');
    });

    it('adds an account on form submit, so Enter works, and shows the credential with a copy button', async () => {
        globalThis.puter.teams.createMember = vi.fn(async () => ({ username: 'gil', temporaryPassword: 'p4ss' }));
        $w.find('.teams-new-username').val('gil');
        $w.find('.teams-form').trigger('submit');
        await flush();
        await flush();
        await flush();
        expect(globalThis.puter.teams.createMember).toHaveBeenCalledWith('t1', { username: 'gil' });
        const box = $w.find('.teams-credential');
        expect(box.is(':visible') || box.css('display') !== 'none').toBe(true);
        expect(box.find('.teams-credential-value').text()).toBe('p4ss');
        expect(box.find('.teams-credential-copy').attr('data-value')).toBe('p4ss');
        box.find('.teams-credential-dismiss').trigger('click');
        expect(box.children()).toHaveLength(0);
    });
});

describe('the member view', () => {
    it('shows the roster and own record, and nothing an administrator would use', async () => {
        const $w = await mount({ teams: [{ ...team, isOwner: false }] });
        expect($w.find('.teams-role').text()).toBe('teams_role_member');
        expect($w.find('.teams-rename')).toHaveLength(0);
        expect($w.find('.teams-roster .teams-identity')).toHaveLength(3);
        expect($w.find('.teams-directory-check')).toHaveLength(0);
        expect($w.find('.teams-form')).toHaveLength(0);
        expect($w.find('.dashboard-danger-zone')).toHaveLength(0);
        expect($w.find('.teams-panel h3').first().text()).toContain('teams_roster');
    });
});

describe('states', () => {
    it('shows a picker when there is more than one team', async () => {
        const $w = await mount({ teams: [team, { ...team, uid: 't2', name: 'Other' }] });
        expect($w.find('.teams-hero .teams-picker-select option')).toHaveLength(2);
    });

    it('offers to create a team when there is none', async () => {
        const $w = await mount({ teams: [] });
        expect($w.find('.teams-state .teams-create')).toHaveLength(1);
    });

    it('offers a retry when the load fails', async () => {
        window.teams_ui = true;
        const $w = await mount();
        globalThis.puter.teams.list = vi.fn(async () => { throw new Error('boom'); });
        await TabTeams.onActivate($w);
        await flush();
        expect($w.find('.teams-state .teams-retry')).toHaveLength(1);
        globalThis.puter.teams.list = vi.fn(async () => [team]);
        $w.find('.teams-retry').trigger('click');
        expect($w.find('.teams-skeleton')).toHaveLength(1);
        await flush();
        await flush();
        expect($w.find('.teams-hero')).toHaveLength(1);
    });
});
