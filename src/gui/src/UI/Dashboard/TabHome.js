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

function getTimeGreeting () {
    const hour = new Date().getHours();
    if ( hour < 12 ) return 'Good morning';
    if ( hour < 17 ) return 'Good afternoon';
    return 'Good evening';
}

function buildRecentAppsHTML () {
    let h = '';
    
    if ( window.launch_apps?.recent?.length > 0 ) {
        h += '<div class="bento-recent-apps-grid">';

        // Show up to 6 recent apps
        const recentApps = window.launch_apps.recent.slice(0, 6);
        for ( const app_info of recentApps ) {
            // if title, name and uuid are the same and index_url is set, then show the hostname of index_url
            if ( app_info.name === app_info.title && app_info.name === app_info.uuid && app_info.index_url ) {
                app_info.title = new URL(app_info.index_url).hostname;
                app_info.target_link = app_info.index_url;
            }

            h += `<div class="bento-recent-app" data-app-name="${html_encode(app_info.name)}" data-target-link="${html_encode(app_info.target_link)}">`;
                // Icon
                h += `<img class="bento-recent-app-icon" src="${html_encode(app_info.icon || window.icons['app.svg'])}">`;
                // Title
                h += `<span class="bento-recent-app-title">${html_encode(app_info.title)}</span>`;
            h += '</div>';
        }
        h += '</div>';
    } else {
        h += '<div class="bento-recent-apps-empty">';
        h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">';
        h += '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>';
        h += '<rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>';
        h += '</svg>';
        h += '<p>No recent apps yet</p>';
        h += '<span>Apps you use will appear here</span>';
        h += '</div>';
    }
    
    return h;
}

function buildUsageHTML () {
    let h = '';
    h += '<div class="bento-usage-grid">';
    
    // Your Plan section
    h += '<div class="bento-usage-section bento-usage-card bento-plan-section">';
        h += '<a href="#" class="bento-usage-card-header bento-plan-header">';
            h += `<h3>${i18n('your_plan')}</h3>`;
            h += '<span class="bento-usage-card-arrow">›</span>';
        h += '</a>';
        h += '<div class="bento-usage-card-info bento-plan-info">';
            h += '<span class="bento-usage-card-used bento-plan-name">--</span>';
            h += '<span class="bento-usage-card-details bento-plan-details"><span class="bento-plan-badge"></span></span>';
        h += '</div>';
        h += '<a href="#" class="bento-plan-upgrade" style="display: none;">Upgrade →</a>';
    h += '</div>';
    
    // Storage section
    h += '<div class="bento-usage-section bento-usage-card">';
        h += '<a href="#" class="bento-usage-card-header" data-target-tab="usage">';
            h += `<h3>Your ${i18n('Storage')}</h3>`;
            h += '<span class="bento-usage-card-arrow">›</span>';
        h += '</a>';
        h += '<div class="bento-usage-card-bar-wrapper">';
            h += '<div class="bento-usage-card-bar bento-storage-bar"></div>';
        h += '</div>';
        h += '<div class="bento-usage-card-info">';
            h += '<span class="bento-usage-card-used bento-storage-used">-- Used</span>';
            h += '<span class="bento-usage-card-details"><span class="bento-storage-percent">--%</span> of <span class="bento-storage-capacity">--</span></span>';
        h += '</div>';
    h += '</div>';
    
    // Resources section
    h += '<div class="bento-usage-section bento-usage-card">';
        h += '<a href="#" class="bento-usage-card-header" data-target-tab="usage">';
            h += `<h3>Your ${i18n('Resources')}</h3>`;
            h += '<span class="bento-usage-card-arrow">›</span>';
        h += '</a>';
        h += '<div class="bento-usage-card-bar-wrapper">';
            h += '<div class="bento-usage-card-bar bento-resources-bar"></div>';
        h += '</div>';
        h += '<div class="bento-usage-card-info">';
            h += '<span class="bento-usage-card-used bento-resources-used">-- Used</span>';
            h += '<span class="bento-usage-card-details"><span class="bento-resources-percent">--%</span> of <span class="bento-resources-capacity">--</span></span>';
        h += '</div>';
    h += '</div>';
    
    h += '</div>';
    return h;
}

