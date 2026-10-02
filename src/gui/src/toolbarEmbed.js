import jQuery from './lib/jquery-3.6.1/jquery-3.6.1.min.js';
import { encode } from 'html-entities';
import './i18n/i18n.js';
import { isToolbarParent, readSavedAccounts, shouldShowUpgrade, toolbarChannel } from './helpers/toolbarEmbed.js';

window.$ = window.jQuery = jQuery;
window.locale = 'en';
try { window.locale = JSON.parse(localStorage.getItem('user_preferences'))?.language || 'en'; } catch {}
const config = JSON.parse(document.querySelector('#app-browser-config').textContent);
const $root = $('#puter-toolbar');
const escape = value => encode(String(value ?? ''), { mode: 'nonAsciiPrintable' });
window.html_encode = escape;
let parentOrigin;
let panel = null;
let panelObserver;
let user;
let busy = false;
const sessionToken = localStorage.getItem('auth_token_v2');
const notify = (action, details = {}) => {
    if ( parentOrigin ) parent.postMessage({ channel: toolbarChannel, action, ...details }, parentOrigin);
};
const refreshSession = () => { notify('session-changed'); location.reload(); };
window.addEventListener('message', event => {
    if ( event.source !== parent || event.data?.channel !== toolbarChannel ||
        !isToolbarParent(event.origin, location.origin, config.domain) ) return;
    if ( event.data.action === 'init' ) {
        parentOrigin = event.origin;
        notify('panel', { panel });
    }
    if ( event.data.action === 'close' ) closePanel();
});
window.addEventListener('storage', event => {
    if ( event.key === null || event.key === 'auth_token_v2' ) refreshSession();
});

async function request (path, { token = sessionToken, api = true, ...options } = {}) {
    const response = await fetch(new URL(path, api ? config.apiOrigin : location.origin), {
        ...options, credentials: 'include',
        headers: { Authorization: `Bearer ${token}`, ...options.headers },
    });
    if ( !response.ok ) throw new Error('Account request failed');
    return response;
}

function closePanel () {
    panelObserver?.disconnect();
    panelObserver = null;
    const previous = panel;
    panel = null;
    $root.find('.toolbar-panel').remove();
    $root.find('[aria-expanded]').attr('aria-expanded', 'false');
    if ( previous ) $root.find(`[data-panel="${previous}"]`).trigger('focus');
    notify('panel', { panel });
}

function showPanel (next) {
    if ( panel === next ) { closePanel(); return; }
    closePanel();
    panel = next;
    $root.find(`[data-panel="${next}"]`).attr('aria-expanded', 'true');
    $root.append(`<section class="toolbar-panel dashboard-card" aria-label="${escape(i18n(next === 'apps' ? 'toolbar_apps' : 'account'))}">
        <header><strong>${i18n(next === 'apps' ? 'toolbar_apps' : 'account')}</strong><button class="toolbar-close" type="button" aria-label="${escape(i18n('close'))}">×</button></header>
        <div class="toolbar-panel-content"></div></section>`);
    $root.find('.toolbar-close').on('click', closePanel);
    const $content = $root.find('.toolbar-panel-content');
    if ( next === 'apps' ) {
        $content.html(`<iframe class="toolbar-apps" title="${escape(i18n('toolbar_apps'))}" src="/embed/apps"></iframe>`);
        $content.find('iframe').on('load', event => {
            const frameDocument = event.currentTarget.contentDocument;
            frameDocument?.addEventListener('keydown', keyEvent => {
                if ( keyEvent.key === 'Escape' && !frameDocument.querySelector('.myapps-group-overlay') ) closePanel();
            });
        });
    } else {
        const accounts = readSavedAccounts().filter(account => account.uuid !== user.uuid);
        $content.html(`<div class="toolbar-account-content"><div class="toolbar-current"><strong>${escape(user.username)}</strong><span>${escape(user.email)}</span></div>
            <div class="toolbar-accounts">${accounts.map((account, index) => `<button type="button" class="toolbar-account" data-account="${index}"><span class="toolbar-avatar">${escape(account.username[0]?.toUpperCase())}</span><span><strong>${escape(account.username)}</strong><small>${escape(account.email)}</small></span></button>`).join('')}</div>
            <a class="toolbar-item" href="/action/login" target="_blank" rel="noopener noreferrer">${i18n('toolbar_add_account')}</a>
            <a class="toolbar-item" href="/dashboard#account" target="_blank" rel="noopener noreferrer">${i18n('toolbar_settings')}</a>
            <button type="button" class="toolbar-item toolbar-logout">${i18n('log_out')}</button>
            <div class="toolbar-confirm" hidden><p>${i18n(user.is_temp ? 'toolbar_logout_temporary' : 'toolbar_logout_confirm')}</p>
                <button type="button" class="toolbar-item toolbar-confirm-logout">${i18n('log_out')}</button>
                <button type="button" class="toolbar-item toolbar-cancel">${i18n('cancel')}</button></div>
            <p class="toolbar-error" role="status" hidden></p></div>`);
        $content.find('[data-account]').on('click', event => changeAccount(accounts[Number(event.currentTarget.dataset.account)]));
        $content.find('.toolbar-logout').on('click', () => {
            $content.find('.toolbar-confirm').prop('hidden', false);
            $content.find('.toolbar-logout').prop('hidden', true);
            $content.find('.toolbar-cancel').trigger('focus');
        });
        $content.find('.toolbar-cancel').on('click', () => {
            $content.find('.toolbar-confirm').prop('hidden', true);
            $content.find('.toolbar-logout').prop('hidden', false).trigger('focus');
        });
        $content.find('.toolbar-confirm-logout').on('click', signOut);
        const accountContent = $content.find('.toolbar-account-content')[0];
        panelObserver = new ResizeObserver(() => notify('panel', {
            panel, height: Math.ceil(accountContent.getBoundingClientRect().height + 104),
        }));
        panelObserver.observe(accountContent);
    }
    notify('panel', { panel });
    $root.find('.toolbar-close').trigger('focus');
}

