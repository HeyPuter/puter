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
            <h1>${i18n('usage')}</h1>
            <div class="driver-usage" style="margin-top: 30px;">
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
            </div>`;
    },
    init: ($el_window) => {
        const sanitize_id = id => (''+id).replace(/[^A-Za-z0-9-]/g, '');
        $.ajax({
            url: window.api_origin + "/drivers/usage",
            type: 'GET',
            async: true,
            contentType: "application/json",
            headers: {
                "Authorization": "Bearer " + window.auth_token
            },
            statusCode: {
                401: function () {
                    window.logout();
                },
            },
            success: function (res) {
                let h = ''; // Initialize HTML string for driver usage bars

                // Usages provided by arbitrary services
                res.usages.forEach(entry => {
                    if ( ! entry.usage_percentage ) {
                        entry.usage_percentage = (entry.used / entry.available * 100).toFixed(0);
                    }

                    // Skip the 'ai-chat (complete)' entry since we've made it infinite for now
                    if(entry.name === 'ai-chat (complete)')
                        return;

                    if(entry.name.startsWith('es:subdomain'))
                        return;

                    if(entry.name.startsWith('es:app'))
                        return;

                    let name = entry.name;

                    if(name === 'convert-api (convert)')
                        name = `File Conversions`;

                    h += `
                        <div
                            class="driver-usage"
                            style="margin-bottom: 10px;"
                            data-id="${sanitize_id(entry.id)}"
                        >
                            <div class="driver-usage-header">
                                <h3 style="margin:0; font-size: 14px; flex-grow: 1;">${html_encode(name)}:</h3>
                                <span style="font-size: 13px; margin-bottom: 3px;">${i18n('used_of', {
                                    ...entry,
                                    used: window.format_credits(entry.used),
                                    available: window.format_credits(entry.available),
                                })}</span>
                            </div>
                            <div class="usage-progbar-wrapper" style="width: 100%;">
                                <div class="usage-progbar" style="width: ${Number(entry.usage_percentage)}%;"><span class="usage-progbar-percent">${Number(entry.usage_percentage)}%</span></div>
                            </div>
                            <div class="driver-usage-details" style="margin-top: 5px; font-size: 13px; cursor: pointer;">
                                <div class="caret"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-caret-right-fill" viewBox="0 0 16 16"><path d="m12.14 8.753-5.482 4.796c-.646.566-1.658.106-1.658-.753V3.204a1 1 0 0 1 1.659-.753l5.48 4.796a1 1 0 0 1 0 1.506z"/></svg></div>
                                <span class="driver-usage-details-text disable-user-select">View usage details</span>
                            </div>
                            <div class="driver-usage-details-content hide-scrollbar" style="display: none;">
                            </div>
                        </div>
                    `;
                });
                
                const divContent = $el_window.find('.settings-content[data-settings="usage"]');

                // Append driver usage bars to the container
                divContent.append(`<div class="driver-usage-container">${h}</div>`);
                
                const update_usage = event => {
                    if ( ! event.usage_percentage ) {
                        event.usage_percentage = (event.used / event.available * 100).toFixed(0);
                    }
                    const el_divContent = divContent[0];
                    el_divContent
                        .querySelector(`[data-id=${sanitize_id(event.id)}] .usage-progbar`)
                        .style.width = '' + Number(event.usage_percentage) + '%';
                    el_divContent
                        .querySelector(`[data-id=${sanitize_id(event.id)}] .usage-progbar span`)
                        .innerText = '' + Number(event.usage_percentage) + '%';
                    const used_of_str = i18n('used_of', {
                        ...event,
                        used: window.format_credits(event.used),
                        available: window.format_credits(event.available),
                    });
                    el_divContent
                        .querySelector(`[data-id=${sanitize_id(event.id)}] > span`)
                        .innerText = used_of_str;
                };

                
                const interval = setInterval(async () => {
                    const resp = await fetch(`${window.api_origin}/drivers/usage`, {
                        headers: {
                            "Authorization": "Bearer " + window.auth_token
                        },
                    })
                    const usages = (await resp.json()).usages;
                    for ( const usage of usages ) {
                        if ( ! usage.id ) continue;
                        update_usage(usage);
                    }
                }, 2000);

                divContent.on('remove', () => {
                    socket.off('usage.update', update_usage);
                    clearInterval(interval);
                });
                socket.on('usage.update', update_usage);
            }
        });

        // df
        $.ajax({
            url: window.api_origin + "/df",
            type: 'GET',
            async: true,
            contentType: "application/json",
            headers: {
                "Authorization": "Bearer " + window.auth_token
            },
            statusCode: {
                401: function () {
                    window.logout();
                },
            },
            success: function (res) {
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
            }
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

    puter.auth.getMonthlyUsage().then(res => {
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
                <td>${window.format_credits(res.usage[key].units)}</td>
                <td>${window.number_format(res.usage[key].cost / 100_000_000, { decimals: 2, prefix: '$' })}</td>
            </tr>`;
        }
        h += `</tbody>`;
        h += '</table>';

        $('.driver-usage-details-content').html(h);
    });
});