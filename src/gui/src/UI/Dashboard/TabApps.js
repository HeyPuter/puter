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

import UIContextMenu from '../UIContextMenu.js';
import UIAlert from '../UIAlert.js';
import launch_app from '../../helpers/launchApp.js';
import revokeAppSessions from '../../helpers/revokeAppSessions.js';
import { begin_dashboard_tile_launch, settle_dashboard_tile_launch } from '../UIWindow.js';
import { createAppBrowser } from './AppBrowser.js';

export default createAppBrowser({
    actions: {
        showContextMenu: UIContextMenu,
        showAlert: UIAlert,
        launchApp: launch_app,
        revokeAppSessions,
        beginTileLaunch: begin_dashboard_tile_launch,
        settleTileLaunch: settle_dashboard_tile_launch,
    },
});
