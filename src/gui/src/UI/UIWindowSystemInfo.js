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

function filesize (bytes) {
    if ( bytes === 0 ) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2)) } ${ sizes[i]}`;
}

import UIWindow from './UIWindow.js';

const UIWindowSystemInfo = async function UIWindowSystemInfo () {
    // Basic HTML Structure
    let h = `
        <div class="system-info-container" style="display: flex; flex-direction: column; height: 100%; padding: 20px; box-sizing: border-box; overflow-y: auto;">
            <style>
                .system-info-section {
                    margin-bottom: 24px;
                    background: rgba(255, 255, 255, 0.5);
                    border-radius: 8px;
                    padding: 16px;
                }
                .system-info-section h3 {
                    margin-top: 0;
                    margin-bottom: 12px;
                    font-size: 16px;
                    border-bottom: 1px solid rgba(0,0,0,0.1);
                    padding-bottom: 8px;
                }
                .info-row {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 8px;
                    font-size: 14px;
                }
                .info-label {
                    font-weight: 500;
                    color: #555;
                }
                .info-value {
                    font-weight: 400;
                    color: #000;
                    text-align: right;
                }
            </style>
            
            <div class="system-info-section" id="client-info">
                <h3>Client Information</h3>
                <div class="info-row"><span class="info-label">Browser:</span> <span class="info-value" id="si-browser">Loading...</span></div>
                <div class="info-row"><span class="info-label">OS (Client):</span> <span class="info-value" id="si-client-os">Loading...</span></div>
                <div class="info-row"><span class="info-label">Screen Resolution:</span> <span class="info-value" id="si-screen">Loading...</span></div>
                <div class="info-row"><span class="info-label">Cores (Logical):</span> <span class="info-value" id="si-cores-client">Loading...</span></div>
                <div class="info-row"><span class="info-label">Memory (Device):</span> <span class="info-value" id="si-mem-client">Loading...</span></div>
            </div>

            <div class="system-info-section" id="server-info">
                <h3>Server Information</h3>
                <div class="info-row"><span class="info-label">OS (Server):</span> <span class="info-value" id="si-server-os">Loading...</span></div>
                <div class="info-row"><span class="info-label">CPU Model:</span> <span class="info-value" id="si-cpu-model">Loading...</span></div>
                <div class="info-row"><span class="info-label">CPU Cores:</span> <span class="info-value" id="si-cpu-cores">Loading...</span></div>
                <div class="info-row"><span class="info-label">Memory (Total):</span> <span class="info-value" id="si-mem-total">Loading...</span></div>
                <div class="info-row"><span class="info-label">Memory (Free):</span> <span class="info-value" id="si-mem-free">Loading...</span></div>
                <div class="info-row"><span class="info-label">Uptime:</span> <span class="info-value" id="si-uptime">Loading...</span></div>
            </div>

             <div class="system-info-section" id="account-info">
                <h3>Account Resources</h3>
                <div class="info-row"><span class="info-label">Username:</span> <span class="info-value" id="si-username">Loading...</span></div>
                <div class="info-row"><span class="info-label">UUID:</span> <span class="info-value" id="si-uuid">Loading...</span></div>
                <!-- Storage info could go here if available via API -->
            </div>

        </div>
    `;

    const win = await UIWindow({
        title: 'System Information',
        icon: window.icons['system-monitor.svg'] || window.icons['cog.svg'], // Fallback icon
        width: 450,
        height: 550,
        is_resizable: true,
        is_maximizable: false,
        center: true,
        body_content: h,
    });

    $(win).css('background-color', '#f5f5f5');

    // --- Populate Client Info ---
    const ua = navigator.userAgent;
    let browserName = 'Unknown';
    if ( ua.indexOf('Firefox') > -1 ) browserName = 'Mozilla Firefox';
    else if ( ua.indexOf('SamsungBrowser') > -1 ) browserName = 'Samsung Internet';
    else if ( ua.indexOf('Opera') > -1 || ua.indexOf('OPR') > -1 ) browserName = 'Opera';
    else if ( ua.indexOf('Trident') > -1 ) browserName = 'Microsoft Internet Explorer';
    else if ( ua.indexOf('Edge') > -1 ) browserName = 'Microsoft Edge';
    else if ( ua.indexOf('Chrome') > -1 ) browserName = 'Google Chrome';
    else if ( ua.indexOf('Safari') > -1 ) browserName = 'Apple Safari';

    $(win).find('#si-browser').text(browserName);
    $(win).find('#si-client-os').text(navigator.platform);
    $(win).find('#si-screen').text(`${window.screen.width} x ${window.screen.height}`);
    $(win).find('#si-cores-client').text(navigator.hardwareConcurrency || 'Unknown');
    $(win).find('#si-mem-client').text(navigator.deviceMemory ? `~${navigator.deviceMemory} GB` : 'Unknown');

    // --- Populate Account Info ---
    $(win).find('#si-username').text(window.user.username);
    $(win).find('#si-uuid').text(window.user.uuid);

    // --- Fetch Server Info ---
    try {
        const response = await fetch(`${window.api_origin}/system-info/get`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${puter.authToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
        });

        if ( response.ok ) {
            const data = await response.json();

            let osDisplay = `${data.os.type} ${data.os.release} (${data.os.arch})`;
            if ( data.os.distro ) {
                osDisplay = `${data.os.distro} (${data.os.arch})`;
            }

            $(win).find('#si-server-os').text(osDisplay);
            $(win).find('#si-cpu-model').text(data.cpu.model);
            $(win).find('#si-cpu-cores').text(data.cpu.cores);
            $(win).find('#si-mem-total').text(data.memory.total ? window.byte_format(data.memory.total) : 'Unknown');
            $(win).find('#si-mem-free').text(data.memory.free ? window.byte_format(data.memory.free) : 'Unknown');

            // Format uptime
            const uptime = data.uptime;
            const days = Math.floor(uptime / (3600 * 24));
            const hours = Math.floor(uptime % (3600 * 24) / 3600);
            const minutes = Math.floor(uptime % 3600 / 60);
            const seconds = Math.floor(uptime % 60);

            let uptimeStr = '';
            if ( days > 0 ) uptimeStr += `${days}d `;
            if ( hours > 0 ) uptimeStr += `${hours}h `;
            if ( minutes > 0 ) uptimeStr += `${minutes}m `;
            uptimeStr += `${seconds}s`;

            $(win).find('#si-uptime').text(uptimeStr);

        } else {
            console.error('Failed to fetch system info', response);
            $(win).find('#server-info .info-value').text('Error fetching data');
        }
    } catch ( err ) {
        console.error('Error calling system info API', err);
        $(win).find('#server-info .info-value').text('Error');
    }

    return win;
};

export default UIWindowSystemInfo;
