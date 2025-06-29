/**
 * Enhanced My Websites Window
 * Copyright (C) 2024-present Puter Technologies Inc.
 */

import UIWindow from './UIWindow.js'
import UIContextMenu from './UIContextMenu.js'
import UIAlert from './UIAlert.js'

async function UIWindowMyWebsites(options){
    let h = `<div class="mywebsites-container">
        <div class="mywebsites-header">
            <div class="mywebsites-controls">
                <div class="search-section">
                    <input type="text" id="mywebsites-search" placeholder="Search websites..." />
                    <select id="mywebsites-filter">
                        <option value="all">All Websites</option>
                        <option value="active">Active (with folder)</option>
                        <option value="inactive">Inactive (no folder)</option>
                    </select>
                </div>
                <div class="bulk-section" style="display: none;">
                    <button id="select-all" class="control-btn" title="Select All">☑️</button>
                    <button id="clear-selection" class="control-btn" title="Clear Selection">☐</button>
                    <button id="bulk-release" class="control-btn danger" title="Release Selected">🔓</button>
                    <button id="bulk-delete" class="control-btn danger" title="Delete Selected">🗑️</button>
                </div>
            </div>
        </div>
        <div class="mywebsites-content">
            <div class="mywebsites-loading">
                <div class="loading-spinner"></div>
                <p>Loading websites...</p>
            </div>
        </div>
        <div class="mywebsites-footer">
            <div class="mywebsites-summary">
                <span id="total-websites">Total: 0 websites</span>
                <span id="active-websites">Active: 0</span>
                <span id="inactive-websites">Inactive: 0</span>
            </div>
        </div>
    </div>`;

    try {
        const el_window = await UIWindow({
            title: 'My Websites',
            app: 'my-websites',
            single_instance: true,
            body_content: h,
            has_head: true,
            is_resizable: true,
            is_maximizable: true,
            init_center: true,
            width: 1100,
            height: 650,
            onAppend: function(el_window){
                setTimeout(() => {
                    try {
                        initializeMyWebsites(el_window);
                    } catch (error) {
                        showError(el_window, 'Initialization Error', 'Failed to initialize. Please try closing and reopening this window.');
                    }
                }, 100);
            },
            body_css: {
                padding: '0',
                'background-color': '#ffffff',
                'height': '100%',
                'display': 'flex',
                'flex-direction': 'column',
            }    
        });
        addCustomStyles();
        return el_window;
    } catch (error) {
        console.error('Failed to create My Websites window:', error);
        throw error;
    }
}

// Helper function for showing errors
function showError(el_window, title, message) {
    $(el_window).find('.mywebsites-content').html(`
        <div class="error-message">
            <h3>${title}</h3>
            <p>${message}</p>
            <button onclick="location.reload()" class="retry-btn">Retry</button>
        </div>
    `);
}

// Helper function for button states
function setButtonState($button, loading, icon, title) {
    $button.prop('disabled', loading).css('opacity', loading ? '0.6' : '1')
           .html(loading ? '⏳' : icon).attr('title', loading ? 'Processing...' : title);
}

