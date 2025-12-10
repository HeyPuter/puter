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

// Sort state for the usage table
let usageTableSortState = {
    column: 'cost', // default sort by cost
    direction: 'desc' // default descending (highest cost first)
};
let usageTableData = []; // Store raw data for sorting
let usageTableExpanded = false; // Track if table is showing all rows
const USAGE_TABLE_INITIAL_ROWS = 10;

const TabUsage = {
    id: 'usage',
    label: 'Usage',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-speedometer2" viewBox="0 0 16 16"> <path d="M8 4a.5.5 0 0 1 .5.5V6a.5.5 0 0 1-1 0V4.5A.5.5 0 0 1 8 4M3.732 5.732a.5.5 0 0 1 .707 0l.915.914a.5.5 0 1 1-.708.708l-.914-.915a.5.5 0 0 1 0-.707M2 10a.5.5 0 0 1 .5-.5h1.586a.5.5 0 0 1 0 1H2.5A.5.5 0 0 1 2 10m9.5 0a.5.5 0 0 1 .5-.5h1.5a.5.5 0 0 1 0 1H12a.5.5 0 0 1-.5-.5m.754-4.246a.39.39 0 0 0-.527-.02L7.547 9.31a.91.91 0 1 0 1.302 1.258l3.434-4.297a.39.39 0 0 0-.029-.518z"/> <path fill-rule="evenodd" d="M0 10a8 8 0 1 1 15.547 2.661c-.442 1.253-1.845 1.602-2.932 1.25C11.309 13.488 9.475 13 8 13c-1.474 0-3.31.488-4.615.911-1.087.352-2.49.003-2.932-1.25A8 8 0 0 1 0 10m8-7a7 7 0 0 0-6.603 9.329c.203.575.923.876 1.68.63C4.397 12.533 6.358 12 8 12s3.604.532 4.923.96c.757.245 1.477-.056 1.68-.631A7 7 0 0 0 8 3"/> </svg>`,
    html: () => {
        return `
            <h1>${i18n('usage')}<button class="update-usage-details" style="float:right;"><svg class="update-usage-details-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-arrow-clockwise" viewBox="0 0 16 16"> <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/> <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/> </svg></button></h1>
            <div class="driver-usage">
                <div class="driver-usage-header">
                    <h3 style="margin:0; font-size: 14px; flex-grow: 1; font-weight: 500;">${i18n('Storage')}</h3>
                    <div style="font-size: 13px; margin-bottom: 3px; opacity:0.85;">
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
                        <h3 style="margin:0; font-size: 14px; flex-grow: 1; font-weight: 500;">${i18n('Resources')}</h3>
                        <div style="font-size: 13px; margin-bottom: 3px; opacity:0.85;">
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
                    <h3 style="margin:15px 0 10px 0; font-size: 14px; font-weight: 500;">Usage Details</h3>
                    <div class="driver-usage-details-content visible">
                    </div>
                </div>
            </div>`;
    },
    init: ($el_window) => {
        update_usage_details($el_window);
        $($el_window).find('.update-usage-details').on('click', function () {
            update_usage_details($el_window);
        });

        // Click handler for sortable table headers
        $($el_window).on('click', '.driver-usage-details-content-table th[data-sort]', function () {
            const column = $(this).data('sort');
            
            // Toggle direction if same column, otherwise default to descending
            if ( usageTableSortState.column === column ) {
                usageTableSortState.direction = usageTableSortState.direction === 'asc' ? 'desc' : 'asc';
            } else {
                usageTableSortState.column = column;
                usageTableSortState.direction = 'desc';
            }

            renderUsageTable();
        });

        // Click handler for "Show more" to expand the table
        $($el_window).on('click', '.usage-table-show-more', function () {
            usageTableExpanded = true;
            renderUsageTable();
        });
    },
};

