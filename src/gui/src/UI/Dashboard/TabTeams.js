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

import UIAlert from '../UIAlert.js';
import UIPrompt from '../UIPrompt.js';
import {
    annotateMembers,
    auditActionKey,
    canDeleteAccount,
    auditReasonKey,
    membersBillingSummary,
    sortMembers,
} from './teamsConsole.js';

const SECTION = '.dashboard-section-teams';

/** What the console last loaded, so a redraw needs no second round trip. */
let state = { status: 'loading', teams: [], selected: null, members: [], audit: [] };

/** In flight, so `init` and the initial-route `onActivate` don't both load. */
let loadPromise = null;

const modalOptions = ($el_window) => ({
    parent_uuid: $el_window.attr('data-element_uuid'),
    backdrop: true,
    close_on_backdrop_click: true,
    parent_center: true,
    stay_on_top: true,
});

const dateText = (value) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString();
};

const teamName = (team) => team?.name || team?.handle || i18n('teams_untitled');

/** The sidebar entry is hidden rather than shown broken where teams are off. */
const setTabVisible = ($el_window, visible) => {
    $el_window.find('.dashboard-sidebar-item[data-section="teams"]').toggle(visible);
};

// -- Rendering ------------------------------------------------------------

const renderTeamPicker = () => {
    if ( state.teams.length < 2 ) return '';
    let h = '<div class="teams-picker">';
    h += `<label for="teams-picker-select">${i18n('teams_team')}</label>`;
    h += '<select id="teams-picker-select" class="teams-picker-select">';
    for ( const team of state.teams ) {
        const selected = team.uid === state.selected?.uid ? ' selected' : '';
        h += `<option value="${html_encode(team.uid)}"${selected}>${html_encode(teamName(team))}</option>`;
    }
    h += '</select></div>';
    return h;
};

const renderMemberRow = (member) => {
    const username = html_encode(member.username);
    let h = `<tr class="teams-member-row${member.disabled ? ' teams-member-disabled' : ''}" data-username="${username}">`;
    h += `<td>${username}</td>`;
    h += `<td>${i18n(member.orgOwned ? 'teams_member_provisioned' : 'teams_member_joined')}</td>`;
    h += `<td>${i18n(member.disabled ? 'teams_member_state_disabled' : 'teams_member_state_active')}</td>`;
    h += `<td>${html_encode(dateText(member.createdAt))}</td>`;
    h += '<td class="teams-member-actions">';
    if ( member.orgOwned ) {
        h += `<button class="button button-small teams-reset" data-username="${username}">${i18n('teams_reissue_credential')}</button>`;
        h += member.disabled
            ? `<button class="button button-small teams-enable" data-username="${username}">${i18n('teams_enable_account')}</button>`
            : `<button class="button button-small button-danger teams-disable" data-username="${username}">${i18n('teams_disable_account')}</button>`;
        if ( canDeleteAccount(member) ) {
            h += `<button class="button button-small button-danger teams-delete-account" data-username="${username}">${i18n('teams_delete_account')}</button>`;
        }
    }
    h += '</td></tr>';
    return h;
};

const renderMembers = () => {
    const annotated = annotateMembers(state.members, state.audit);
    const summary = membersBillingSummary(annotated);

    let h = '<div class="dashboard-card teams-panel">';
    h += `<h3>${i18n('teams_accounts')}</h3>`;
    const billingKey = summary.billed === 1 ? 'teams_billing_summary_one' : 'teams_billing_summary';
    h += `<p class="teams-billing-note">${i18n(billingKey, { billed: summary.billed, disabled: summary.disabled })}</p>`;

    if ( annotated.length === 0 ) {
        h += `<p class="teams-empty">${i18n('teams_no_accounts')}</p>`;
    } else {
        h += '<div class="teams-table-wrapper"><table class="teams-table"><thead><tr>';
        h += `<th>${i18n('username')}</th>`;
        h += `<th>${i18n('teams_member_kind')}</th>`;
        h += `<th>${i18n('teams_member_state')}</th>`;
        h += `<th>${i18n('teams_member_since')}</th>`;
        h += `<th>${i18n('teams_member_actions')}</th>`;
        h += '</tr></thead><tbody>';
        for ( const member of sortMembers(annotated) ) h += renderMemberRow(member);
        h += '</tbody></table></div>';
    }
    h += '</div>';
    return h;
};

