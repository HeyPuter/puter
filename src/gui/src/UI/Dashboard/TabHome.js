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

import UIWindowSaveAccount from '../UIWindowSaveAccount.js';
import { formatCredits, formatDollarsFromMicrocents, usageIsCredits } from './credits.js';
import { addonCreditsRemaining, meterPercent, monthlyUsageOrThrow, usageBudget } from './usageBudget.js';
import { getMonthlyUsage, getStorageSpace } from './usageRequests.js';
import { appIconAttrs } from '../../helpers/appIcon.js';
import { filterLaunchableApps } from '../../helpers/launchAppsList.js';
import { isOrgSeat, orgSeatTeamName } from './orgSeat.js';
import { intlLocale } from '../../i18n/intlLocale.js';

// How long a completed usage load stays fresh enough to skip a repeat. Long
// enough to absorb the init/onActivate/routing burst on a single dashboard
// open, short enough that a user watching the panel still sees movement.
const USAGE_REFRESH_DEBOUNCE_MS = 5_000;

// How long the plan card waits for the subscription read before giving up.
const PLAN_REQUEST_TIMEOUT_MS = 15_000;

// Whether "Recently used" has its list: until the first answer it says
// nothing, rather than "No recent apps yet", and a failed first load says so.
let recentAppsState = 'loading';

function buildRecentAppsHTML() {
    let h = '';

    // Show up to 6 recent apps (2 columns x 3 rows); drop entries the backend
    // marks unlaunchable so a deleted or reclaimed app leaves the panel.
    const recentApps = filterLaunchableApps(window.launch_apps?.recent).slice(0, 6);

    if (recentApps.length > 0) {
        h += '<div class="bento-recent-apps-grid">';

        for (const app_info of recentApps) {
            // External apps (not owned by a Puter user) can report an opaque
            // app-… id as their title (uid === name === title); in that case show
            // the hostname of index_url instead of the opaque app id.
            if (
                app_info.external &&
                app_info.name === app_info.title &&
                app_info.name === app_info.uuid &&
                app_info.index_url
            ) {
                app_info.title = new URL(app_info.index_url).hostname;
                app_info.target_link = app_info.index_url;
            }

            h += `<button type="button" class="bento-recent-app" data-app-name="${html_encode(app_info.name)}" data-target-link="${html_encode(app_info.target_link)}">`;
            // Icon (the title names the button)
            h += `<img class="bento-recent-app-icon" alt="" ${appIconAttrs(app_info, window.icons['app.svg'])}>`;
            // Title
            h += `<span class="bento-recent-app-title">${html_encode(app_info.title)}</span>`;
            h += '</button>';
        }
        h += '</div>';
    } else if (recentAppsState === 'loading') {
        h += '<div class="bento-recent-apps-empty" aria-busy="true"></div>';
    } else {
        h += '<div class="bento-recent-apps-empty">';
        h +=
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">';
        h +=
            '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>';
        h +=
            '<rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>';
        h += '</svg>';
        if (recentAppsState === 'failed') {
            h += `<p>${i18n('apps_load_failed')}</p>`;
        } else {
            h += `<p>${i18n('no_recent_apps')}</p>`;
            h += `<span>${i18n('no_recent_apps_hint')}</span>`;
        }
        h += '</div>';
    }

    return h;
}

