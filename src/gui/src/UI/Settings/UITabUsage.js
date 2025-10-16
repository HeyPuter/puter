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
            <h1>${i18n('usage')}<button class="update-usage-details" style="float:right;"><svg class="update-usage-details-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-arrow-clockwise" viewBox="0 0 16 16"> <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/> <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/> </svg></button></h1>
            <div class="driver-usage">
                <div class="driver-usage-header">
                    <h3 style="margin:0; font-size: 14px; flex-grow: 1;">${i18n('storage_usage')}</h3>
                    <div style="font-size: 13px; margin-bottom: 3px;">
                        <span id="storage-used"></span>
                        <span> used of </span>
                        <span id="storage-capacity"></span>
                        <span id="storage-puter-used-w" style="display:none;">&nbsp;(<span id="storage-puter-used"></span> ${i18n('storage_puter_used')})</span>
                    </div>
                </div>
                <div id="storage-bar-wrapper">
                    <span id="storage-used-percent"></span>
                    <div id="storage-bar"></div>
                    <div id="storage-bar-host"></div>
                </div>
                <div class="driver-usage-container" style="margin-top: 30px;">
                    <div class="driver-usage-header">
                        <h3 style="margin:0; font-size: 14px; flex-grow: 1;">${i18n('credits')}</h3>
                        <div style="font-size: 13px; margin-bottom: 3px;">
                            <span id="total-usage"></span>
                            <span> used of </span>
                            <span id="total-capacity"></span>
                        </div>
                    </div>
                    <div class="usage-progbar-wrapper">
                        <div class="usage-progbar" style="width: 0;">
                            <span class="usage-progbar-percent"></span>
                        </div>
                    </div>
                    <div class="driver-usage-details" style="margin-top: 5px; font-size: 13px; cursor: pointer;">
                        <div class="caret"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-caret-right-fill" viewBox="0 0 16 16"><path d="m12.14 8.753-5.482 4.796c-.646.566-1.658.106-1.658-.753V3.204a1 1 0 0 1 1.659-.753l5.48 4.796a1 1 0 0 1 0 1.506z"/></svg></div>
                        <span class="driver-usage-details-text disable-user-select">View usage details</span>
                    </div>
                    <div class="driver-usage-details-content hide-scrollbar" style="display: none;">
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
    if($('.driver-usage-details').hasClass('active')){
        $('.driver-usage-details-text').text('Hide usage details');
    }else{
        $('.driver-usage-details-text').text('View usage details');
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
        $('.usage-progbar-percent').html(totalUsagePercentage + '%');
        $('.usage-progbar').css('width', totalUsagePercentage + '%');
        
        // build the table for the usage details
        let h = '<table class="driver-usage-details-content-table">';

        h += `<thead>
            <tr>
                <th>Resource</th>
                <th>Units</th>
                <th>Cost</th>
            </tr>
        </thead>`;

        h += `<tbody>`;
        for(let key in res.usage){
            // value must be object
            if(typeof res.usage[key] !== 'object')
                continue;

            h += `
            <tr>
                <td>${key}</td>
                <td>${window.number_format(res.usage[key].units, {decimals: 0, thousandSeparator: ','})}</td>
                <td>${window.number_format(res.usage[key].cost / 100_000_000, { decimals: 2, prefix: '$' })}</td>
            </tr>`;
        }
        h += `</tbody>`;
        h += '</table>';

        $('.driver-usage-details-content').html(h);
    });

    const spacePromise = puter.fs.space().then(res => {
        let usage_percentage = (res.used / res.capacity * 100).toFixed(0);
        usage_percentage = usage_percentage > 100 ? 100 : usage_percentage;

        let general_used = res.used;

        let host_usage_percentage = 0;
        if ( res.host_used ) {
            $('#storage-puter-used').html(window.byte_format(res.used));
            $('#storage-puter-used-w').show();

            general_used = res.host_used;
            host_usage_percentage = ((res.host_used - res.used) / res.capacity * 100).toFixed(0);
        }

        $('#storage-used').html(window.byte_format(general_used));
        $('#storage-capacity').html(window.byte_format(res.capacity));
        $('#storage-used-percent').html(
            usage_percentage + '%' +
            (host_usage_percentage > 0
                ? ' / ' + host_usage_percentage + '%' : '')
        );
        $('#storage-bar').css('width', usage_percentage + '%');
        $('#storage-bar-host').css('width', host_usage_percentage + '%');
        if (usage_percentage >= 100) {
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
    if (elapsed < minDuration) {
        await new Promise(resolve => setTimeout(resolve, minDuration - elapsed));
    }
    
    // Remove spinning animation
    $($el_window).find('.update-usage-details-icon').css('animation', '');
}