async function accountAction (action) {
    if ( busy ) return;
    busy = true;
    $root.find('.toolbar-account, .toolbar-logout, .toolbar-confirm-logout').prop('disabled', true);
    try { await action(); }
    catch { $root.find('.toolbar-error').text(i18n('toolbar_account_error')).prop('hidden', false); }
    finally {
        busy = false;
        $root.find('.toolbar-account, .toolbar-logout, .toolbar-confirm-logout').prop('disabled', false);
    }
}

function changeAccount (account) {
    return accountAction(async () => {
        const next = await (await request('/whoami', { token: account.auth_token })).json();
        if ( next.uuid !== account.uuid ) throw new Error('Account mismatch');
        await request('/session/sync-cookie', { token: account.auth_token, api: false });
        localStorage.setItem('user', JSON.stringify(next));
        localStorage.setItem('auth_token_v2', account.auth_token);
        localStorage.removeItem('auth_token');
        refreshSession();
    });
}

function signOut () {
    return accountAction(async () => {
        const { token } = await (await request('/get-anticsrf-token', { api: false })).json();
        await request('/logout', { api: false, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anti_csrf: token }) });
        localStorage.setItem('logged_in_users', JSON.stringify(readSavedAccounts().filter(account => account.uuid !== user.uuid)));
        localStorage.removeItem('user');
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_token_v2');
        refreshSession();
    });
}

document.addEventListener('keydown', event => {
    if ( event.key === 'Escape' ) closePanel();
});

async function mount () {
    if ( !sessionToken ) throw new Error('Missing session');
    user = await (await request('/whoami')).json();
    if ( !user.uuid ) throw new Error('Missing account');
    $root.html(`<nav class="toolbar-row" aria-label="${escape(i18n('toolbar_label'))}">
        ${shouldShowUpgrade(user) ? `<a class="button button-primary toolbar-upgrade" href="/dashboard?upgrade=1#usage" target="_blank" rel="noopener noreferrer">${i18n('toolbar_upgrade')}</a>` : ''}
        <button type="button" class="toolbar-button" data-panel="apps" aria-expanded="false" aria-label="${escape(i18n('toolbar_apps'))}"><span class="toolbar-grid" aria-hidden="true">${'<i></i>'.repeat(9)}</span></button>
        <button type="button" class="toolbar-button toolbar-avatar" data-panel="account" aria-expanded="false" aria-label="${escape(i18n('account'))}">${escape(user.username?.[0]?.toUpperCase() || '?')}</button>
        </nav>`);
    $root.find('[data-panel]').on('click', event => showPanel(event.currentTarget.dataset.panel));
    try {
        const profile = await (await request('/profile')).json();
        if ( profile.picture && /^https?:\/\//.test(profile.picture) ) {
            const image = document.createElement('img');
            image.src = profile.picture;
            image.alt = '';
            image.referrerPolicy = 'no-referrer';
            image.onload = () => $root.find('[data-panel="account"]').empty().append(image);
        }
    } catch { /* An avatar is optional. */ }
}
mount().catch(() => $root.html(`<p class="toolbar-unavailable" role="status">${i18n('toolbar_unavailable')}</p>`));
