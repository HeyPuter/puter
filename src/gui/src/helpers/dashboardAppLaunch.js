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
    return launch_app(tab ? { name: appName, newTab: tab } : { name: appName, maximized: true })
        .catch((err) => {
            console.error(`Failed to launch ${appName}:`, err);
            UIAlert(i18n('something_went_wrong', [], false));
        })
        .finally(() => launching.delete(appName));
}