const TabHome = {
    id: 'home',
    label: 'Home',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,

    html () {
        const username = window.user?.username || 'User';
        const greeting = getTimeGreeting();
        const profilePicture = window.user?.profile?.picture || window.icons['profile.svg'];
        
        let h = '';
        h += '<div class="bento-container">';
        
        // Welcome card (square)
        h += '<div class="bento-card bento-welcome">';
            h += '<div class="bento-welcome-inner">';
                h += '<div class="bento-welcome-pattern"></div>';
                h += `<div class="bento-welcome-content">`;
                    h += `<div class="bento-welcome-avatar profile-pic" style="background-image: url(${html_encode(profilePicture)})"></div>`;
                    h += `<span class="bento-greeting">${greeting},</span>`;
                    h += `<h1 class="bento-username">${html_encode(username)}</h1>`;
                    h += '<p class="bento-tagline">Your personal cloud computer</p>';
                h += '</div>';
            h += '</div>';
        h += '</div>';
        
        // Recent apps card (rectangle)
        h += '<div class="bento-card bento-recent">';
            h += '<div class="bento-card-fancy-header">';
                h += '<div class="bento-card-fancy-icon bento-card-fancy-icon-apps">';
                    h += '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
                h += '</div>';
                h += '<div class="bento-card-fancy-text">';
                    h += '<h2>Apps</h2>';
                    h += '<span class="bento-card-fancy-subtitle">';
                        h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
                        h += 'Recently used';
                    h += '</span>';
                h += '</div>';
            h += '</div>';
            h += '<div class="bento-recent-apps-container">';
                h += buildRecentAppsHTML();
            h += '</div>';
        h += '</div>';
        
        // Usage card (spans full width on second row)
        h += '<div class="bento-card bento-usage">';
            h += '<div class="bento-card-fancy-header">';
                h += '<div class="bento-card-fancy-icon bento-card-fancy-icon-usage">';
                    h += '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 4a.5.5 0 0 1 .5.5V6a.5.5 0 0 1-1 0V4.5A.5.5 0 0 1 8 4M3.732 5.732a.5.5 0 0 1 .707 0l.915.914a.5.5 0 1 1-.708.708l-.914-.915a.5.5 0 0 1 0-.707M2 10a.5.5 0 0 1 .5-.5h1.586a.5.5 0 0 1 0 1H2.5A.5.5 0 0 1 2 10m9.5 0a.5.5 0 0 1 .5-.5h1.5a.5.5 0 0 1 0 1H12a.5.5 0 0 1-.5-.5m.754-4.246a.39.39 0 0 0-.527-.02L7.547 9.31a.91.91 0 1 0 1.302 1.258l3.434-4.297a.39.39 0 0 0-.029-.518z"/><path fill-rule="evenodd" d="M0 10a8 8 0 1 1 15.547 2.661c-.442 1.253-1.845 1.602-2.932 1.25C11.309 13.488 9.475 13 8 13c-1.474 0-3.31.488-4.615.911-1.087.352-2.49.003-2.932-1.25A8 8 0 0 1 0 10m8-7a7 7 0 0 0-6.603 9.329c.203.575.923.876 1.68.63C4.397 12.533 6.358 12 8 12s3.604.532 4.923.96c.757.245 1.477-.056 1.68-.631A7 7 0 0 0 8 3"/></svg>';
                h += '</div>';
                h += '<div class="bento-card-fancy-text">';
                    h += `<h2>${i18n('usage')}</h2>`;
                    h += '<span class="bento-card-fancy-subtitle">';
                        h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>';
                        h += 'Monthly overview';
                    h += '</span>';
                h += '</div>';
            h += '</div>';
            h += '<div class="bento-usage-container">';
                h += buildUsageHTML();
            h += '</div>';
        h += '</div>';
        
        h += '</div>';
        return h;
    },

    init ($el_window) {
        this.loadRecentApps($el_window);
        this.loadUsageData($el_window);

        // Handle app clicks
        $el_window.on('click', '.bento-recent-app', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const appName = $(this).attr('data-app-name');
            const targetLink = $(this).attr('data-target-link');
            if ( targetLink && targetLink !== '' ) {
                window.open(targetLink, '_blank');
            }
            else if ( appName ) {
                window.open(`/app/${appName}`, '_blank');
            }
        });

        // Handle "View details" link clicks
        $el_window.on('click', '.bento-view-more, .bento-usage-card-header', function (e) {
            e.preventDefault();
            const targetTab = $(this).attr('data-target-tab');
            if ( targetTab ) {
                // Trigger click on the corresponding sidebar item
                $el_window.find(`.dashboard-sidebar-item[data-section="${targetTab}"]`).click();
            }
        });

        // Handle plan header and upgrade button clicks
        $el_window.on('click', '.bento-plan-header, .bento-plan-upgrade', function (e) {
            e.preventDefault();
            // Open settings to billing tab
            window.UIWindowSettings({ active_tab: 'billing' });
        });
    },

    async loadRecentApps ($el_window) {
        if ( !window.launch_apps?.recent?.length ) {
            try {
                window.launch_apps = await $.ajax({
                    url: `${window.api_origin}/get-launch-apps?icon_size=64`,
                    type: 'GET',
                    async: true,
                    contentType: 'application/json',
                    headers: {
                        'Authorization': `Bearer ${window.auth_token}`,
                    },
                });
            } catch (e) {
                console.error('Failed to load launch apps:', e);
            }
        }
        $el_window.find('.bento-recent-apps-container').html(buildRecentAppsHTML());
    },

    async loadUsageData ($el_window) {
        // Load plan data
        try {
            const hasSubscription = window.user?.subscription?.active;
            const planName = hasSubscription 
                ? (window.user?.subscription?.plan_name || i18n('billing.offering.pro'))
                : i18n('billing.offering.free');
            
            $el_window.find('.bento-plan-name').text(planName);
            
            if ( hasSubscription ) {
                $el_window.find('.bento-plan-badge').text('Active subscription').addClass('active');
                $el_window.find('.bento-plan-upgrade').hide();
            } else {
                $el_window.find('.bento-plan-badge').text('Upgrade for more features').addClass('free');
                $el_window.find('.bento-plan-upgrade').show();
            }
        } catch (e) {
            console.error('Failed to load plan data:', e);
        }

        // Load storage data
        try {
            const res = await puter.fs.space();
            let usage_percentage = (res.used / res.capacity * 100).toFixed(0);
            usage_percentage = usage_percentage > 100 ? 100 : usage_percentage;

            let general_used = res.used;
            if ( res.host_used ) {
                general_used = res.host_used;
            }

            $el_window.find('.bento-storage-used').text(`${window.byte_format(general_used)} Used`);
            $el_window.find('.bento-storage-capacity').text(window.byte_format(res.capacity));
            $el_window.find('.bento-storage-percent').text(`${usage_percentage}%`);
            $el_window.find('.bento-storage-bar').css('width', `${usage_percentage}%`);
        } catch (e) {
            console.error('Failed to load storage data:', e);
        }

        // Load monthly usage data
        try {
            const res = await puter.auth.getMonthlyUsage();
            let monthlyAllowance = res.allowanceInfo?.monthUsageAllowance;
            let remaining = res.allowanceInfo?.remaining;
            let totalUsage = monthlyAllowance - remaining;
            let totalUsagePercentage = (totalUsage / monthlyAllowance * 100).toFixed(0);

            $el_window.find('.bento-resources-used').text(`${window.number_format(totalUsage / 100_000_000, { decimals: 2, prefix: '$' })} Used`);
            $el_window.find('.bento-resources-capacity').text(window.number_format(monthlyAllowance / 100_000_000, { decimals: 2, prefix: '$' }));
            $el_window.find('.bento-resources-percent').text(`${totalUsagePercentage}%`);
            $el_window.find('.bento-resources-bar').css('width', `${totalUsagePercentage}%`);
        } catch (e) {
            console.error('Failed to load monthly usage data:', e);
        }
    },

    onActivate ($el_window) {
        this.loadRecentApps($el_window);
        this.loadUsageData($el_window);
    },
};

export default TabHome;