async function initializeMyWebsites(el_window) {
    let allSites = [];
    let selectedSites = new Set();
    let currentSort = { column: null, direction: 'asc' };
    let isLoading = false;
    
    async function reloadWebsites() {
        if (isLoading) return;
        isLoading = true;
        
        try {
            $(el_window).find('.mywebsites-content').html('<div class="mywebsites-loading"><div class="loading-spinner"></div><p>Loading websites...</p></div>');
            // Use puter.hosting.list() to get all user's hosted websites
            const sites = await puter.hosting.list();
            console.log('Loaded sites:', sites); // Debug log
            
            // Ensure sites is an array
            allSites = Array.isArray(sites) ? sites : [];
            applyCurrentFiltersAndDisplay();
            updateSummary(allSites);
        } catch (error) {
            console.error('Failed to load websites:', error);
            showError(el_window, 'Failed to load websites', 'Unable to retrieve your websites. Please check your connection and try again.');
        } finally {
            isLoading = false;
        }
    }
    
    function applyCurrentFiltersAndDisplay() {
        const searchTerm = $(el_window).find('#mywebsites-search').val()?.toLowerCase() || '';
        const filterValue = $(el_window).find('#mywebsites-filter').val() || 'all';
        
        let filteredSites = allSites;
        
        if (searchTerm) {
            filteredSites = filteredSites.filter(site => 
                site.subdomain.toLowerCase().includes(searchTerm) ||
                (site.root_dir && site.root_dir.path.toLowerCase().includes(searchTerm))
            );
        }
        
        if (filterValue === 'active') {
            filteredSites = filteredSites.filter(site => site.root_dir);
        } else if (filterValue === 'inactive') {
            filteredSites = filteredSites.filter(site => !site.root_dir);
        }
        
        displayWebsites(filteredSites);
    }
    
    function updateSummary(sites) {
        const total = sites.length;
        const active = sites.filter(site => site.root_dir).length;
        $(el_window).find('#total-websites').text(`Total: ${total} websites`);
        $(el_window).find('#active-websites').text(`Active: ${active}`);
        $(el_window).find('#inactive-websites').text(`Inactive: ${total - active}`);
    }
    
    function displayWebsites(sites) {
        console.log('Displaying sites:', sites); // Debug log
        const content = $(el_window).find('.mywebsites-content');
        
        if (!sites || sites.length === 0) {
            content.html('<div class="no-websites"><h3>No websites found</h3><p>You haven\'t published any websites yet or no websites match your search criteria.</p></div>');
            return;
        }
        
        // Sort sites
        const sortedSites = [...sites].sort((a, b) => {
            let comparison = 0;
            switch (currentSort.column) {
                case 'subdomain': comparison = a.subdomain.localeCompare(b.subdomain); break;
                case 'status': comparison = (!!a.root_dir === !!b.root_dir) ? 0 : (!!a.root_dir ? -1 : 1); break;
                case 'created': comparison = new Date(a.created_at || 0) - new Date(b.created_at || 0); break;
                default: return 0;
            }
            return currentSort.direction === 'desc' ? -comparison : comparison;
        });
        
        const getSortArrow = (column) => currentSort.column !== column ? '⇅' : (currentSort.direction === 'asc' ? '↑' : '↓');
        
        let html = `<div class="websites-table-container"><table class="websites-table">
            <thead><tr>
                <th width="40"></th>
                <th width="80" class="sortable-header" data-column="status" title="Click to sort by status">Status <span class="sort-arrow">${getSortArrow('status')}</span></th>
                <th class="sortable-header" data-column="subdomain" title="Click to sort by subdomain">Subdomain <span class="sort-arrow">${getSortArrow('subdomain')}</span></th>
                <th>Location</th>
                <th class="sortable-header" data-column="created" title="Click to sort by creation date">Created <span class="sort-arrow">${getSortArrow('created')}</span></th>
                <th width="160">Actions</th>
            </tr></thead><tbody>`;
        
        sortedSites.forEach(site => {
            const isActive = !!site.root_dir;
            const dateCreated = site.created_at ? new Date(site.created_at).toLocaleDateString() : 'Unknown';
            const statusClass = isActive ? 'status-active' : 'status-inactive';
            
            html += `<tr class="website-row" data-uuid="${site.uid}">
                <td><input type="checkbox" class="website-checkbox" data-uuid="${site.uid}"></td>
                <td><span class="status-badge ${statusClass}">${isActive ? 'Active' : 'Inactive'}</span></td>
                <td><a href="https://${site.subdomain}.puter.site" target="_blank" class="subdomain-link" title="Visit website">${site.subdomain}.puter.site</a></td>
                <td>${site.root_dir ? `<span class="folder-path" data-path="${site.root_dir.path}" data-uuid="${site.root_dir.id}" data-name="${site.root_dir.name}" title="${site.root_dir.path}">${site.root_dir.path}</span>` : '<span class="no-location">No folder assigned</span>'}</td>
                <td><span class="date-text">${dateCreated}</span></td>
                <td><div class="action-buttons">
                    ${site.root_dir ? `<button class="action-btn primary open-folder" data-path="${site.root_dir.path}" data-uuid="${site.root_dir.id}" data-name="${site.root_dir.name}" title="Open folder">📁</button>` : ''}
                    <button class="action-btn secondary update-location" data-uuid="${site.uid}" data-subdomain="${site.subdomain}" title="Change location">📍</button>
                    <button class="action-btn warning release-subdomain" data-uuid="${site.uid}" data-subdomain="${site.subdomain}" title="Release subdomain">🔓</button>
                    <button class="action-btn danger delete-website" data-uuid="${site.uid}" data-subdomain="${site.subdomain}" data-dir-uuid="${site.root_dir ? site.root_dir.id : ''}" title="Delete website">🗑️</button>
                </div></td>
            </tr>`;
        });
        
        html += '</tbody></table></div>';
        content.html(html);
        attachEventHandlers();
    }
    
    function attachEventHandlers() {
        // Open folder
        $(el_window).off('click', '.open-folder').on('click', '.open-folder', function(e) {
            e.preventDefault();
            const $btn = $(this);
            try {
                UIWindow({
                    path: $btn.data('path'),
                    title: $btn.data('name'),
                    icon: window.icons['folder.svg'],
                    uid: $btn.data('uuid'),
                    is_dir: true,
                    app: 'explorer',
                });
            } catch (error) {
                console.error('Failed to open folder:', error);
            }
        });
        
        // Folder path click
        $(el_window).off('click', '.folder-path').on('click', '.folder-path', function(e) {
            e.preventDefault();
            const $path = $(this);
            try {
                UIWindow({
                    path: $path.data('path'),
                    title: $path.data('name'),
                    icon: window.icons['folder.svg'],
                    uid: $path.data('uuid'),
                    is_dir: true,
                    app: 'explorer',
                });
            } catch (error) {
                console.error('Failed to open folder:', error);
            }
        });
        
        // Update location
        $(el_window).off('click', '.update-location').on('click', '.update-location', async function(e) {
            e.preventDefault();
            const $button = $(this);
            const subdomain = $button.data('subdomain');
            const siteUuid = $button.data('uuid');
            
            setButtonState($button, true, '📍', 'Change location');
            
            try {
                // Use puter.ui.showDirectoryPicker since this is internal system code
                const newDirectory = await puter.ui.showDirectoryPicker();
                
                if (newDirectory?.path) {
                    // Use puter.hosting.update to change the website's folder location
                    await puter.hosting.update(subdomain, newDirectory.path);
                    await UIAlert({ message: `Website location updated!\n\n"${subdomain}.puter.site" now points to "${newDirectory.path}"`, buttons: [{label: 'OK'}] });
                    await reloadWebsites();
                }
            } catch (error) {
                console.error('Failed to update location:', error);
                await UIAlert({ message: `Failed to update website location. ${error.message || 'Please try again.'}`, buttons: [{label: 'OK'}] });
            } finally {
                setButtonState($button, false, '📍', 'Change location');
            }
        });
        
        // Release subdomain
        $(el_window).off('click', '.release-subdomain').on('click', '.release-subdomain', async function(e) {
            e.preventDefault();
            const $button = $(this);
            const subdomain = $button.data('subdomain');
            const siteUuid = $button.data('uuid');
            
            const confirmation = await UIAlert({
                message: `Are you sure you want to release "${subdomain}.puter.site"?\n\nThis action cannot be undone.`,
                buttons: [
                    {label: 'Release Subdomain', value: 'yes', type: 'primary'},
                    {label: 'Cancel', value: 'cancel'}
                ]
            });
            
            if (confirmation === 'yes') {
                setButtonState($button, true, '🔓', 'Release subdomain');
                try {
                    // Use puter.hosting.delete to release the subdomain
                    await puter.hosting.delete(subdomain);
                    await UIAlert({ message: `Subdomain "${subdomain}.puter.site" released successfully!`, buttons: [{label: 'OK'}] });
                    await reloadWebsites();
                } catch (error) {
                    console.error('Failed to release subdomain:', error);
                    await UIAlert({ message: `Failed to release subdomain. ${error.message || 'Please try again.'}`, buttons: [{label: 'OK'}] });
                    setButtonState($button, false, '🔓', 'Release subdomain');
                }
            }
        });
        
        // Delete website
        $(el_window).off('click', '.delete-website').on('click', '.delete-website', async function(e) {
            e.preventDefault();
            const $button = $(this);
            const subdomain = $button.data('subdomain');
            const siteUuid = $button.data('uuid');
            const dirUuid = $button.data('dir-uuid');
            
            const confirmation = await UIAlert({
                message: `Are you sure you want to DELETE "${subdomain}.puter.site" and ALL its files?\n\nThis action cannot be undone.`,
                buttons: [
                    {label: 'Delete Everything', value: 'yes', type: 'primary'},
                    {label: 'Cancel', value: 'cancel'}
                ]
            });
            
            if (confirmation === 'yes') {
                setButtonState($button, true, '🗑️', 'Delete website');
                try {
                    // First release the subdomain using puter.hosting.delete
                    await puter.hosting.delete(subdomain);
                    
                    // Then delete the folder if it exists using puter.fs.delete
                    if (dirUuid) {
                        const folderPath = $(el_window).find(`.folder-path[data-uuid="${dirUuid}"]`).data('path');
                        if (folderPath) {
                            try {
                                await puter.fs.delete(folderPath, { recursive: true });
                            } catch (fsError) {
                                console.warn('Failed to delete folder:', fsError);
                            }
                        }
                    }
                    
                    await UIAlert({ message: `Website "${subdomain}.puter.site" deleted successfully!`, buttons: [{label: 'OK'}] });
                    await reloadWebsites();
                } catch (error) {
                    console.error('Failed to delete website:', error);
                    await UIAlert({ message: `Failed to delete website. ${error.message || 'Please try again.'}`, buttons: [{label: 'OK'}] });
                    setButtonState($button, false, '🗑️', 'Delete website');
                }
            }
        });
        
        // Checkbox changes
        $(el_window).on('change', '.website-checkbox', function() {
            const siteUuid = $(this).data('uuid');
            if ($(this).is(':checked')) {
                selectedSites.add(siteUuid);
            } else {
                selectedSites.delete(siteUuid);
            }
            $(el_window).find('.bulk-section')[selectedSites.size > 0 ? 'show' : 'hide']();
        });
    }
    
    // Event listeners
    $(el_window).find('#mywebsites-search').on('input', applyCurrentFiltersAndDisplay);
    $(el_window).find('#mywebsites-filter').on('change', applyCurrentFiltersAndDisplay);
    
    // Sorting
    $(el_window).on('click', '.sortable-header', function() {
        const column = $(this).data('column');
        currentSort = {
            column,
            direction: currentSort.column === column && currentSort.direction === 'asc' ? 'desc' : 'asc'
        };
        applyCurrentFiltersAndDisplay();
    });
    
    // Bulk actions
    $(el_window).find('#select-all').on('click', () => {
        $('.website-checkbox').prop('checked', true).trigger('change');
    });
    
    $(el_window).find('#clear-selection').on('click', () => {
        $('.website-checkbox').prop('checked', false).trigger('change');
        selectedSites.clear();
        $(el_window).find('.bulk-section').hide();
    });
    
    async function bulkOperation(operation) {
        if (selectedSites.size === 0) return;
        
        const isDelete = operation === 'delete';
        const confirmation = await UIAlert({
            message: `Are you sure you want to ${isDelete ? 'DELETE' : 'release'} ${selectedSites.size} selected websites${isDelete ? ' and ALL their files' : ''}?\n\nThis action cannot be undone.`,
            buttons: [
                {label: isDelete ? 'Delete All Selected' : 'Release All Selected', value: 'yes', type: 'primary'},
                {label: 'Cancel', value: 'cancel'}
            ]
        });
        
        if (confirmation === 'yes') {
            let successCount = 0, errorCount = 0;
            $(el_window).find('#bulk-release, #bulk-delete').prop('disabled', true).css('opacity', '0.6');
            
            for (const siteUuid of selectedSites) {
                try {
                    const row = $(el_window).find(`.website-row[data-uuid="${siteUuid}"]`);
                    const subdomain = row.find('.subdomain-link').text().replace('.puter.site', '');
                    
                    if (subdomain) {
                        // Use puter.hosting.delete to release subdomain
                        await puter.hosting.delete(subdomain);
                        
                        if (isDelete) {
                            const dirUuid = row.find('.delete-website').data('dir-uuid');
                            if (dirUuid) {
                                const folderPath = row.find('.folder-path').data('path');
                                if (folderPath) {
                                    try {
                                        // Use puter.fs.delete to delete folder
                                        await puter.fs.delete(folderPath, { recursive: true });
                                    } catch (fsError) {
                                        console.warn(`Failed to delete folder for ${subdomain}:`, fsError);
                                    }
                                }
                            }
                        }
                        successCount++;
                    } else {
                        errorCount++;
                    }
                } catch (error) {
                    console.error(`Failed to ${operation} website ${siteUuid}:`, error);
                    errorCount++;
                }
            }
            
            selectedSites.clear();
            $(el_window).find('.bulk-section').hide();
            $(el_window).find('#bulk-release, #bulk-delete').prop('disabled', false).css('opacity', '1');
            
            await UIAlert({
                message: `Bulk operation completed!\n\nSuccessfully ${isDelete ? 'deleted' : 'released'}: ${successCount} websites${errorCount > 0 ? `\nFailed: ${errorCount} websites` : ''}`,
                buttons: [{label: 'OK'}]
            });
            
            await reloadWebsites();
        }
    }
    
    $(el_window).find('#bulk-release').on('click', () => bulkOperation('release'));
    $(el_window).find('#bulk-delete').on('click', () => bulkOperation('delete'));
    
    window.reloadWebsites = reloadWebsites;
    el_window.reloadWebsites = reloadWebsites;
    await reloadWebsites();
}