function buildUsageHTML() {
    let h = '';
    h += '<div class="bento-usage-grid">';

    // Your Plan section
    h +=
        '<div class="bento-usage-section bento-usage-card bento-plan-section">';
    h +=
        '<a href="#usage" class="bento-usage-card-header bento-plan-header" data-target-tab="usage">';
    h += `<h3>${i18n('your_plan')}</h3>`;
    h += '<span class="bento-usage-card-arrow">›</span>';
    h += '</a>';
    h += '<div class="bento-usage-card-info bento-plan-info">';
    h += '<span class="bento-usage-card-used bento-plan-name">--</span>';
    h +=
        '<span class="bento-usage-card-details bento-plan-details"><span class="bento-plan-badge"></span></span>';
    h += '</div>';
    h += '<div class="bento-plan-warning" style="display: none;"></div>';
    h += '<div class="bento-plan-note" style="display: none;"></div>';
    h +=
        `<a href="#" class="bento-plan-upgrade" style="display: none;">${i18n('plan_upgrade_link')}</a>`;
    h += '</div>';

    // Storage section
    h += '<div class="bento-usage-section bento-usage-card">';
    h += '<a href="#usage" class="bento-usage-card-header" data-target-tab="usage">';
    h += `<h3>${i18n('your_storage')}</h3>`;
    h += '<span class="bento-usage-card-arrow">›</span>';
    h += '</a>';
    h += '<div class="bento-usage-card-bar-wrapper">';
    h += '<div class="bento-usage-card-bar bento-storage-bar"></div>';
    h += '</div>';
    h += '<div class="bento-usage-card-info">';
    h +=
        `<span class="bento-usage-card-used bento-storage-used">${i18n('amount_used', { amount: '--' })}</span>`;
    h +=
        `<span class="bento-usage-card-details">${i18n('usage_percent_of_capacity', {
            percent: '<span class="bento-storage-percent">--%</span>',
            capacity: '<span class="bento-storage-capacity">--</span>',
        }, false)}</span>`;
    h += '</div>';
    h += '</div>';

    // Resources section
    h += '<div class="bento-usage-section bento-usage-card">';
    h += '<a href="#usage" class="bento-usage-card-header" data-target-tab="usage">';
    h += `<h3>${i18n('your_resources')}</h3>`;
    h += '<span class="bento-usage-card-arrow">›</span>';
    h += '</a>';
    h += '<div class="bento-usage-card-bar-wrapper">';
    h += '<div class="bento-usage-card-bar bento-resources-bar"></div>';
    h += '</div>';
    h += '<div class="bento-usage-card-info">';
    h +=
        `<span class="bento-usage-card-used bento-resources-used">${i18n('amount_used', { amount: '--' })}</span>`;
    h +=
        `<span class="bento-usage-card-details">${i18n('usage_percent_of_capacity', {
            percent: '<span class="bento-resources-percent">--%</span>',
            capacity: '<span class="bento-resources-capacity">--</span>',
        }, false)}</span>`;
    h +=
        '<span class="bento-usage-card-details bento-resources-addon" style="display: none;"></span>';
    h += '</div>';
    h += '</div>';

    h += '</div>';
    return h;
}

// Trial end date in two lengths — `short` for the note under the badge,
// `long` for anywhere with room for a sentence — plus `countdown`, which is
// what the badge carries: a date says when, only a countdown says how long
// there is to decide. Returns null when the subscription carries no end date,
// so callers fall back to unqualified "Free trial" wording.
function formatTrialEnd(trialEndsAt) {
    if (!Number.isFinite(trialEndsAt)) return null;
    const date = new Date(trialEndsAt);
    if (Number.isNaN(date.getTime())) return null;
    // Rounded up, so a trial with any time on it never reads "0 days left"
    // before the day it actually converts.
    const days = Math.max(
        0,
        Math.ceil((date.getTime() - Date.now()) / 86400000),
    );
    // In the dashboard's language, which the sentences around it are in.
    const locale = intlLocale(window.locale);
    return {
        short: date.toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
        }),
        long: date.toLocaleDateString(locale, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        }),
        days,
        countdown:
            days === 0
                ? i18n('trial_ends_today', [], false)
                : days === 1
                  ? i18n('trial_one_day_left', [], false)
                  : i18n('trial_days_left', { days }, false),
    };
}

// A trial running on part of its plan's usage, and what the paid plan gives.
// Null when the trial gets the plan's full usage.
function trialUsageNote(fraction, planName) {
    if (!(fraction > 0 && fraction < 1)) return null;
    const share =
        fraction === 0.5
            ? i18n('trial_usage_half', [], false)
            : `${Math.round(fraction * 100)}%`;
    const multiple = Math.round((1 / fraction) * 10) / 10;
    return i18n('trial_usage_note', { share, plan: planName, multiple }, false);
}

