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