function getSortIcon(column) {
    const isActive = usageTableSortState.column === column;
    const direction = usageTableSortState.direction;
    
    if ( !isActive ) {
        // Neutral sort icon (both arrows, dimmed)
        return `<span class="sort-icon sort-icon-neutral">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                <path d="M3.5 3.5a.5.5 0 0 0-1 0v8.793l-1.146-1.147a.5.5 0 0 0-.708.708l2 1.999.007.007a.497.497 0 0 0 .7-.006l2-2a.5.5 0 0 0-.707-.708L3.5 12.293V3.5zm4 .5a.5.5 0 0 1 0-1h1a.5.5 0 0 1 0 1h-1zm0 3a.5.5 0 0 1 0-1h3a.5.5 0 0 1 0 1h-3zm0 3a.5.5 0 0 1 0-1h5a.5.5 0 0 1 0 1h-5zm0 3a.5.5 0 0 1 0-1h7a.5.5 0 0 1 0 1h-7z"/>
            </svg>
        </span>`;
    } else if ( direction === 'asc' ) {
        // Ascending icon
        return `<span class="sort-icon sort-icon-asc">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                <path d="M3.5 12.5a.5.5 0 0 1-1 0V3.707L1.354 4.854a.5.5 0 1 1-.708-.708l2-1.999.007-.007a.498.498 0 0 1 .7.006l2 2a.5.5 0 1 1-.707.708L3.5 3.707V12.5zm3.5-9a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zM7.5 6a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5zm0 3a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3zm0 3a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1h-1z"/>
            </svg>
        </span>`;
    } else {
        // Descending icon
        return `<span class="sort-icon sort-icon-desc">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                <path d="M3.5 2.5a.5.5 0 0 0-1 0v8.793l-1.146-1.147a.5.5 0 0 0-.708.708l2 1.999.007.007a.497.497 0 0 0 .7-.006l2-2a.5.5 0 0 0-.707-.708L3.5 11.293V2.5zm3.5 1a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zM7.5 6a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5zm0 3a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3zm0 3a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1h-1z"/>
            </svg>
        </span>`;
    }
}

function renderUsageTable() {
    // Sort the data
    const sortedData = [...usageTableData].sort((a, b) => {
        let aVal, bVal;
        
        switch ( usageTableSortState.column ) {
            case 'resource':
                aVal = a.resource.toLowerCase();
                bVal = b.resource.toLowerCase();
                break;
            case 'cost':
            default:
                aVal = a.rawCost;
                bVal = b.rawCost;
                break;
        }
        
        if ( aVal < bVal ) return usageTableSortState.direction === 'asc' ? -1 : 1;
        if ( aVal > bVal ) return usageTableSortState.direction === 'asc' ? 1 : -1;
        return 0;
    });

    // Determine how many rows to show
    const hasMoreRows = sortedData.length > USAGE_TABLE_INITIAL_ROWS;
    const rowsToShow = usageTableExpanded ? sortedData : sortedData.slice(0, USAGE_TABLE_INITIAL_ROWS);
    const hiddenRowCount = sortedData.length - USAGE_TABLE_INITIAL_ROWS;

    // Build the wrapper with potential collapsed state
    const isCollapsed = hasMoreRows && !usageTableExpanded;
    let h = `<div class="usage-table-wrapper${isCollapsed ? ' collapsed' : ''}">`;

    // Build the table
    h += '<table class="driver-usage-details-content-table">';

    h += `<thead>
        <tr>
            <th data-sort="resource" class="sortable-th">Resource ${getSortIcon('resource')}</th>
            <th>Units</th>
            <th data-sort="cost" class="sortable-th">Cost ${getSortIcon('cost')}</th>
        </tr>
    </thead>`;

    h += '<tbody>';
    for ( const row of rowsToShow ) {
        h += `
        <tr>
            <td>${row.resource}</td>
            <td>${row.formattedUnits}</td>
            <td>${row.formattedCost}</td>
        </tr>`;
    }
    h += '</tbody>';
    h += '</table>';

    // Add "Show more" overlay if there are hidden rows
    if ( isCollapsed ) {
        h += `<div class="usage-table-fade-overlay">
            <button class="usage-table-show-more">Show ${hiddenRowCount} more</button>
        </div>`;
    }

    h += '</div>';

    $('.driver-usage-details-content').html(h);
}

async function update_usage_details ($el_window) {
    // Reset expanded state on refresh
    usageTableExpanded = false;
    
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
        $('.usage-progbar-percent').html(`${totalUsagePercentage }%`);
        $('.usage-progbar').css('width', `${totalUsagePercentage }%`);

        // Store raw data for sorting
        usageTableData = [];
        for ( let key in res.usage ) {
            // value must be object
            if ( typeof res.usage[key] !== 'object' ) {
                continue;
            }

            const rawUnits = res.usage[key].units;
            const rawCost = res.usage[key].cost;

            // Format units for display
            let formattedUnits;
            if ( key.startsWith('filesystem:') && key.endsWith(':bytes') ) {
                formattedUnits = window.byte_format(rawUnits);
            } else {
                formattedUnits = window.number_format(rawUnits, { decimals: 0, thousandSeparator: ',' });
            }

            usageTableData.push({
                resource: key,
                rawUnits: rawUnits,
                formattedUnits: formattedUnits,
                rawCost: rawCost,
                formattedCost: window.number_format(rawCost / 100_000_000, { decimals: 2, prefix: '$' })
            });
        }

        renderUsageTable();
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
                        `${usage_percentage }%${
                            host_usage_percentage > 0
                                ? ` / ${ host_usage_percentage }%` : ''}`);
        $('#storage-bar').css('width', `${usage_percentage }%`);
        $('#storage-bar-host').css('width', `${host_usage_percentage }%`);
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

export default TabUsage;