const renderAddAccount = () => {
    let h = '<div class="dashboard-card teams-panel">';
    h += `<h3>${i18n('teams_add_account')}</h3>`;
    h += `<p class="teams-panel-hint">${i18n('teams_add_account_hint')}</p>`;
    h += '<div class="teams-form">';
    h += `<input class="teams-new-username" type="text" autocomplete="off" spellcheck="false" placeholder="${html_encode(i18n('username'))}">`;
    h += `<input class="teams-new-email" type="email" autocomplete="off" spellcheck="false" placeholder="${html_encode(i18n('email'))}">`;
    h += `<button class="button button-primary teams-add-btn">${i18n('teams_add_account')}</button>`;
    h += '</div>';
    h += '<div class="teams-credential" style="display:none;"></div>';
    h += '</div>';
    return h;
};

const renderAudit = () => {
    let h = '<div class="dashboard-card teams-panel">';
    h += `<h3>${i18n('teams_audit')}</h3>`;
    h += `<p class="teams-panel-hint">${i18n('teams_audit_hint')}</p>`;

    if ( state.audit.length === 0 ) {
        h += `<p class="teams-empty">${i18n('teams_no_audit')}</p>`;
    } else {
        h += '<div class="teams-table-wrapper"><table class="teams-table"><thead><tr>';
        h += `<th>${i18n('teams_audit_when')}</th>`;
        h += `<th>${i18n('teams_audit_action')}</th>`;
        h += `<th>${i18n('teams_audit_account')}</th>`;
        h += `<th>${i18n('teams_audit_actor')}</th>`;
        h += '</tr></thead><tbody>';
        for ( const entry of state.audit ) {
            const actionKey = auditActionKey(entry.action);
            const reasonKey = auditReasonKey(entry.reason);
            h += '<tr>';
            h += `<td>${html_encode(dateText(entry.createdAt))}</td>`;
            h += `<td>${actionKey ? i18n(actionKey) : html_encode(entry.action)}`;
            if ( reasonKey ) h += ` <span class="teams-audit-reason">${i18n(reasonKey)}</span>`;
            h += '</td>';
            h += `<td>${html_encode(entry.username ?? '')}</td>`;
            h += `<td>${html_encode(entry.actorUsername ?? '')}</td>`;
            h += '</tr>';
        }
        h += '</tbody></table></div>';
    }
    h += '</div>';
    return h;
};

/** What a member sees: their own entries, and nothing administrative. */
const renderMemberView = () => {
    let h = '<div class="dashboard-card teams-panel">';
    h += `<h3>${i18n('teams_your_record')}</h3>`;
    h += `<p class="teams-panel-hint">${i18n('teams_your_record_hint', { team: teamName(state.selected) })}</p>`;
    h += '</div>';
    return h + renderAudit();
};

const renderDirectory = () => {
    const on = state.selected?.directoryEnabled === true;
    let h = '<div class="dashboard-card teams-panel">';
    h += `<h2>${i18n('teams_directory')}</h2>`;
    h += `<p class="teams-panel-hint">${i18n('teams_directory_hint')}</p>`;
    h += '<label class="teams-directory-toggle">';
    h += `<input type="checkbox" class="teams-directory-check"${on ? ' checked' : ''}>`;
    h += `<span>${i18n('teams_directory_label')}</span>`;
    h += '</label>';
    h += `<p class="teams-directory-note">${i18n(on ? 'teams_directory_on_note' : 'teams_directory_off_note')}</p>`;
    h += '</div>';
    return h;
};

