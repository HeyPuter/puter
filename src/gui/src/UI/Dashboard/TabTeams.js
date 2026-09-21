/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import teamActionButton from './teamActionIcons.js';
import UIDashboardDialog from './UIDashboardDialog.js';
import {
    annotateMembers,
    auditActionKey,
    auditReasonKey,
    auditSlice,
    avatarHue,
    billingSummaryKey,
    canDeleteAccount,
    initialOf,
    membersBillingSummary,
    memberPlanLabel,
    parseTimestamp,
    sortMembers,
} from './teamsConsole.js';

const SECTION = '.dashboard-section-teams';

/** What the console last loaded, so a redraw needs no second round trip. */
let state = { status: 'loading', teams: [], selected: null, members: [], audit: [], auditPage: 0, plan: null };

// Paged for reading, not fetching: member state is derived from the whole
// record, so it is already loaded.
const AUDIT_ROWS_PER_PAGE = 10;

/** In flight, so `init` and the initial-route `onActivate` don't both load. */
let loadPromise = null;

/** Every dialog here is the dashboard's overlay card, mounted in the window. */
const dialog = ($el_window, opts) => UIDashboardDialog({ $container: $el_window, ...opts });

const dateText = (value) => parseTimestamp(value)?.toLocaleDateString() ?? '';

/** The record needs the hour: several entries share a day. */
const dateTimeText = (value) => {
    const date = parseTimestamp(value);
    return date ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
};

const teamName = (team) => team?.name || team?.handle || i18n('teams_untitled');

/** The sidebar entry is hidden rather than shown broken where teams are off. */
const setTabVisible = ($el_window, visible) => {
    $el_window.find('.dashboard-sidebar-item[data-section="teams"]').toggle(visible);
};