function addCustomStyles() {
    if (document.querySelector('#mywebsites-custom-styles')) return;
    
    const styles = `
        .mywebsites-container { height: 100%; display: flex; flex-direction: column; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 0; }
        .mywebsites-header { padding: 20px 24px; background: #fff; border-bottom: 1px solid #e1e8ed; flex-shrink: 0; }
        .mywebsites-controls { display: flex; justify-content: space-between; align-items: center; gap: 20px; }
        .search-section { display: flex; gap: 12px; align-items: center; }
        .search-section input, .search-section select { padding: 8px 12px; border: 1px solid #d1d9e0; border-radius: 4px; font-size: 14px; background: #fff; }
        .search-section input { min-width: 250px; }
        .search-section input:focus { outline: none; border-color: #007bff; box-shadow: 0 0 0 2px rgba(0,123,255,0.1); }
        .search-section select { min-width: 180px; }
        .bulk-section { display: flex; gap: 8px; align-items: center; }
        .control-btn { padding: 8px 12px; border: 1px solid #d1d9e0; border-radius: 4px; font-size: 16px; cursor: pointer; transition: all 0.2s; background: #fff; color: #495057; min-width: 40px; display: flex; align-items: center; justify-content: center; }
        .control-btn:hover { background: #f8f9fa; border-color: #adb5bd; }
        .control-btn.danger { background: #dc3545; color: white; border-color: #dc3545; }
        .control-btn.danger:hover { background: #c82333; border-color: #c82333; }
        .mywebsites-content { flex: 1; overflow: auto; background: #fff; min-height: 0; }
        .websites-table-container { width: 100%; height: 100%; }
        .websites-table { width: 100%; border-collapse: collapse; font-size: 14px; }
        .websites-table th { background: #f8f9fa; padding: 16px 20px; text-align: left; font-weight: 600; color: #495057; border-bottom: 2px solid #e9ecef; position: sticky; top: 0; z-index: 10; }
        .sortable-header { cursor: pointer; user-select: none; transition: background-color 0.2s; }
        .sortable-header:hover { background: #e9ecef !important; }
        .sort-arrow { font-size: 12px; color: #6c757d; margin-left: 4px; display: inline-block; width: 10px; text-align: center; }
        .websites-table td { padding: 16px 20px; border-bottom: 1px solid #e9ecef; vertical-align: middle; }
        .website-row { transition: background-color 0.2s; }
        .website-row:hover { background: #f8f9fa; }
        .website-checkbox { width: 16px; height: 16px; cursor: pointer; }
        .status-badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
        .status-active { background: #d4edda; color: #155724; }
        .status-inactive { background: #fff3cd; color: #856404; }
        .subdomain-link { color: #007bff; text-decoration: none; font-weight: 500; }
        .subdomain-link:hover { text-decoration: underline; }
        .folder-path { cursor: pointer; color: #007bff; font-family: Monaco, monospace; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; max-width: 250px; }
        .folder-path:hover { text-decoration: underline; }
        .no-location { color: #6c757d; font-style: italic; }
        .date-text { color: #495057; font-size: 13px; }
        .action-buttons { display: flex; gap: 4px; justify-content: flex-start; align-items: center; flex-wrap: nowrap; }
        .action-btn { padding: 6px 8px; border: 1px solid transparent; border-radius: 4px; font-size: 18px; cursor: pointer; transition: all 0.2s; min-width: 34px; min-height: 34px; display: flex; align-items: center; justify-content: center; line-height: 1; }
        .action-btn.primary { background: #007bff; color: white; border-color: #007bff; }
        .action-btn.primary:hover { background: #0056b3; border-color: #0056b3; }
        .action-btn.secondary { background: #6c757d; color: white; border-color: #6c757d; }
        .action-btn.secondary:hover { background: #545b62; border-color: #545b62; }
        .action-btn.warning { background: #ffc107; color: #212529; border-color: #ffc107; }
        .action-btn.warning:hover { background: #e0a800; border-color: #e0a800; }
        .action-btn.danger { background: #dc3545; color: white; border-color: #dc3545; }
        .action-btn.danger:hover { background: #c82333; border-color: #c82333; }
        .action-btn:disabled, .control-btn:disabled { cursor: not-allowed; opacity: 0.6 !important; }
        .action-btn:disabled:hover, .control-btn:disabled:hover { transform: none; background: inherit; }
        .mywebsites-footer { padding: 15px 24px; background: #f8f9fa; border-top: 1px solid #e1e8ed; flex-shrink: 0; min-height: 50px; }
        .mywebsites-summary { display: flex; gap: 30px; font-size: 14px; color: #495057; align-items: center; }
        .mywebsites-summary span { font-weight: 500; }
        .no-websites { text-align: center; padding: 60px 20px; color: #6c757d; }
        .no-websites h3 { margin: 0 0 10px 0; font-size: 24px; }
        .no-websites p { margin: 0; font-size: 16px; }
        .mywebsites-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; color: #6c757d; }
        .loading-spinner { width: 32px; height: 32px; border: 3px solid #e9ecef; border-top: 3px solid #007bff; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 16px; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .error-message { text-align: center; padding: 60px 20px; color: #dc3545; }
        .error-message h3 { margin: 0 0 12px 0; font-size: 20px; font-weight: 600; }
        .error-message p { margin: 0 0 20px 0; font-size: 14px; }
        .retry-btn { padding: 10px 20px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; }
        .retry-btn:hover { background: #c82333; }
        @media (max-width: 1024px) { .mywebsites-controls { flex-direction: column; align-items: stretch; gap: 16px; } .search-section { flex-direction: column; align-items: stretch; } .search-section input, .search-section select { min-width: auto; width: 100%; } }
        @media (max-width: 768px) { .websites-table { font-size: 12px; } .websites-table th, .websites-table td { padding: 12px 8px; } .folder-path { max-width: 150px; } .action-buttons { flex-direction: column; } .action-btn { width: 100%; text-align: center; } .mywebsites-summary { flex-direction: column; gap: 8px; } }
    `;
    
    $('head').append(`<style id="mywebsites-custom-styles">${styles}</style>`);
}

export default UIWindowMyWebsites;