const renderOwnerView = () => {
    let h = '<div class="dashboard-card teams-panel teams-card">';
    h += '<div class="teams-info">';
    h += `<strong>${html_encode(teamName(state.selected))}</strong>`;
    h += `<span>${state.selected.handle ? html_encode(`@${state.selected.handle}`) : i18n('teams_no_handle')}</span>`;
    h += '</div>';
    h += `<button class="button teams-rename">${i18n('teams_rename')}</button>`;
    h += '</div>';

    h += renderDirectory();
    h += renderAddAccount();
    h += renderMembers();
    h += renderAudit();

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

const renderBody = () => {
    // Nothing at all where teams are off: an empty panel is the honest
    // rendering of a feature this deployment does not have.
    if ( state.status === 'unavailable' ) return '';
    if ( state.status === 'loading' ) return `<p class="teams-empty">${i18n('teams_loading')}</p>`;
    if ( state.status === 'error' ) return `<p class="teams-empty">${i18n('teams_load_failed')}</p>`;
    if ( state.teams.length === 0 ) {
        let h = '<div class="dashboard-card teams-panel">';
        h += `<h3>${i18n('teams_create_team')}</h3>`;
        h += `<p class="teams-panel-hint">${i18n('teams_create_team_hint')}</p>`;
        h += `<button class="button button-primary teams-create">${i18n('teams_create_team')}</button>`;
        h += '</div>';
        return h;
    }
    return renderTeamPicker() + (state.selected?.isOwner ? renderOwnerView() : renderMemberView());
};

const paint = ($el_window) => {
    $el_window.find(`${SECTION} .teams-body`).html(renderBody());
};

// -- Loading --------------------------------------------------------------

const loadSelected = async () => {
    if ( ! state.selected ) return;
    state.audit = state.selected.isOwner
        ? await puter.teams.listAudit(state.selected.uid)
        : await puter.teams.listOwnAudit(state.selected.uid);
    state.members = state.selected.isOwner
        ? await puter.teams.listMembers(state.selected.uid)
        : [];
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

const showError = ($el_window, e) => UIAlert({
    type: 'error',
    message: e?.message ?? i18n('error_unknown_cause'),
    ...modalOptions($el_window),
});

const confirm = async ($el_window, message, label, kind = 'danger') => {
    const answer = await UIAlert({
        type: 'confirm',
        message,
        buttons: [
            { label, value: 'yes', type: kind },
            { label: i18n('cancel'), value: 'no' },
        ],
        ...modalOptions($el_window),
    });
    return answer === 'yes';
};

/** Shown once and never retrievable, so it stays on screen until dismissed. */
const showCredential = ($el_window, username, temporaryPassword) => {
    const $box = $el_window.find(`${SECTION} .teams-credential`);
    let h = `<strong>${i18n('teams_credential_heading', { username })}</strong>`;
    h += `<code class="teams-credential-value">${html_encode(temporaryPassword)}</code>`;
    h += `<span>${i18n('teams_credential_once')}</span>`;
    $box.html(h).show();
};

const addAccount = async ($el_window) => {
    const username = $el_window.find(`${SECTION} .teams-new-username`).val().trim();
    const email = $el_window.find(`${SECTION} .teams-new-email`).val().trim();
    if ( ! username || ! email ) return;

    const $button = $el_window.find(`${SECTION} .teams-add-btn`);
    $button.prop('disabled', true);
    try {
        const created = await puter.teams.createMember(state.selected.uid, { username, email });
        await refresh($el_window);
        showCredential($el_window, created.username, created.temporaryPassword);
    } catch (e) {
        await showError($el_window, e);
    } finally {
        $el_window.find(`${SECTION} .teams-add-btn`).prop('disabled', false);
    }
};

const reissueCredential = async ($el_window, username) => {
    const ok = await confirm(
        $el_window,
        `<p>${i18n('teams_confirm_reissue', { username })}</p>`,
        i18n('teams_reissue_credential'),
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
            i18n('teams_disable_account'),
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
    const name = await UIPrompt({
        message: i18n('teams_rename_prompt'),
        placeholder: i18n('teams_team_name'),
        defaultValue: state.selected.name ?? '',
        ...modalOptions($el_window),
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
        i18n('teams_delete_account'),
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
            i18n('teams_directory_confirm_action'),
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
    const name = await UIPrompt({
        message: i18n('teams_create_team_prompt'),
        placeholder: i18n('teams_team_name'),
        ...modalOptions($el_window),
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
        i18n('teams_delete_team'),
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
        $el_window.on('click', `${SECTION} .teams-add-btn`, () => addAccount($el_window));
        $el_window.on('click', `${SECTION} .teams-create`, () => createTeam($el_window));
        $el_window.on('click', `${SECTION} .teams-rename`, () => renameTeam($el_window));
        $el_window.on('click', `${SECTION} .teams-delete`, () => deleteTeam($el_window));
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