// Inline like the other tabs' card icons: one-place glyphs, not shared assets.
const SVG = (body) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
    team: SVG('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    directory: SVG('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/><circle cx="11" cy="9.5" r="2"/><path d="M7.5 15a4 4 0 0 1 7 0"/>'),
    copy: SVG('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    check: SVG('<path d="M20 6L9 17l-5-5"/>'),
    close: SVG('<path d="M18 6L6 18"/><path d="M6 6l12 12"/>'),
    warning: SVG('<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
};

// -- Rendering ------------------------------------------------------------

/** A lettered tile in place of a picture: team accounts have none. */
const renderAvatar = (name, extraClass = '') => {
    const hue = avatarHue(name);
    return `<span class="teams-avatar${extraClass}" style="--teams-avatar-hue: ${hue};" aria-hidden="true">${html_encode(initialOf(name))}</span>`;
};

const renderTeamPicker = () => {
    if ( state.teams.length < 2 ) return '';
    let h = `<select class="teams-picker-select" aria-label="${html_encode(i18n('teams_team', [], false))}">`;
    for ( const team of state.teams ) {
        const selected = team.uid === state.selected?.uid ? ' selected' : '';
        h += `<option value="${html_encode(team.uid)}"${selected}>${html_encode(teamName(team))}</option>`;
    }
    h += '</select>';
    return h;
};

/** Name, handle and headcount for the selected team, plus who you are in it. */
const renderHero = () => {
    const team = state.selected;
    const count = state.members.length;
    let h = '<div class="dashboard-card teams-panel teams-hero">';
    h += '<div class="teams-hero-main">';
    h += renderAvatar(teamName(team), ' teams-avatar-lg');
    h += '<div class="teams-info">';
    h += '<div class="teams-info-title">';
    h += `<strong>${html_encode(teamName(team))}</strong>`;
    h += `<span class="teams-role">${i18n(team.isOwner ? 'teams_role_owner' : 'teams_role_member')}</span>`;
    h += '</div>';
    const meta = [];
    // Nothing here sets a handle, so its absence is not worth a label.
    if ( team.handle ) meta.push(html_encode(`@${team.handle}`));
    meta.push(i18n(count === 1 ? 'teams_member_count_one' : 'teams_member_count', { count }));
    h += `<span class="teams-info-meta">${meta.join('<span class="teams-dot" aria-hidden="true">·</span>')}</span>`;
    h += '</div></div>';
    const picker = renderTeamPicker();
    const rename = team.isOwner ? `<button class="button teams-rename">${i18n('teams_rename')}</button>` : '';
    if ( picker || rename ) h += `<div class="teams-hero-actions">${picker}${rename}</div>`;
    h += '</div>';
    return h;
};

const renderCardHead = (title, hint, count = null) => {
    let h = '<div class="teams-card-head">';
    h += `<h3>${title}`;
    if ( count !== null ) h += `<span class="teams-count">${count}</span>`;
    h += '</h3>';
    if ( hint ) h += `<p class="teams-panel-hint">${hint}</p>`;
    h += '</div>';
    return h;
};

const planCell = (member) => {
    const label = memberPlanLabel(member, state.plan);
    if ( label.kind === 'tier' ) return html_encode(label.name);
    return i18n(`teams_member_plan_${label.kind}`);
};

const renderStatus = (member) => {
    const kind = member.disabled ? 'disabled' : 'active';
    return `<span class="teams-status teams-status-${kind}">${i18n(`teams_member_state_${kind}`)}</span>`;
};

const renderIdentity = (username, subline) => {
    const you = username === window.user?.username;
    let h = '<div class="teams-identity">';
    h += renderAvatar(username);
    h += '<div class="teams-identity-text">';
    h += `<span class="teams-identity-name">${html_encode(username)}`;
    if ( you ) h += `<span class="teams-you">${i18n('share_you')}</span>`;
    h += '</span>';
    if ( subline ) h += `<span class="teams-identity-sub">${subline}</span>`;
    h += '</div></div>';
    return h;
};

const renderMemberActions = (member) => {
    if ( ! member.orgOwned ) return '';
    const forMember = { 'data-username': member.username };
    let h = '<div class="teams-member-actions">';
    if ( window.team_billing_ui && state.plan?.status === 'ready' ) {
        h += teamActionButton({
            className: 'teams-plan-change',
            icon: 'plan',
            label: i18n('teams_plan_change'),
            attrs: { ...forMember, 'data-uuid': member.uuid ?? '' },
        });
    }
    h += teamActionButton({
        className: 'teams-reset',
        icon: 'credential',
        label: i18n('teams_reissue_credential'),
        attrs: forMember,
    });
    h += member.disabled
        ? teamActionButton({
            className: 'teams-enable',
            icon: 'enable',
            label: i18n('teams_enable_account'),
            attrs: forMember,
        })
        : teamActionButton({
            className: 'teams-disable',
            icon: 'suspend',
            label: i18n('teams_disable_account'),
            danger: true,
            attrs: forMember,
        });
    if ( canDeleteAccount(member) ) {
        h += teamActionButton({
            className: 'teams-delete-account',
            icon: 'remove',
            label: i18n('teams_delete_account'),
            danger: true,
            attrs: forMember,
        });
    }
    h += '</div>';
    return h;
};

// `data-label` repeats the column heading so the phone layout, which drops
// the header row, can print it beside each value.
const labelled = (key) => `data-label="${html_encode(i18n(key, [], false))}"`;

const renderMemberRow = (member) => {
    const username = html_encode(member.username);
    let h = `<tr class="teams-member-row${member.disabled ? ' teams-member-disabled' : ''}" data-username="${username}">`;
    h += `<td class="teams-cell-identity">${renderIdentity(member.username, i18n(member.orgOwned ? 'teams_member_provisioned' : 'teams_member_joined'))}</td>`;
    h += `<td ${labelled('teams_member_state')}>${renderStatus(member)}</td>`;
    h += `<td ${labelled('teams_member_since')}>${html_encode(dateText(member.createdAt))}</td>`;
    h += `<td ${labelled('teams_member_plan')}>${planCell(member)}</td>`;
    h += `<td class="teams-cell-actions">${renderMemberActions(member)}</td>`;
    h += '</tr>';
    return h;
};

const renderMembers = () => {
    const annotated = annotateMembers(state.members, state.audit);
    const summary = membersBillingSummary(annotated);

    let h = '<div class="dashboard-card teams-panel">';
    h += renderCardHead(
        i18n('teams_accounts'),
        i18n(billingSummaryKey(summary), { billed: summary.billed, disabled: summary.disabled }),
        annotated.length,
    );

    if ( annotated.length === 0 ) {
        h += `<p class="teams-empty">${i18n('teams_no_accounts')}</p>`;
    } else {
        h += '<div class="teams-table-wrapper"><table class="teams-table teams-members-table"><thead><tr>';
        h += `<th>${i18n('teams_member_account')}</th>`;
        h += `<th>${i18n('teams_member_state')}</th>`;
        h += `<th>${i18n('teams_member_since')}</th>`;
        h += `<th>${i18n('teams_member_plan')}</th>`;
        h += `<th class="teams-cell-actions"><span class="sr-only">${i18n('teams_member_actions')}</span></th>`;
        h += '</tr></thead><tbody>';
        for ( const member of sortMembers(annotated) ) h += renderMemberRow(member);
        h += '</tbody></table></div>';
    }
    h += '</div>';
    return h;
};

const renderAddAccount = () => {
    let h = '<div class="dashboard-card teams-panel">';
    h += renderCardHead(i18n('teams_add_account'), i18n('teams_add_account_hint'));
    h += '<form class="teams-form" novalidate>';
    h += '<div class="teams-field">';
    h += `<label for="teams-new-username">${i18n('username')}</label>`;
    h += '<input id="teams-new-username" class="teams-new-username" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" required>';
    h += '</div>';
    h += '<div class="teams-field">';
    h += `<label for="teams-new-email">${i18n('teams_email_optional')}</label>`;
    h += '<input id="teams-new-email" class="teams-new-email" type="email" autocomplete="off" spellcheck="false">';
    h += '</div>';
    h += `<button type="submit" class="button button-primary teams-add-btn">${i18n('teams_add_account')}</button>`;
    h += '</form>';
    h += `<p class="teams-field-help">${i18n('teams_add_account_email_hint')}</p>`;
    h += '<div class="teams-credential" role="status" aria-live="polite" style="display:none;"></div>';
    h += '</div>';
    return h;
};

const renderAudit = ({ title, hint }) => {
    let h = '<div class="dashboard-card teams-panel">';
    h += renderCardHead(title, hint, state.audit.length || null);

    if ( state.audit.length === 0 ) {
        h += `<p class="teams-empty">${i18n('teams_no_audit')}</p>`;
    } else {
        const { items, page, pages, from, to, total } = auditSlice(
            state.audit,
            state.auditPage,
            AUDIT_ROWS_PER_PAGE,
        );
        h += '<div class="teams-table-wrapper"><table class="teams-table teams-audit-table"><thead><tr>';
        h += `<th>${i18n('teams_audit_action')}</th>`;
        h += `<th>${i18n('teams_audit_account')}</th>`;
        h += `<th>${i18n('teams_audit_actor')}</th>`;
        h += `<th>${i18n('teams_audit_when')}</th>`;
        h += '</tr></thead><tbody>';
        for ( const entry of items ) {
            const actionKey = auditActionKey(entry.action);
            const reasonKey = auditReasonKey(entry.reason);
            h += '<tr>';
            h += `<td class="teams-cell-action">${actionKey ? i18n(actionKey) : html_encode(entry.action)}`;
            if ( reasonKey ) h += ` <span class="teams-audit-reason">${i18n(reasonKey)}</span>`;
            h += '</td>';
            h += `<td ${labelled('teams_audit_account')}>${html_encode(entry.username ?? '')}</td>`;
            h += `<td ${labelled('teams_audit_actor')}>${html_encode(entry.actorUsername ?? '')}</td>`;
            h += `<td ${labelled('teams_audit_when')} class="teams-cell-when">${html_encode(dateTimeText(entry.createdAt))}</td>`;
            h += '</tr>';
        }
        h += '</tbody></table></div>';
        if ( pages > 1 ) {
            h += '<div class="teams-pager">';
            h += `<span class="teams-pager-count">${i18n('teams_audit_range', { from, to, total })}</span>`;
            h += '<span class="teams-pager-buttons">';
            h += `<button class="button button-small teams-audit-prev"${page === 0 ? ' disabled' : ''}>${i18n('previous')}</button>`;
            h += `<button class="button button-small teams-audit-next"${page >= pages - 1 ? ' disabled' : ''}>${i18n('next')}</button>`;
            h += '</span></div>';
        }
    }
    h += '</div>';
    return h;
};

/** Colleagues, by name. No state, no dates, no actions — none are theirs. */
const renderRoster = () => {
    let h = '<div class="dashboard-card teams-panel">';
    h += renderCardHead(i18n('teams_roster'), i18n('teams_roster_hint'), state.members.length || null);
    if ( state.members.length === 0 ) {
        h += `<p class="teams-empty">${i18n('teams_roster_empty')}</p>`;
    } else {
        h += '<ul class="teams-roster">';
        for ( const member of sortMembers(state.members) ) {
            h += `<li class="teams-roster-name">${renderIdentity(member.username)}</li>`;
        }
        h += '</ul>';
    }
    h += '</div>';
    return h;
};

/** What a member sees: who else is here, their own entries, nothing admin. */
const renderMemberView = () => {
    return renderHero()
        + renderRoster()
        + renderAudit({
            title: i18n('teams_your_record'),
            hint: i18n('teams_your_record_hint', { team: teamName(state.selected) }),
        });
};

const renderDirectory = () => {
    const on = state.selected?.directoryEnabled === true;
    let h = '<div class="dashboard-card dashboard-settings-card teams-directory">';
    h += '<div class="dashboard-settings-card-content">';
    h += `<div class="dashboard-settings-card-icon">${ICONS.directory}</div>`;
    h += '<div class="dashboard-settings-card-info">';
    h += `<strong>${i18n('teams_directory_label')}</strong>`;
    h += `<span class="teams-directory-note">${i18n(on ? 'teams_directory_on_note' : 'teams_directory_off_note')}</span>`;
    h += '</div></div>';
    h += '<label class="dashboard-switch teams-directory-toggle">';
    h += `<input type="checkbox" class="teams-directory-check"${on ? ' checked' : ''} aria-label="${html_encode(i18n('teams_directory_label', [], false))}">`;
    h += '<span class="dashboard-switch-slider"></span>';
    h += '</label>';
    h += '</div>';
    return h;
};

const renderOwnerView = () => {
    let h = renderHero();
    h += renderDirectory();
    h += renderAddAccount();
    h += renderMembers();
    h += renderAudit({ title: i18n('teams_audit'), hint: i18n('teams_audit_hint') });

    h += '<div class="dashboard-danger-zone">';
    h += `<h3>${i18n('teams_danger_zone')}</h3>`;
    h += '<div class="dashboard-card dashboard-danger-card">';
    h += '<div class="dashboard-danger-card-content"><div class="dashboard-danger-card-info">';
    h += `<strong>${i18n('teams_delete_team')}</strong>`;
    h += `<span>${i18n('teams_delete_team_hint')}</span>`;
    h += '</div></div>';
    h += `<button class="button button-danger teams-delete">${i18n('teams_delete_team')}</button>`;
    h += '</div></div>';
    return h;
};

/** Placeholder cards the size of the ones about to arrive, so nothing jumps. */
const renderSkeleton = () => {
    let h = `<div class="teams-skeleton" role="status" aria-busy="true"><span class="sr-only">${i18n('teams_loading')}</span>`;
    h += '<div class="dashboard-card teams-panel teams-skeleton-card teams-skeleton-hero"><i class="teams-skeleton-tile"></i><span><i style="width: 40%"></i><i style="width: 25%"></i></span></div>';
    for ( let i = 0; i < 2; i++ ) {
        h += '<div class="dashboard-card teams-panel teams-skeleton-card"><span><i style="width: 30%"></i><i style="width: 70%"></i><i style="width: 55%"></i></span></div>';
    }
    h += '</div>';
    return h;
};

const renderState = ({ icon, title, hint, action, tone = '' }) => {
    let h = `<div class="dashboard-card teams-panel teams-state${tone ? ` teams-state-${tone}` : ''}">`;
    h += `<div class="teams-state-art">${icon}</div>`;
    h += `<h3>${title}</h3>`;
    if ( hint ) h += `<p class="teams-panel-hint">${hint}</p>`;
    if ( action ) h += action;
    h += '</div>';
    return h;
};

const renderBody = () => {
    // Nothing at all where teams are off: an empty panel is the honest
    // rendering of a feature this deployment does not have.
    if ( state.status === 'unavailable' ) return '';
    if ( state.status === 'loading' ) return renderSkeleton();
    if ( state.status === 'error' ) {
        return renderState({
            icon: ICONS.warning,
            tone: 'warning',
            title: i18n('teams_load_failed'),
            action: `<button class="button teams-retry">${i18n('retry')}</button>`,
        });
    }
    if ( state.teams.length === 0 ) {
        return renderState({
            icon: ICONS.team,
            title: i18n('teams_create_team'),
            hint: i18n('teams_create_team_hint'),
            action: `<button class="button button-primary teams-create">${i18n('teams_create_team')}</button>`,
        });
    }
    return state.selected?.isOwner ? renderOwnerView() : renderMemberView();
};

const paint = ($el_window) => {
    $el_window.find(`${SECTION} .teams-body`).html(renderBody());
};

// -- Loading --------------------------------------------------------------

const loadSelected = async () => {
    if ( ! state.selected ) return;
    // A fresh record starts at the top; auditSlice clamps a stale page anyway.
    state.auditPage = 0;
    state.audit = state.selected.isOwner
        ? await puter.teams.listAudit(state.selected.uid)
        : await puter.teams.listOwnAudit(state.selected.uid);
    // Members too: the roster is theirs to see, and the controller already
    // withholds from them what is not.
    state.members = await puter.teams.listMembers(state.selected.uid);
    state.plan = state.selected.isOwner ? await loadPlan(state.selected.uid) : null;
};

/** Served by a billing extension; absent is a normal answer. */
const loadPlan = async (teamUid) => {
    const get = async (path) => {
        const resp = await fetch(`${window.api_origin}${path}`, {
            headers: { Authorization: `Bearer ${puter.authToken}` },
        });
        return resp.ok ? resp.json() : null;
    };
    try {
        const [cat, sub] = await Promise.all([
            get('/marketplace/subscriptions/team-offerings'),
            get(`/marketplace/teams/${encodeURIComponent(teamUid)}/subscription`),
        ]);
        if ( ! cat ) return { status: 'unavailable', offerings: [], seatTiers: {} };
        const entry = sub?.subscription ?? null;
        return {
            status: 'ready',
            offerings: Array.isArray(cat.offerings) ? cat.offerings : [],
            seatTiers: entry?.seatTiers ?? {},
            seatStatuses: entry?.seatStatuses ?? {},
            tierQuantities: entry?.tierQuantities ?? {},
            subStatus: entry?.status ?? null,
        };
    } catch {
        return { status: 'unavailable', offerings: [], seatTiers: {} };
    }
};

/** The billing extension owns the picker, so the look matches personal plans. */
const changeSeatPlan = ($el_window, username, uuid) => {
    if ( state.plan?.status !== 'ready' || ! uuid ) return;
    window.dispatchEvent(new CustomEvent('team-plan-purchase', {
        detail: {
            teamUid: state.selected.uid,
            seatUuid: uuid,
            username,
            currentTier: state.plan.seatTiers?.[uuid] ?? null,
            currentStatus: state.plan.seatStatuses?.[uuid] ?? null,
            onDone: () => refresh($el_window),
        },
    }));
};

const load = async ($el_window) => {
    // The API can be on while the interface is not; same effect as no route.
    if ( ! window.teams_ui ) {
        state.status = 'unavailable';
        setTabVisible($el_window, false);
        return paint($el_window);
    }
    try {
        const teams = await puter.teams.list();
        state.teams = teams;
        state.selected = teams.find(t => t.uid === state.selected?.uid) ?? teams[0] ?? null;
        await loadSelected();
        state.status = 'ready';
        setTabVisible($el_window, true);
    } catch (e) {
        // A deployment with teams off registers no `/teams` route, so the
        // 404 is the feature gate rather than a failure worth reporting.
        state.status = e?.code === 'not_found' ? 'unavailable' : 'error';
        state.teams = [];
        state.selected = null;
        setTabVisible($el_window, false);
    }
    paint($el_window);
};

const refresh = ($el_window) => {
    if ( ! loadPromise ) {
        loadPromise = load($el_window).finally(() => { loadPromise = null; });
    }
    return loadPromise;
};

// -- Actions --------------------------------------------------------------

// The plain error says what happened, not that a plan is what raises the cap.
// The button appears only where a billing extension put the modal on the page.
const showSeatLimit = async ($el_window, e) => {
    const limit = e?.limit ?? e?.fields?.limit;
    const canUpgrade = typeof window.UIUpgradeAccount === 'function';
    let message = `<p>${limit ? i18n('teams_seat_limit', { limit }) : html_encode(e.message)}</p>`;
    message += `<p>${i18n('teams_seat_limit_upgrade')}</p>`;
    const answer = await dialog($el_window, {
        title: i18n('teams_add_account', [], false),
        tone: 'warning',
        message,
        buttons: canUpgrade
            ? [
                { label: i18n('cancel', [], false), value: 'no' },
                { label: i18n('teams_see_plans', [], false), value: 'upgrade', type: 'primary' },
            ]
            : [{ label: i18n('ok', [], false), value: 'no', type: 'primary' }],
    });
    if ( answer === 'upgrade' ) new window.UIUpgradeAccount().open_as_window();
};

const showError = ($el_window, e) => {
    if ( e?.code === 'seat_limit_reached' ) return showSeatLimit($el_window, e);
    return dialog($el_window, {
        title: i18n('something_went_wrong', [], false),
        tone: 'error',
        message: html_encode(e?.message ?? i18n('error_unknown_cause', [], false)),
    });
};

/** `label` names the action and titles the dialog; `kind` colours its button. */
const confirm = async ($el_window, message, label, kind = 'danger') => {
    const answer = await dialog($el_window, {
        title: label,
        tone: kind === 'danger' ? 'danger' : undefined,
        message,
        buttons: [
            { label: i18n('cancel', [], false), value: 'no' },
            { label, value: 'yes', type: kind },
        ],
    });
    return answer === 'yes';
};

/** Shown once and never retrievable, so it stays on screen until dismissed. */
const showCredential = ($el_window, username, temporaryPassword) => {
    const $box = $el_window.find(`${SECTION} .teams-credential`);
    let h = '<div class="teams-credential-head">';
    h += `<strong>${i18n('teams_credential_heading', { username })}</strong>`;
    h += `<button type="button" class="teams-credential-dismiss" aria-label="${html_encode(i18n('close', [], false))}">${ICONS.close}</button>`;
    h += '</div>';
    h += '<div class="teams-credential-row">';
    h += `<code class="teams-credential-value" tabindex="-1">${html_encode(temporaryPassword)}</code>`;
    h += `<button type="button" class="button button-small teams-credential-copy" data-value="${html_encode(temporaryPassword)}">${ICONS.copy}<span>${i18n('copy')}</span></button>`;
    h += '</div>';
    h += `<span class="teams-credential-note">${i18n('teams_credential_once')}</span>`;
    $box.html(h).show();
    $box.find('.teams-credential-value').trigger('focus');
};

/** Confirms on the button itself; a toast would appear away from the value. */
const copyCredential = async ($button) => {
    try {
        await navigator.clipboard.writeText($button.attr('data-value') ?? '');
    } catch {
        // Selecting the value is the fallback: it is one keystroke from copied.
        const node = $button.closest('.teams-credential').find('.teams-credential-value')[0];
        if ( node ) window.getSelection()?.selectAllChildren(node);
        return;
    }
    $button.addClass('teams-copied').html(`${ICONS.check}<span>${i18n('teams_credential_copied')}</span>`);
    setTimeout(() => {
        $button.removeClass('teams-copied').html(`${ICONS.copy}<span>${i18n('copy')}</span>`);
    }, 1800);
};

const addAccount = async ($el_window) => {
    const username = $el_window.find(`${SECTION} .teams-new-username`).val().trim();
    if ( ! username ) return;
    // With an address the credential is emailed too; without it, only shown here.
    const email = $el_window.find(`${SECTION} .teams-new-email`).val().trim();

    const $button = $el_window.find(`${SECTION} .teams-add-btn`);
    $button.prop('disabled', true).addClass('teams-busy');
    try {
        const created = await puter.teams.createMember(state.selected.uid, {
            username,
            ...(email ? { email } : {}),
        });
        await refresh($el_window);
        showCredential($el_window, created.username, created.temporaryPassword);
    } catch (e) {
        await showError($el_window, e);
    } finally {
        $el_window.find(`${SECTION} .teams-add-btn`).prop('disabled', false).removeClass('teams-busy');
    }
};

const reissueCredential = async ($el_window, username) => {
    const ok = await confirm(
        $el_window,
        `<p>${i18n('teams_confirm_reissue', { username })}</p>`,
        i18n('teams_reissue_credential', [], false),
    );
    if ( ! ok ) return;
    try {
        const result = await puter.teams.resendActivation(state.selected.uid, username);
        await refresh($el_window);
        showCredential($el_window, result.username, result.temporaryPassword);
    } catch (e) {
        await showError($el_window, e);
    }
};

const setMemberEnabled = async ($el_window, username, enabled) => {
    if ( ! enabled ) {
        const ok = await confirm(
            $el_window,
            `<p>${i18n('teams_confirm_disable', { username })}</p>`,
            i18n('teams_disable_account', [], false),
        );
        if ( ! ok ) return;
    }
    try {
        await (enabled
            ? puter.teams.enableMember(state.selected.uid, username)
            : puter.teams.disableMember(state.selected.uid, username));
        await refresh($el_window);
    } catch (e) {
        await showError($el_window, e);
    }
};

const renameTeam = async ($el_window) => {
    const name = await dialog($el_window, {
        title: i18n('teams_rename', [], false),
        message: i18n('teams_rename_prompt'),
        input: { placeholder: i18n('teams_team_name', [], false), value: state.selected.name ?? '' },
        buttons: [
            { label: i18n('cancel', [], false), value: false },
            { label: i18n('teams_rename', [], false), value: 'ok', type: 'primary' },
        ],
    });
    if ( name === false || name.trim() === '' ) return;
    try {
        await puter.teams.update(state.selected.uid, { name: name.trim() });
        await refresh($el_window);
    } catch (e) {
        await showError($el_window, e);
    }
};

const deleteMemberAccount = async ($el_window, username) => {
    const ok = await confirm(
        $el_window,
        i18n('teams_confirm_delete_account', { username }),
        i18n('teams_delete_account', [], false),
    );
    if ( ! ok ) return;
    try {
        await puter.teams.deleteMemberAccount(state.selected.uid, username);
        await refresh($el_window);
    } catch (e) {
        await showError($el_window, e);
    }
};

const setDirectoryEnabled = async ($el_window, enabled) => {
    // Turning it on is a disclosure, so it is confirmed; turning it off only
    // takes something away and does not need to interrupt anyone.
    if ( enabled ) {
        const ok = await confirm(
            $el_window,
            i18n('teams_directory_confirm'),
            i18n('teams_directory_confirm_action', [], false),
            // Reversible, and the wording says so — red would overstate it.
            'primary',
        );
        // Repaint so the checkbox does not sit checked after a refusal.
        if ( ! ok ) return paint($el_window);
    }
    try {
        await puter.teams.update(state.selected.uid, { directoryEnabled: enabled });
        await refresh($el_window);
    } catch (e) {
        await showError($el_window, e);
        await refresh($el_window);
    }
};

const createTeam = async ($el_window) => {
    const name = await dialog($el_window, {
        title: i18n('teams_create_team', [], false),
        message: i18n('teams_create_team_prompt'),
        input: { placeholder: i18n('teams_team_name', [], false) },
        buttons: [
            { label: i18n('cancel', [], false), value: false },
            { label: i18n('teams_create_team', [], false), value: 'ok', type: 'primary' },
        ],
    });
    if ( name === false || name.trim() === '' ) return;
    try {
        const created = await puter.teams.create({ name: name.trim() });
        state.selected = created;
        await refresh($el_window);
    } catch (e) {
        await showError($el_window, e);
    }
};

const deleteTeam = async ($el_window) => {
    const ok = await confirm(
        $el_window,
        `<p>${i18n('teams_confirm_delete_team', { team: teamName(state.selected) })}</p>`
        + `<p>${i18n('teams_confirm_delete_billing')}</p>`,
        i18n('teams_delete_team', [], false),
    );
    if ( ! ok ) return;
    try {
        await puter.teams.delete(state.selected.uid);
        state.selected = null;
        await refresh($el_window);
    } catch (e) {
        await showError($el_window, e);
    }
};

// -- Tab ------------------------------------------------------------------

const TabTeams = {
    id: 'teams',
    label: i18n('teams'),
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',

    html () {
        let h = '<div class="dashboard-tab-content">';
        h += '<div class="dashboard-section-header">';
        h += `<h2>${i18n('teams')}</h2>`;
        h += `<p>${i18n('teams_subtitle')}</p>`;
        h += '</div>';
        h += '<div class="dashboard-settings-grid teams-body"></div>';
        h += '</div>';
        return h;
    },

    init ($el_window) {
        // Hidden until the first load says teams exist here, so a
        // deployment with them off never shows an entry that cannot work.
        setTabVisible($el_window, false);

        // Delegated, because every action redraws the panel underneath them.
        $el_window.on('click', `${SECTION} .teams-audit-prev`, () => {
            state.auditPage = Math.max(0, state.auditPage - 1);
            paint($el_window);
        });
        $el_window.on('click', `${SECTION} .teams-audit-next`, () => {
            state.auditPage += 1;
            paint($el_window);
        });
        // Submit rather than click, so Enter in either field adds the account too.
        $el_window.on('submit', `${SECTION} .teams-form`, (e) => {
            e.preventDefault();
            addAccount($el_window);
        });
        $el_window.on('click', `${SECTION} .teams-credential-copy`, function () {
            copyCredential($(this));
        });
        $el_window.on('click', `${SECTION} .teams-credential-dismiss`, () => {
            $el_window.find(`${SECTION} .teams-credential`).hide().empty();
        });
        $el_window.on('click', `${SECTION} .teams-retry`, () => {
            state.status = 'loading';
            paint($el_window);
            refresh($el_window);
        });
        $el_window.on('click', `${SECTION} .teams-create`, () => createTeam($el_window));
        $el_window.on('click', `${SECTION} .teams-rename`, () => renameTeam($el_window));
        $el_window.on('click', `${SECTION} .teams-delete`, () => deleteTeam($el_window));
        // Checkout is the billing extension's job; this only says what was asked for.
        $el_window.on('click', `${SECTION} .teams-plan-change`, function () {
            changeSeatPlan($el_window, $(this).attr('data-username'), $(this).attr('data-uuid'));
        });
        $el_window.on('click', `${SECTION} .teams-plan-buy`, function () {
            if ( ! state.selected ) return;
            window.dispatchEvent(new CustomEvent('team-plan-purchase', {
                detail: {
                    teamUid: state.selected.uid,
                    itemId: $(this).attr('data-item-id'),
                    onDone: () => refresh($el_window),
                },
            }));
        });
        $el_window.on('click', `${SECTION} .teams-reset`, function () {
            reissueCredential($el_window, $(this).attr('data-username'));
        });
        $el_window.on('click', `${SECTION} .teams-disable`, function () {
            setMemberEnabled($el_window, $(this).attr('data-username'), false);
        });
        $el_window.on('click', `${SECTION} .teams-enable`, function () {
            setMemberEnabled($el_window, $(this).attr('data-username'), true);
        });
        $el_window.on('click', `${SECTION} .teams-delete-account`, function () {
            deleteMemberAccount($el_window, $(this).attr('data-username'));
        });
        $el_window.on('change', `${SECTION} .teams-directory-check`, function () {
            setDirectoryEnabled($el_window, $(this).is(':checked'));
        });
        $el_window.on('change', `${SECTION} .teams-picker-select`, async function () {
            state.selected = state.teams.find(t => t.uid === $(this).val()) ?? state.selected;
            await refresh($el_window);
        });

        refresh($el_window);
    },

    onActivate ($el_window) {
        refresh($el_window);
    },
};

export default TabTeams;
