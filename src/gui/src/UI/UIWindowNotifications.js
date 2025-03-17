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

import UIWindow from './UIWindow.js'
import UIAlert from './UIAlert.js'
// import { LogService } from '../modules/core/LogService.js';
import _ from 'lodash';

const notifLogger = {
    info: (...args) => console.log('[NOTIF INFO]', ...args),
    debug: (...args) => console.log('[NOTIF DEBUG]', ...args),
    error: (...args) => console.error('[NOTIF ERROR]', ...args),
    group: (name) => console.group(name),
    groupEnd: () => console.groupEnd()
  };

// Create a logger instance for notifications
// const notifLogger = new LogService().create('NOTIF');

/**
 * Creates a notification sidebar that displays the user's notification history
 * 
 * @param {Object} options - Configuration options for the sidebar
 * @returns {HTMLElement} - The sidebar element
 */
function UIWindowNotifications(options = {}) {
    notifLogger.info('Creating notification sidebar', { options });

    // Check if sidebar already exists
    if ($('.notification-sidebar').length) {
        notifLogger.debug('Sidebar already exists, activating');
        $('.notification-sidebar').addClass('active');
        return $('.notification-sidebar')[0];
    }

    let h = '';
    let el_sidebar;
    
    // Create sidebar structure
    h += `<div class="notification-sidebar">`;
    h += `<div class="notification-sidebar-header">`;
    h += `<div class="notification-sidebar-title">Notifications</div>`;
    h += `<div class="notification-sidebar-close">`;
    h += `<img src="${window.icons['close.svg']}" alt="Close" style="width: 12px; height: 12px; opacity: 0.7;">`;
    h += `</div>`;
    h += `</div>`;
    h += `<div class="notification-sidebar-content">`;
    h += `<div class="notification-history-container">`;
    h += `<div class="notification-history-list"></div>`;
    h += `<div class="notification-history-empty" style="display: none;">
            <p>You don't have any notifications yet.</p>
          </div>`;
    h += `<div class="notification-load-more" style="display: none;">Load more notifications...</div>`;
    h += `</div>`;
    h += `</div>`; 
    h += `</div>`; 
    
    // Append sidebar to body
    $('body').append(h);
    el_sidebar = $('.notification-sidebar')[0];
    
    // State variables for pagination
    let currentPage = 1;
    let hasMoreNotifications = true;
    let isLoadingMore = false;
    let pageSize = 4;
    
    // Function to render notifications
    function renderNotifications(notifications, append = false) {
        notifLogger.group('Render Notifications');
        notifLogger.debug('Starting render', {
            notificationCount: notifications?.length,
            append,
            containerExists: $(el_sidebar).find('.notification-history-list').length > 0
        });
        
        const container = $(el_sidebar).find('.notification-history-list');
        const emptyState = $(el_sidebar).find('.notification-history-empty');
        
        if (!append) {
            container.empty();
        }

        if (!notifications || notifications.length === 0) {
            if (!append) {
                container.hide();
                emptyState.show();
                $(el_sidebar).find('.notification-load-more').hide();
            }
            notifLogger.groupEnd();
            return;
        }

        // Show container and hide empty state
        container.show();
        emptyState.hide();

        notifications.forEach((item, index) => {
            notifLogger.debug(`Rendering notification ${index + 1}`, {
                uid: item.uid,
                title: item.notification?.title,
                isAcknowledged: item.acknowledged
            });

            const notif = item.notification;
            const date = new Date(item.created_at * 1000).toLocaleString();
            
            const notifEl = $(`
                <div class="notification-history-item ${item.acknowledged ? 'acknowledged' : 'unacknowledged'}" data-uid="${item.uid}">
                    <div class="notification-header">
                        <div class="notification-icon">
                            <img src="${window.icons[notif.icon] || window.icons['bell.svg']}" alt="Notification">
                        </div>
                        <div class="notification-title">
                            ${notif.title || 'Notification'}
                        </div>
                        <div class="notification-date">
                            ${date}
                        </div>
                    </div>
                    <div class="notification-text">${notif.text || ''}</div>
                    <div class="notification-status">
                        ${item.acknowledged ? 
                            '<span class="acknowledged-status">Read</span>' : 
                            '<span class="unacknowledged-status">Unread</span>'
                        }
                    </div>
                </div>
            `);

            container.append(notifEl);

            // Click handler for notifications
            notifEl.on('click', async function() {
                if (!item.acknowledged) {
                    try {
                        notifLogger.debug('Marking notification as acknowledged:', item.uid);
                        
                        const response = await fetch(`${window.api_origin}/notif/mark-acknowledged`, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${window.auth_token}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                uid: item.uid
                            })
                        });

                        if (!response.ok) {
                            throw new Error('Failed to mark notification as acknowledged');
                        }

                        const data = await response.json();
                        
                        if (data.success) {
                            // Update UI state
                            $(this)
                                .removeClass('unacknowledged')
                                .addClass('acknowledged');
                            
                            $(this)
                                .find('.notification-status')
                                .html('<span class="acknowledged-status">Read</span>');

                            // Update item state
                            item.acknowledged = true;
                            
                            // Visual feedback animation
                            $(this).css({
                                'transition': 'all 0.3s ease',
                                'background-color': 'rgba(76, 175, 80, 0.1)'
                            });
                            
                            setTimeout(() => {
                                $(this).css({
                                    'background-color': '',
                                    'transition': ''
                                });
                            }, 300);

                            // Update notification badge count
                            if (typeof window.update_notification_badge_count === 'function') {
                                window.update_notification_badge_count();
                            }
                        }
                    } catch (error) {
                        notifLogger.error('Failed to mark notification as acknowledged:', error);
                        UIAlert({
                            message: 'Failed to mark notification as read. Please try again.',
                            buttons: [{ label: 'OK' }]
                        });
                    }
                }
            });
        });

        // Update load more button visibility
        $(el_sidebar).find('.notification-load-more').toggle(hasMoreNotifications);
        
        notifLogger.groupEnd();
    }
    
    // Function to load notifications
    async function loadNotifications(page = 1, append = false) {
        if (isLoadingMore) {
            notifLogger.debug('Already loading notifications, skipping request');
            return;
        }

        isLoadingMore = true;
        const loadMoreBtn = $(el_sidebar).find('.notification-load-more');
        loadMoreBtn.html('<div class="notification-load-more-spinner">Loading...</div>');
        
        notifLogger.group('Load Notifications');
        notifLogger.info('Loading notifications', {
            page,
            append,
            pageSize
        });

        try {
            const response = await fetch(`${window.api_origin}/notif/history?page=${page}&pageSize=${pageSize}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${window.auth_token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch notifications: ${response.status}`);
            }

            const data = await response.json();
            notifLogger.info('Notification response', { 
                total: data.pagination.total,
                currentPage: data.pagination.page,
                totalPages: data.pagination.totalPages
            });

            // Update pagination state
            currentPage = data.pagination.page;
            hasMoreNotifications = currentPage < data.pagination.totalPages;

            // Render notifications
            renderNotifications(data.notifications, append);
            
            // Update load more button visibility and text
            const loadMoreBtn = $(el_sidebar).find('.notification-load-more');
            if (hasMoreNotifications) {
                loadMoreBtn.html('Load more notifications...').show();
            } else {
                loadMoreBtn.hide();
            }

        } catch (error) {
            notifLogger.error('Failed to load notifications', error);
            const loadMoreBtn = $(el_sidebar).find('.notification-load-more');
            loadMoreBtn.html('Error loading notifications. Click to retry.');
            
            UIAlert({
                message: 'Failed to load notifications. Please try again.',
                buttons: [{ label: 'OK' }]
            });
        } finally {
            isLoadingMore = false;
            notifLogger.groupEnd();
        }
    }
    
    // Add debounced load more button click handler
    const debouncedLoadMore = _.debounce(() => {
        if (hasMoreNotifications && !isLoadingMore) {
            loadNotifications(currentPage + 1, true);
        }
    }, 300);

    $(el_sidebar).find('.notification-load-more').on('click', function() {
        notifLogger.debug('Load more clicked', {
            currentPage,
            hasMore: hasMoreNotifications
        });
        debouncedLoadMore();
    });

    // Add debounced infinite scroll
    const container = $(el_sidebar).find('.notification-history-container');
    container.on('scroll', _.debounce(function() {
        const scrollHeight = this.scrollHeight;
        const scrollTop = this.scrollTop;
        const clientHeight = this.clientHeight;
        
        if (scrollHeight - scrollTop - clientHeight < 100 && hasMoreNotifications && !isLoadingMore) {
            notifLogger.debug('Near bottom, loading more', { 
                scrollHeight, 
                scrollTop, 
                clientHeight,
                currentPage 
            });
            loadNotifications(currentPage + 1, true);
        }
    }, 300));
    
    // Handle close button click
    $(el_sidebar).find('.notification-sidebar-close').on('click', () => {
        $(el_sidebar).removeClass('active');
        setTimeout(() => {
            $(el_sidebar).remove();
        }, 300);
    });

    // Handle click outside sidebar
    $(document).on('mousedown.notification-sidebar', (e) => {
        if (!$(e.target).closest('.notification-sidebar').length && 
            !$(e.target).closest('.notifications-history-btn').length) {
            $(el_sidebar).removeClass('active');
            setTimeout(() => {
                $(el_sidebar).remove();
            }, 300);
            $(document).off('mousedown.notification-sidebar');
        }
    });
    
    // Initial load
    loadNotifications(1, false);
    
    notifLogger.info('Sidebar initialization complete', {
        exists: !!el_sidebar,
        elements: {
            list: $(el_sidebar).find('.notification-history-list').length,
            empty: $(el_sidebar).find('.notification-history-empty').length
        }
    });
    
    return el_sidebar;
}

export default UIWindowNotifications;