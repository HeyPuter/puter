/**
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

// Usage
export default {
    id: 'usage',
    title_i18n_key: 'usage',
    icon: 'speedometer-outline.svg',
    html: () => {
        return `
            <h1 class="settings-section-header">${i18n('usage')}<button class="update-usage-details"><svg class="update-usage-details-icon" xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="currentColor" class="bi bi-arrow-clockwise" viewBox="0 0 16 16"> <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/> <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/> </svg></button></h1>
            <div class="driver-usage">
                <div class="storage-section">
                    <div class="storage-header">
                        <h3 class="storage-title">${i18n('Storage')}</h3>
                        <div class="storage-stats">
                            <span id="storage-used" class="storage-amount"></span>
                            <span class="storage-separator">/</span>
                            <span id="storage-capacity" class="storage-amount"></span>
                        </div>
                    </div>
                    <div class="usage-progbar-wrapper">
                        <div class="usage-progbar" id="storage-bar">
                            <span class="usage-progbar-percent" id="storage-used-percent"></span>
                        </div>
                    </div>
                    <div id="storage-puter-used-w" class="storage-puter-info">
                        <span id="storage-puter-used"></span>
                    </div>
                </div>
                <div class="driver-usage-container">
                    <div class="driver-usage-header">
                        <h3 class="driver-usage-title">${i18n('Resources')}</h3>
                        <div class="driver-usage-stats">
                            <span id="total-usage"></span>
                            <span> used of </span>
                            <span id="total-capacity"></span>
                        </div>
                    </div>
                    <div class="usage-progbar-wrapper">
                        <div class="usage-progbar" id="resources-bar">
                            <span class="usage-progbar-percent" id="resources-used-percent"></span>
                        </div>
                    </div>
                    <div class="driver-usage-details driver-usage-details-section">
                        <div class="caret"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-caret-right-fill" viewBox="0 0 16 16"><path d="m12.14 8.753-5.482 4.796c-.646.566-1.658.106-1.658-.753V3.204a1 1 0 0 1 1.659-.753l5.48 4.796a1 1 0 0 1 0 1.506z"/></svg></div>
                        <span class="driver-usage-details-text disable-user-select">${i18n('view_usage_details')}</span>
                    </div>
                    <div class="driver-usage-details-content hide-scrollbar">
                    </div>
                </div>
            </div>`;
    },
    init: ($el_window) => {
        update_usage_details($el_window);
        $($el_window).find('.update-usage-details').on('click', function() {
            update_usage_details($el_window);
        });
    },
};

$(document).on('click', '.driver-usage-details', function() {
    $('.driver-usage-details-content').toggleClass('active');
    $('.driver-usage-details').toggleClass('active');

    // change the text of the driver-usage-details-text depending on the class
    if ( $('.driver-usage-details').hasClass('active') ){
        $('.driver-usage-details-text').text(i18n('hide_usage_details'));
    } else {
        $('.driver-usage-details-text').text(i18n('view_usage_details'));
    }
});

async function update_usage_details($el_window){
    // Add spinning animation and record start time
    const startTime = Date.now();
    $($el_window).find('.update-usage-details-icon').css('animation', 'spin 1s linear infinite');

    const monthlyUsagePromise = puter.auth.getMonthlyUsage().then(res => {
        let monthlyAllowance = res.allowanceInfo?.monthUsageAllowance;
        let remaining = res.allowanceInfo?.remaining;
        let totalUsage = monthlyAllowance - remaining;
        let totalUsagePercentage = (totalUsage / monthlyAllowance * 100).toFixed(0);

        $('#total-usage').html(window.number_format(totalUsage / 100_000_000, { decimals: 2, prefix: '$' }));
        $('#total-capacity').html(window.number_format(monthlyAllowance / 100_000_000, { decimals: 2, prefix: '$' }));
        $('#resources-used-percent').html(`${totalUsagePercentage}%`);
        $('#resources-bar').css('width', `${totalUsagePercentage}%`);

        const tableRows = Object.keys(res.usage)
            .filter(key => typeof res.usage[key] === 'object')
            .map(key => {
                let units = res.usage[key].units;

                // Bytes should be formatted as human readable
                if (key.startsWith('filesystem:') && key.endsWith(':bytes')) {
                    units = window.byte_format(units);
                }
                // Everything else should be formatted as a number
                else {
                    units = window.number_format(units, { decimals: 0, thousandSeparator: ',' });
                }

                return `
                    <tr>
                        <td title="${key}">${key}</td>
                        <td>${units}</td>
                        <td>${window.number_format(res.usage[key].cost / 100_000_000, { decimals: 2, prefix: '$' })}</td>
                    </tr>
                `;
            }).join('');

        const h = `
            <table class="driver-usage-details-content-table">
                <thead>
                    <tr>
                        <th>${i18n('resource')}</th>
                        <th>${i18n('resource_units')}</th>
                        <th>${i18n('resource_cost')}</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        `;

        $('.driver-usage-details-content').html(h);
    });

    const spacePromise = puter.fs.space().then(res => {
        const used = res.host_used || res.used;
        let usage_percentage = (used / res.capacity * 100).toFixed(0);
        usage_percentage = usage_percentage > 100 ? 100 : usage_percentage;

        if ( res.host_used ) {
            $('#storage-puter-used').html(`Puter is using ${window.byte_format(res.used)}`);
            $('#storage-puter-used-w').addClass('visible');
        }

        $('#storage-used').html(window.byte_format(used));
        $('#storage-capacity').html(window.byte_format(res.capacity));
        $('#storage-used-percent').html(`${usage_percentage}%`);
        $('#storage-bar').css('width', `${usage_percentage}%`);

        if ( usage_percentage >= 100 ) {
            $('#storage-bar').css({
                'border-top-right-radius': '3px',
                'border-bottom-right-radius': '3px',
            });
        }
    });

    // Wait for both promises to complete
    await Promise.all([monthlyUsagePromise, spacePromise]);

    // Ensure spinning continues for at least 1 second
    const elapsed = Date.now() - startTime;
    const minDuration = 1000; // 1 second
    if ( elapsed < minDuration ) {
        await new Promise(resolve => setTimeout(resolve, minDuration - elapsed));
    }

    // Remove spinning animation
    $($el_window).find('.update-usage-details-icon').css('animation', '');
}