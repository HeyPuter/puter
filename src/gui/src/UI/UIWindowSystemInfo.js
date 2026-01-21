/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * AGPL-3.0-only
 */

import UIWindow from './UIWindow.js';

const triggerRefreshBtnAnimation = ($btn) => {
    const $icon = $btn.find('.update-usage-details-icon');

    const icon = $icon[0];
    const clone = icon.cloneNode(true);
    // Cloned node required to get animation to play on refresh
    icon.parentNode.replaceChild(clone, icon);
};
// Leverage User-Agent Client Hints API to request user browser information
async function getClientInfo () {
    const clientInfo = {};

    // Get browser & OS info
    if ( navigator.userAgentData ) {
        const uaData = await navigator.userAgentData.getHighEntropyValues([
            'platform', 'platformVersion', 'model', 'fullVersionList',
        ]);

        const browser = uaData.brands?.[0]?.brand || 'Unknown';
        const browserVersion = uaData.brands?.[0]?.version || 'Unknown';
        const os = uaData.platform || 'Unknown';
        const osVersion = uaData.platformVersion || 'Unknown';

        clientInfo.browserInfo = { browser, browserVersion, os, osVersion };
    } else {
        // Fallback for older browsers
        const userAgent = navigator.userAgent;
        let os = 'Unknown';
        if ( /Win/.test(userAgent) ) os = 'Windows';
        else if ( /Mac/.test(userAgent) ) os = 'macOS';
        else if ( /Linux/.test(userAgent) ) os = 'Linux';
        else if ( /Android/.test(userAgent) ) os = 'Android';
        else if ( /iPhone|iPad|iPod/.test(userAgent) ) os = 'iOS';

        clientInfo.browserInfo = { browser: 'Unknown', browserVersion: 'Unknown', os, osVersion: 'Unknown' };
    }

    // Get hardware info
    const cpuCores = navigator.hardwareConcurrency || "Unknown";
    const ramGB = navigator.deviceMemory ? `${navigator.deviceMemory} GB (approx)` : "Unknown";

    clientInfo.hardwareInfo = { cpuCores, ramGB };

    // Get screen info
    const screenResolution = `${window.screen.width}x${window.screen.height}`;
    const pixelRatio = window.devicePixelRatio;
    const colorDepth = window.screen.colorDepth;

    clientInfo.screenInfo = { screenResolution, pixelRatio, colorDepth };

    return clientInfo;
}

const 

async function UIWindowSystemInfo (options) {
    return new Promise(async (resolve) => {
        let h = '';

        h = `<div class="systeminfo-container">
                <div class="clientinfo-container">
                    <h1>${i18n('client_information')}
                        <button class="update-usage-details" style="float:right;">
                            <svg class="update-usage-details-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/>
                                <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/>
                            </svg>
                        </button>
                    </h1>
                </div>
                <div class="serverinfo-container">
                    <h1>${i18n('server_information')}
                        <button class="update-usage-details" style="float:right;">
                            <svg class="update-usage-details-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/>
                                <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/>
                            </svg>
                        </button>
                    </h1>
                </div>
            </div>`;

        const el_window = await UIWindow({
            title: 'System Information',
            app: 'System Information',
            single_instance: true,
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            has_head: true,
            selectable_body: false,
            allow_context_menu: false,
            is_resizable: true,
            is_droppable: false,
            init_center: true,
            allow_native_ctxmenu: true,
            allow_user_select: true,
            backdrop: false,
            width: 560,
            height: 'auto',
            dominant: true,
            show_in_taskbar: true,
            draggable_body: false,
            body_css: {
                width: 'initial',
                height: '100%',
                overflow: 'auto',
            },
            ...options?.window_options ?? {},
        });

        // Scope jQuery to this window
        const $win = $(el_window);

        // Spin both reset buttons once on launch
        const $icons = $win.find('.update-usage-details-icon');
        $icons.addClass('spin-once');

        resolve(el_window);

        // Refresh button onclick event
        $win.on('click', '.update-usage-details', async function () {
            triggerRefreshBtnAnimation($(this));
            const clientInfo = await getClientInfo();

            console.log(clientInfo);
        });
    });
}

export default UIWindowSystemInfo;