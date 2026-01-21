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
    let clientInfo = [];

    // Get browser & OS info
    if ( navigator.userAgentData ) {
        const uaData = await navigator.userAgentData.getHighEntropyValues([
            'platform', 'platformVersion', 'model', 'fullVersionList',
        ]);

        const browser = uaData.brands?.[0]?.brand || 'Unknown';
        const browserVersion = uaData.brands?.[0]?.version || 'Unknown';
        const os = uaData.platform || 'Unknown';
        const osVersion = uaData.platformVersion || 'Unknown';

        clientInfo.push ({
            key: 'browser',
            icon: 'system-info-browser.svg',
            i18n_key: 'browser',
            title: i18n('browser'),
            value: `${browser} ${browserVersion}`,
        },
        {
            key: 'os',
            icon: 'system-info-os.svg',
            i18n_key: 'system-info-os',
            title: i18n('os'),
            value: `${os} ${osVersion}`,
        });
    } else {
        // Fallback for older browsers
        const userAgent = navigator.userAgent;
        let os = 'Unknown';
        if ( /Win/.test(userAgent) ) os = 'Windows';
        else if ( /Mac/.test(userAgent) ) os = 'macOS';
        else if ( /Linux/.test(userAgent) ) os = 'Linux';
        else if ( /Android/.test(userAgent) ) os = 'Android';
        else if ( /iPhone|iPad|iPod/.test(userAgent) ) os = 'iOS';

        clientInfo.push({
            key: 'os',
            icon: 'system-info-os.svg',
            i18n_key: 'os',
            title: i18n('os'),
            value: os,
        });
    }

    // Get hardware info
    const cpuCores = navigator.hardwareConcurrency || 'Unknown';
    const ram = navigator.deviceMemory ? `${navigator.deviceMemory} GB (approx)` : 'Unknown';

    clientInfo.push({
        key: 'cpu_cores',
        icon: 'system-info-cpu.svg',
        i18n_key: 'cpu_cores',
        title: i18n('cpu_cores'),
        value: `${cpuCores} cores`,
    },
    {
        key: 'ram',
        icon: 'system-info-ram.svg',
        i18n_key: 'ram',
        title: i18n('ram'),
        value: ram,
    });

    // Get screen info
    const screenResolution = `${window.screen.width}x${window.screen.height}`;
    const pixelRatio = window.devicePixelRatio;
    const colorDepth = window.screen.colorDepth;

    clientInfo.push({
        key: 'screen_resolution',
        icon: 'system-info-screen.svg',
        i18n_key: 'screen_resolution',
        title: i18n('screen_resolution'),
        value: screenResolution,
    },
    {
        key: 'pixel_ratio',
        icon: 'system-info-pixel.svg',
        i18n_key: 'pixel_ratio',
        title: i18n('pixel_ratio'),
        value: `${pixelRatio}x`,
    },
    {
        key: 'color_depth',
        icon: 'system-info-color.svg',
        i18n_key: 'color_depth',
        title: i18n('color_depth'),
        value: `${colorDepth} bits`,
    });

    return clientInfo;
}

function renderSystemInfo ( information ) {
    let html = '';
    for ( const info of information ) {
        html += `<div class="systeminfo-item">
                    <h3 class='systeminfo-title'>${info.title}</h3>
                    <div class='systeminfo-value'>
                        <img src='${window.icons[info.icon]}' class="systeminfo-icon" alt='${info.i18n} image'>
                        ${info.value}
                    </div>
                </div>`;
    }
    return html;
}

async function UIWindowSystemInfo (options) {
    return new Promise(async (resolve) => {
        // Build client & Server containers & headers
        const h = `<div class="systeminfo-container">
                       <div class="clientinfo-container">
                           <h1>${i18n('client_information')}
                               <button class="update-usage-details" style="float:right;">
                                   <svg class="update-usage-details-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                       <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/>
                                       <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/>
                                   </svg>
                               </button>
                           </h1>
                           <div class="clientinfo-content"></div>
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
            height: 540,
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

        // Inject client info on launch
        const clientInfo = await getClientInfo();
        const clientInfohtml = renderSystemInfo(clientInfo);
        $win.find('.clientinfo-content').html(clientInfohtml);

        // Spin both reset buttons once on launch
        const $icons = $win.find('.update-usage-details-icon');
        $icons.addClass('spin-once');

        // Refresh button onclick event
        $win.on('click', '.update-usage-details', async function () {
            triggerRefreshBtnAnimation($(this));
            const clientInfo = await getClientInfo();
            const clientInfohtml = renderSystemInfo(clientInfo);
            $win.find('.clientinfo-content').html(clientInfohtml);
        });

        resolve(el_window);
    });
}

export default UIWindowSystemInfo;