const TabHome = {
    id: 'home',
    get label () {
        return i18n('home');
    },
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',

    html() {
        const username = window.user?.username || i18n('user', [], false);
        const profilePicture =
            window.user?.profile?.picture || window.icons['profile.svg'];

        let h = '';
        h += '<div class="bento-container">';

        // Welcome card (square)
        h += '<div class="bento-card bento-welcome">';
        h += '<div class="bento-welcome-inner">';
        h += '<div class="bento-welcome-pattern"></div>';
        h += '<div class="bento-welcome-content">';
        h += `<div class="bento-welcome-avatar profile-pic" style="background-image: url(${html_encode(profilePicture)})"></div>`;
        h += `<span class="bento-greeting">${i18n('welcome')},</span>`;
        h += `<h1 class="bento-username username">${html_encode(username)}</h1>`;
        h += `<p class="bento-tagline">${i18n('your_personal_internet_computer')}</p>`;
        // Show warning if account is temporary/unsaved
        if (window.user?.is_temp) {
            h += '<button class="bento-save-account-warning">';
            h +=
                '<svg style="width: 16px; height: 16px;" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="48px" height="48px" viewBox="0 0 48 48"><g transform="translate(0, 0)"><path d="M45.521,39.04L27.527,5.134c-1.021-1.948-3.427-2.699-5.375-1.679-.717,.376-1.303,.961-1.679,1.679L2.479,39.04c-.676,1.264-.635,2.791,.108,4.017,.716,1.207,2.017,1.946,3.42,1.943H41.993c1.403,.003,2.704-.736,3.42-1.943,.743-1.226,.784-2.753,.108-4.017ZM23.032,15h1.937c.565,0,1.017,.467,1,1.031l-.438,14c-.017,.54-.459,.969-1,.969h-1.062c-.54,0-.983-.429-1-.969l-.438-14c-.018-.564,.435-1.031,1-1.031Zm.968,25c-1.657,0-3-1.343-3-3s1.343-3,3-3,3,1.343,3,3-1.343,3-3,3Z" fill="var(--dashboard-warning-icon)"></path></g></svg>';
            h += `<span>${i18n('save_session')}</span>`;
            h += '</button>';
        }
        h += '</div>';
        h += '</div>';
        h += '</div>';

        // Recent apps card (rectangle)
        h += '<div class="bento-card bento-recent">';
        h +=
            '<a href="#apps" class="bento-card-fancy-header" data-target-tab="apps">';
        h += '<div class="bento-card-fancy-icon bento-card-fancy-icon-apps">';
        h +=
            '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
        h += '</div>';
        h += '<div class="bento-card-fancy-text">';
        h += `<h2>${i18n('apps')}</h2>`;
        h += '<span class="bento-card-fancy-subtitle">';
        h +=
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
        h += i18n('recently_used');
        h += '</span>';
        h += '</div>';
        h += '</a>';
        h += '<div class="bento-recent-apps-container">';
        h += buildRecentAppsHTML();
        h += '</div>';
        h += '</div>';

        // Usage card (spans full width on second row)
        h += '<div class="bento-card bento-usage">';
        h +=
            '<a href="#usage" class="bento-card-fancy-header" data-target-tab="usage">';
        h += '<div class="bento-card-fancy-icon bento-card-fancy-icon-usage">';
        h +=
            '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 4a.5.5 0 0 1 .5.5V6a.5.5 0 0 1-1 0V4.5A.5.5 0 0 1 8 4M3.732 5.732a.5.5 0 0 1 .707 0l.915.914a.5.5 0 1 1-.708.708l-.914-.915a.5.5 0 0 1 0-.707M2 10a.5.5 0 0 1 .5-.5h1.586a.5.5 0 0 1 0 1H2.5A.5.5 0 0 1 2 10m9.5 0a.5.5 0 0 1 .5-.5h1.5a.5.5 0 0 1 0 1H12a.5.5 0 0 1-.5-.5m.754-4.246a.39.39 0 0 0-.527-.02L7.547 9.31a.91.91 0 1 0 1.302 1.258l3.434-4.297a.39.39 0 0 0-.029-.518z"/><path fill-rule="evenodd" d="M0 10a8 8 0 1 1 15.547 2.661c-.442 1.253-1.845 1.602-2.932 1.25C11.309 13.488 9.475 13 8 13c-1.474 0-3.31.488-4.615.911-1.087.352-2.49.003-2.932-1.25A8 8 0 0 1 0 10m8-7a7 7 0 0 0-6.603 9.329c.203.575.923.876 1.68.63C4.397 12.533 6.358 12 8 12s3.604.532 4.923.96c.757.245 1.477-.056 1.68-.631A7 7 0 0 0 8 3"/></svg>';
        h += '</div>';
        h += '<div class="bento-card-fancy-text">';
        h += `<h2>${i18n('usage')}</h2>`;
        h += '<span class="bento-card-fancy-subtitle">';
        h +=
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>';
        h += i18n('monthly_overview');
        h += '</span>';
        h += '</div>';
        h += '</a>';
        h += '<div class="bento-usage-container">';
        h += buildUsageHTML();
        h += '</div>';
        h += '</div>';

        // Open Desktop card (spans full width, links to the desktop interface)
        h +=
            '<a href="/desktop" target="_blank" rel="noopener" class="bento-card bento-desktop allow-native-ctxmenu">';
        h +=
            '<div class="bento-card-fancy-icon bento-card-fancy-icon-desktop">';
        h +=
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
        h += '</div>';
        h += '<div class="bento-card-fancy-text">';
        h += `<h2>${i18n('open_desktop')}</h2>`;
        h += '<span class="bento-card-fancy-subtitle">';
        h +=
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
        h += i18n('open_desktop_hint');
        h += '</span>';
        h += '</div>';
        h += '<span class="bento-desktop-arrow">›</span>';
        h += '</a>';

        h += '</div>';
        return h;
    },

    init($el_window) {
        this.loadRecentApps($el_window);
        this.loadUsageData($el_window);
        // Auto-refresh sources:
        //   1. `puter:subscription:changed` — fired by upgrade dialog
        //      after subscribe / change / cancel / uncancel.
        //   2. Visibility / focus — user returning to puter (e.g. from
        //      Stripe Customer Portal in another tab). Portal mutations
        //      bypass our dispatch, so we re-pull state + broadcast.
        // Deliberate refreshes (subscription changed, returning from the
        // billing portal) must bypass the freshness window — they exist to
        // replace state we already know is stale.
        const refresh = () => this.loadUsageData($el_window, { force: true });
        const refreshAndBroadcast = async () => {
            // Pull fresh whoami, then broadcast. The dispatched event is handled
            // by the `refresh` listener below, so we don't call refresh() here —
            // doing both is what caused every focus to fire duplicate reloads.
            // The broadcast is the only thing that triggers the refresh, so cap
            // the wait: a whoami that never settles (hung connection) must not
            // leave the cards stale for the rest of the session.
            try {
                await Promise.race([
                    window.refresh_user_data?.(puter.authToken),
                    new Promise((resolve) => setTimeout(resolve, 8000)),
                ]);
            } catch {}
            try {
                window.dispatchEvent(
                    new CustomEvent('puter:subscription:changed'),
                );
            } catch {}
        };
        window.addEventListener('puter:subscription:changed', refresh);
        // A single return-to-tab fires both `focus` and `visibilitychange`;
        // coalesce them so we don't run the refresh (and refresh_user_data)
        // twice in a row.
        let refreshCoalesceTimer = null;
        const scheduleRefreshAndBroadcast = () => {
            if (refreshCoalesceTimer) return;
            refreshCoalesceTimer = setTimeout(() => {
                refreshCoalesceTimer = null;
            }, 500);
            refreshAndBroadcast();
        };
        const onVisibility = () => {
            if (document.visibilityState === 'visible')
                scheduleRefreshAndBroadcast();
        };
        document.addEventListener('visibilitychange', onVisibility);
        // `focus` also fires whenever focus comes back from an app's iframe,
        // which never left Puter; only a return from another window counts.
        let leftPage = false;
        window.addEventListener('blur', () => {
            setTimeout(() => {
                leftPage = !document.hasFocus();
            }, 0);
        });
        window.addEventListener('focus', () => {
            if (!leftPage) return;
            leftPage = false;
            scheduleRefreshAndBroadcast();
        });

        // Handle app clicks
        $el_window.on('click', '.bento-recent-app', function (e) {
            e.preventDefault();
            e.stopPropagation();
            // The first click of a double-click already opened the app; the
            // second would open another tab of it, as an Apps tile won't.
            if ((e.detail ?? 0) > 1) return;
            const appName = $(this).attr('data-app-name');
            const targetLink = $(this).attr('data-target-link');
            if (targetLink && targetLink !== '') {
                window.open(targetLink, '_blank', 'noopener,noreferrer');
            } else if (appName) {
                window.open(`/app/${encodeURIComponent(appName)}`, '_blank', 'noopener,noreferrer');
            }
        });

        // Handle "View details" link clicks
        $el_window.on(
            'click',
            '.bento-view-more, .bento-usage-card-header, .bento-card-fancy-header[data-target-tab]',
            function (e) {
                // A modified click opens the tab in a new browser tab, natively,
                // as on the sidebar.
                if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                e.preventDefault();
                const targetTab = $(this).attr('data-target-tab');
                if (targetTab) {
                    // Trigger click on the corresponding sidebar item
                    $el_window
                        .find(
                            `.dashboard-sidebar-item[data-section="${targetTab}"]`,
                        )
                        .click();
                }
            },
        );

        // Handle "Save Account" warning click
        $el_window.on('click', '.bento-save-account-warning', function (e) {
            e.preventDefault();
            e.stopPropagation();
            // As from the user menu: the temporary username comes prefilled.
            UIWindowSaveAccount({
                send_confirmation_code: false,
                default_username: window.user.username,
                window_options: {
                    backdrop: true,
                    close_on_backdrop_click: true,
                    parent_center: true,
                    stay_on_top: true,
                    has_head: false,
                    is_draggable: false,
                    draggable_body: false,
                },
            }).then(function (is_saved) {
                if (is_saved) {
                    $el_window.find('.bento-save-account-warning').hide();
                }
            });
        });
    },

    async loadRecentApps($el_window) {
        // Always refetch: gating on an empty list froze "Recently used" for the
        // whole session (apps launched after load never appeared). loadUsageData
        // refreshes on the same activate/focus triggers, so this stays in step.
        // Only the newest request may write: an older one answering last
        // would put a stale list back.
        const seq = (this._recentAppsSeq = (this._recentAppsSeq ?? 0) + 1);
        try {
            const launchApps = await $.ajax({
                url: `${window.api_origin}/get-launch-apps?icon_size=64`,
                type: 'GET',
                async: true,
                contentType: 'application/json',
                headers: {
                    Authorization: `Bearer ${window.auth_token}`,
                },
            });
            if (seq !== this._recentAppsSeq) return;
            window.launch_apps = launchApps;
            recentAppsState = 'loaded';
        } catch (e) {
            console.error('Failed to load launch apps:', e);
            // A list already shown stays; it is only out of date.
            if (recentAppsState === 'loading') recentAppsState = 'failed';
        }
        if (seq !== this._recentAppsSeq) return;
        $el_window
            .find('.bento-recent-apps-container')
            .html(buildRecentAppsHTML());
    },

    // `init()` runs for every tab and `onActivate()` fires again for the
    // active one (and again on back/forward routing), so a single dashboard
    // open lands here several times in quick succession — each pass costing
    // three API calls that compete for connections with whatever app is
    // launching. Concurrent callers share one in-flight load, and repeats
    // arriving while the data is still fresh are dropped.
    //
    // `force` bypasses the freshness window for the callers that exist
    // precisely to pull new state (subscription change, returning from the
    // billing portal) — those must never be served a cached decision.
    async loadUsageData($el_window, { force = false } = {}) {
        if (this._usageLoadInFlight) {
            if (!force) return this._usageLoadInFlight;
            // The running load may have read the state before the change
            // that forced this one, so run once more after it.
            this._usageForcedReload ??= this._usageLoadInFlight
                .catch(() => {})
                .then(() => {
                    this._usageForcedReload = null;
                    return this.loadUsageData($el_window, { force: true });
                });
            return this._usageForcedReload;
        }
        if (
            !force &&
            this._usageLoadedAt &&
            Date.now() - this._usageLoadedAt < USAGE_REFRESH_DEBOUNCE_MS
        ) {
            return;
        }

        this._usageLoadInFlight = this._loadUsageDataUncached($el_window);
        try {
            return await this._usageLoadInFlight;
        } finally {
            this._usageLoadInFlight = null;
            this._usageLoadedAt = Date.now();
        }
    },

    /**
     * The plan card, read live rather than from the whoami copy, which goes
     * stale. Not knowing the plan is not the same as being on the free one,
     * so a read that fails returns without touching the card.
     */
    async _renderPlanCard($el_window) {
        let subscription = null;
        // A self-hosted install has no billing routes; its users have the
        // plan every account starts on, with nothing to upgrade to (no
        // upgrade dialog either, which only hosted Puter loads).
        let noBilling = false;
        try {
            // fetch has no timeout of its own; one that never answers would
            // hold every later refresh of the cards behind it.
            const resp = await fetch(
                `${window.api_origin}/marketplace/subscriptions/current`,
                {
                    headers: { Authorization: `Bearer ${puter.authToken}` },
                    signal: AbortSignal.timeout?.(PLAN_REQUEST_TIMEOUT_MS),
                },
            );
            noBilling = resp.status === 404;
            // A refusal is not a free plan: a seat owing a password change 403s.
            if (!resp.ok && !noBilling) return;
            const data = noBilling ? null : await resp.json();
            subscription = data?.subscription ?? null;
        } catch (e) {
            console.error('Failed to load plan data:', e);
            return;
        }

        try {

            const pastDue =
                !!subscription && subscription.status === 'past_due';
            const trialing =
                !!subscription && subscription.status === 'trialing';
            // `past_due` keeps benefits during Stripe's dunning window, so
            // it still counts as having a plan — we just flag it.
            const hasSubscription =
                !!subscription &&
                (subscription.status === 'active' ||
                    trialing ||
                    subscription.status === 'cancel_pending' ||
                    pastDue);
            const planName = subscription?.tier || 'free';
            const seat = isOrgSeat(window.user);
            const teamName = orgSeatTeamName(window.user);
            const trialEnds = trialing
                ? formatTrialEnd(subscription.trialEndsAt)
                : null;

            // A team tier has no translation key, so i18n would echo the id.
            $el_window
                .find('.bento-plan-name')
                .text(subscription?.offering?.name_en || i18n(planName));

            // Reset state-dependent classes / warning each (re)render.
            const $badge = $el_window
                .find('.bento-plan-badge')
                .removeClass('active free past-due trial');
            const $warning = $el_window
                .find('.bento-plan-warning')
                .hide()
                .text('');
            const $note = $el_window.find('.bento-plan-note').hide().text('');

            if (hasSubscription) {
                if (pastDue) {
                    $badge.text(i18n('plan_past_due', [], false)).addClass('past-due');
                    $warning
                        .text(i18n('plan_past_due_warning', [], false))
                        .show();
                } else if (trialing) {
                    // This is a glance surface sitting between two usage
                    // meters, so the trial gets the same two lines they get:
                    // how much is left, then the one consequence worth
                    // knowing. Billing carries the full sentence and the
                    // opt-out — "Manage →" is directly below.
                    $badge
                        .text(
                            trialEnds
                                ? i18n('free_trial_countdown', { countdown: trialEnds.countdown }, false)
                                : i18n('free_trial', [], false),
                        )
                        .addClass('trial');
                    const usage = trialUsageNote(
                        subscription.trialUsageFraction,
                        subscription?.offering?.name_en || i18n(planName),
                    );
                    $note
                        .text(
                            (usage ? `${usage} ` : '') +
                                (trialEnds
                                    ? i18n('trial_first_charge', { date: trialEnds.short }, false)
                                    : i18n('trial_continues_paid', [], false)),
                        )
                        .show();
                } else {
                    $badge.text(i18n('plan_current', [], false)).addClass('active');
                }
                $el_window.find('.bento-plan-upgrade').text(i18n('plan_manage_link', [], false)).show();
            } else {
                $badge
                    .text(
                        seat
                            ? i18n('plan_team_seat')
                            : i18n('plan_upgrade_hint', [], false),
                    )
                    .addClass('free');
                // Reset the label too — otherwise it keeps saying "Manage →"
                // after a subscription lapses/cancels.
                $el_window.find('.bento-plan-upgrade').text(i18n('plan_upgrade_link', [], false)).show();
            }

            // A seat cannot change its plan, so name who can.
            if (seat && teamName) {
                $note.text(i18n('plan_team_managed', [teamName], false)).show();
            }

            // A seat's plan is the team's; the link only reaches a refusal.
            if (seat) {
                $el_window.find('.bento-plan-upgrade').hide();
            }

            if (noBilling && typeof window.UIUpgradeAccount !== 'function') {
                $badge.text('').removeClass('free');
                $el_window.find('.bento-plan-upgrade').hide();
            }

            $el_window
                .find('.bento-plan-upgrade')
                .off('click.billing')
                .on('click.billing', (e) => {
                    e.preventDefault();
                    if (typeof window.UIUpgradeAccount === 'function') {
                        new window.UIUpgradeAccount().open_as_window();
                    }
                });
        } catch (e) {
            console.error('Failed to render plan card:', e);
        }
    },

    async _loadUsageDataUncached($el_window) {
        // Side by side: neither meter needs the plan, and a slow plan read
        // must not hold them at "--".
        await Promise.all([
            this._renderPlanCard($el_window),
            this._renderStorageCard($el_window),
            this._renderResourcesCard($el_window),
        ]);
    },

    async _renderStorageCard($el_window) {
        try {
            const res = await getStorageSpace();
            // Guard capacity 0 — 0/0 would render literally as "NaN%".
            const usage_percentage = res.capacity
                ? Math.min(100, meterPercent((res.used / res.capacity) * 100))
                : 0;

            let general_used = res.used;
            if (res.host_used) {
                general_used = res.host_used;
            }

            $el_window
                .find('.bento-storage-used')
                .text(i18n('amount_used', { amount: window.byte_format(general_used) }, false));
            $el_window
                .find('.bento-storage-capacity')
                .text(window.byte_format(res.capacity));
            $el_window
                .find('.bento-storage-percent')
                .text(`${usage_percentage}%`);
            $el_window.find('.bento-storage-bar').css({
                width: `${usage_percentage}%`,
                'background-color': window.usage_bar_color(usage_percentage),
            });
        } catch (e) {
            console.error('Failed to load storage data:', e);
        }
    },

    async _renderResourcesCard($el_window) {
        try {
            const res = monthlyUsageOrThrow(await getMonthlyUsage());
            const budget = usageBudget(res.usage, res.allowanceInfo);
            const addonLeft = addonCreditsRemaining(res.allowanceInfo);
            // The server reports credits (already scaled) or raw amounts
            // (no multiplier configured), and says which via the unit flag.
            const inCredits = usageIsCredits(res.allowanceInfo);
            const amount = (v) => inCredits
                ? formatCredits(v)
                : formatDollarsFromMicrocents(v);

            $el_window
                .find('.bento-resources-used')
                .text(i18n('amount_used', { amount: amount(budget.used) }, false));
            $el_window
                .find('.bento-resources-capacity')
                .text(
                    inCredits
                        ? `${amount(budget.capacity)} ${i18n(addonLeft === null ? 'usage_credits' : 'monthly_credits')}`
                        : amount(budget.capacity),
                );
            $el_window
                .find('.bento-resources-addon')
                .html(addonLeft === null
                    ? ''
                    : i18n('addon_credits_available', { amount: amount(addonLeft) }))
                .toggle(addonLeft !== null);
            $el_window
                .find('.bento-resources-percent')
                .text(`${budget.percent}%`);
            $el_window.find('.bento-resources-bar').css({
                width: `${budget.barPercent}%`,
                'background-color': window.usage_bar_color(budget.barPercent),
            });
        } catch (e) {
            console.error('Failed to load monthly usage data:', e);
        }
    },

    onActivate($el_window) {
        this.loadRecentApps($el_window);
        this.loadUsageData($el_window);
    },
};

export default TabHome;
