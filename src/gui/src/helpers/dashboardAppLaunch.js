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

import UIAlert from '../UI/UIAlert.js';
import launch_app from './launchApp.js';
import { focusExistingAppWindow } from './focusAppWindow.js';
import { offerAppTabLaunch } from './appTabLaunch.js';
import { appendLaunchContext } from './appLaunchUrl.js';
import { fetchUserAppTokenForLaunch } from './appLaunchApi.js';
import { uuidv4 } from './uuidv4.js';
import { forgetRecentFile } from './recentFiles.js';

/** The desktop interface, served as its own site. */
export const DESKTOP_URL = 'https://desktop.puter.com/';

// Apps whose launch is still fetching; a second click would open a second tab.
const launching = new Set();

/**
 * Opens an app from the dashboard in a new browser tab at its own URL. When
 * the browser refuses the tab, the app opens in this page instead, reusing a
 * window that's already open. Call it inside the click, so popup blockers
 * allow the tab.
 *
 * @param {string} appName
 */
export function openAppInNewTab (appName) {
    if ( launching.has(appName) ) return;
    // Without 'noopener': the app's SDK asks this tab for its token through
    // the opener, then clears it.
    const tab = window.open('', '_blank');
    if ( !tab && focusExistingAppWindow(appName) ) return;
    launching.add(appName);
    // The launch owns the tab from here, and closes it on failure.
    return launch_app(tab ? { name: appName, newTab: tab, trigger: 'app_icon' } : { name: appName, maximized: true, trigger: 'app_icon' })
        .catch((err) => {
            console.error(`Failed to launch ${appName}:`, err);
            UIAlert(i18n('something_went_wrong', [], false));
        })
        .finally(() => launching.delete(appName));
}

// Recently opened files whose launch is still on its way, by uid.
const launchingFiles = new Set();

/** Whether a failed `puter.fs.stat` means the file is gone or out of reach. */
const isUnavailable = e =>
    e?.code === 'subject_does_not_exist' || e?.status === 404 || e?.status === 403;

/**
 * Opens a recently opened file from the dashboard in a new browser tab, with
 * the app it was last opened with. A file that's gone or in the Trash is
 * taken off the list instead. Call it inside the click, so popup blockers
 * allow the tab.
 *
 * @param {import('./recentFiles.js').RecentFile} file
 * @returns {Promise<void>}
 */
export async function openRecentFileInNewTab (file) {
    if ( launchingFiles.has(file.uid) ) return;
    // Without 'noopener': the app's SDK asks this tab for its token.
    const tab = window.open('', '_blank');
    launchingFiles.add(file.uid);
    const gone = () => {
        tab?.close();
        void forgetRecentFile(file.uid);
        // Unencoded: UIAlert encodes its message itself.
        return UIAlert(i18n('recent_file_unavailable', { name: file.name }, false));
    };
    try {
        let fsentry;
        try {
            fsentry = await puter.fs.stat({ uid: file.uid });
        } catch ( err ) {
            if ( isUnavailable(err) ) return await gone();
            throw err;
        }
        if ( fsentry.is_dir || fsentry.path?.startsWith(`${window.trash_path}/`) ) return await gone();
        // The launch owns the tab from here, and closes it on failure.
        await launch_app({
            name: file.appName,
            file_uid: fsentry.uid,
            file_path: fsentry.path,
            window_title: fsentry.name,
            ...(tab ? { newTab: tab } : { maximized: true }),
            trigger: 'file_open',
        });
    } catch ( err ) {
        console.error(`Failed to open ${file.name}:`, err);
        tab?.close();
        UIAlert(i18n('something_went_wrong', [], false));
    } finally {
        launchingFiles.delete(file.uid);
    }
}

// Sites whose launch is still fetching a token; a second click would open a second tab.
const launchingSites = new Set();

/**
 * Opens a Puter site, such as the desktop or the app store, in a new browser
 * tab, launched the way an app's tab is: the launch params go in its URL and
 * its token is handed over through the opener. Without a token the tab still
 * opens, and the site signs in on its own. Call it inside the click, so popup
 * blockers allow the tab.
 *
 * @param {string} siteUrl
 * @returns {Promise<void> | null} null when the browser refused the tab,
 *   leaving the click to the caller's fallback
 */
export function openSiteInNewTab (siteUrl) {
    if ( launchingSites.has(siteUrl) ) return Promise.resolve();
    // Without 'noopener': the site's SDK asks this tab for its token.
    const tab = window.open('', '_blank');
    if ( ! tab ) return null;
    launchingSites.add(siteUrl);
    const url = new URL(siteUrl);
    return fetchUserAppTokenForLaunch({ origin: url.origin })
        .then(({ token, appUid }) => {
            if ( tab.closed ) return;
            if ( token && appUid ) {
                const appInstanceID = uuidv4();
                url.searchParams.append('puter.app_instance_id', appInstanceID);
                url.searchParams.append('puter.app.id', appUid);
                appendLaunchContext(url, {
                    appDomain: window.app_domain,
                    pageUrl: window.location.href,
                    apiOrigin: window.api_origin,
                    locale: window.locale,
                    surface: 'dashboard',
                });
                offerAppTabLaunch({ appInstanceID, tab, origin: url.origin, token, item: null });
            }
            tab.location.href = url.href;
        })
        .finally(() => {
            launchingSites.delete(siteUrl);
        });
}
