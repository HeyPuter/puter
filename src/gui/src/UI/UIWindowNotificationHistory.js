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

function UIWindowNotificationHistory(options = {}) {
    let h = '';
    h += `<div class="window window-notification-history" data-app="notification-history">`;
        h += `<div class="window-head">`;
            h += `<div class="window-head-title">${i18n('notification_history')}</div>`;
            h += `<div class="window-head-icon"><img src="${window.icons['bell.svg']}"></div>`;
        h += `</div>`;
        h += `<div class="window-body">`;
            h += `<div class="notification-history-container">`;
                h += `<div class="notification-history-list"></div>`;
                h += `<div class="notification-history-pagination"></div>`;
            h += `</div>`;
        h += `</div>`;
    h += `</div>`;

    $('.window-container').append(h);

    const el_window = $('.window-notification-history');
    const el_list = el_window.find('.notification-history-list');
    const el_pagination = el_window.find('.notification-history-pagination');

    let currentPage = 1;
    const limit = 20;
    let notificationsData = null;

    async function loadNotifications(page) {
        try {
            const response = await fetch(`${window.api_origin}/notif/history?page=${page}&limit=${limit}`, {
                headers: {
                    'Authorization': `Bearer ${window.auth_token}`
                }
            });
            if (!response.ok) {
                throw new Error('Failed to fetch notifications');
            }
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Error loading notifications:', error);
            el_list.html(`<div class="notification-error">${i18n('error_loading_notifications')}</div>`);
            el_pagination.html('');
            return null;
        }
    }

    function renderNotification(notification) {
        if (!notification) return '';
        
        const value = notification.value || {};
        const icon = value.icon_source === 'builtin' && value.icon ? 
            window.icons[value.icon] : 
            (value.icon || window.icons['bell.svg']);

        return `
            <div class="notification-history-item ${notification.acknowledged ? 'acknowledged' : ''}" data-uid="${notification.uid}">
                <div class="notification-history-icon">
                    <img src="${icon}" style="${value.round_icon ? 'border-radius: 50%;' : ''}">
                </div>
                <div class="notification-history-content">
                    <div class="notification-history-title">${html_encode(value.title || '')}</div>
                    <div class="notification-history-text">${html_encode(value.text || '')}</div>
                    <div class="notification-history-time">${new Date(notification.created_at * 1000).toLocaleString()}</div>
                    ${!notification.acknowledged ? `
                        <button class="notification-read-btn" onclick="event.stopPropagation(); window.markAsRead('${notification.uid}')">
                            ${i18n('mark_as_read')}
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    function renderPagination(totalPages, currentPage) {
        if (!totalPages || totalPages < 1) return '';
        
        let html = '<div class="pagination">';
        
        // Previous button
        html += `<button class="pagination-btn ${currentPage === 1 ? 'disabled' : ''}" 
                         ${currentPage === 1 ? 'disabled' : `onclick="window.loadPage(${currentPage - 1})"`}>${i18n('previous')}</button>`;
        
        // Page numbers
        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
                html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" 
                                 onclick="window.loadPage(${i})">${i}</button>`;
            } else if (i === currentPage - 3 || i === currentPage + 3) {
                html += '<span class="pagination-ellipsis">...</span>';
            }
        }
        
        // Next button
        html += `<button class="pagination-btn ${currentPage === totalPages ? 'disabled' : ''}" 
                         ${currentPage === totalPages ? 'disabled' : `onclick="window.loadPage(${currentPage + 1})"`}>${i18n('next')}</button>`;
        
        html += '</div>';
        return html;
    }

    async function loadPage(page) {
        if (page < 1) return;
        
        const data = await loadNotifications(page);
        if (!data || !data.notifications || !data.pagination) {
            return;
        }
        
        notificationsData = data;
        currentPage = page;
        
        // Render notifications
        const notificationsHtml = data.notifications.map(renderNotification).join('');
        el_list.html(notificationsHtml || `<div class="notification-empty">${i18n('no_notifications')}</div>`);
        
        // Render pagination if we have more than one page
        const totalPages = Math.ceil(data.pagination.total / limit) || 1;
        el_pagination.html(totalPages > 1 ? renderPagination(totalPages, currentPage) : '');
    }

    // Make loadPage available globally for pagination buttons
    window.loadPage = loadPage;

    // Handle notification clicks
    el_list.on('click', '.notification-history-item', async function(e) {
        const uid = $(this).data('uid');
        if (!uid || $(e.target).hasClass('notification-read-btn')) return;

        // Mark as acknowledged if not already
        if (!$(this).hasClass('acknowledged')) {
            try {
                await fetch(`${window.api_origin}/notif/mark-ack`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${window.auth_token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ uid })
                });
                $(this).addClass('acknowledged');
                $(this).find('.notification-read-btn').remove();
                updateNotificationCount();
            } catch (error) {
                console.error('Error acknowledging notification:', error);
            }
        }

        // Handle notification click action if defined
        if (notificationsData && notificationsData.notifications) {
            const notification = notificationsData.notifications.find(n => n.uid === uid);
            if (notification?.value?.click && typeof notification.value.click === 'function') {
                notification.value.click(notification.value);
            }
        }
    });

    // Add markAsRead function
    window.markAsRead = async function(uid) {
        try {
            await fetch(`${window.api_origin}/notif/mark-ack`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${window.auth_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ uid })
            });
            
            // Update UI
            $(`.notification-history-item[data-uid="${uid}"]`).addClass('acknowledged');
            $(`.notification-history-item[data-uid="${uid}"] .notification-read-btn`).remove();
            
            // Update notification count
            updateNotificationCount();
        } catch (error) {
            console.error('Error marking notification as read:', error);
        }
    };

    // Add function to update notification count
    async function updateNotificationCount() {
        try {
            const response = await fetch(`${window.api_origin}/notif/history?page=1&limit=1`, {
                headers: {
                    'Authorization': `Bearer ${window.auth_token}`
                }
            });
            if (!response.ok) {
                throw new Error('Failed to fetch notification count');
            }
            const data = await response.json();
            const unreadCount = data.notifications?.filter(n => !n.acknowledged)?.length || 0;
            
            // Update notification bell icon
            const notificationBell = $('.notification-history-btn');
            if (unreadCount > 0) {
                notificationBell.addClass('has-unread');
                notificationBell.attr('data-unread-count', unreadCount);
            } else {
                notificationBell.removeClass('has-unread');
                notificationBell.removeAttr('data-unread-count');
            }
        } catch (error) {
            console.error('Error updating notification count:', error);
        }
    }

    // Call updateNotificationCount initially
    updateNotificationCount();

    // Load initial page
    loadPage(1);

    return el_window;
}

export default UIWindowNotificationHistory; 