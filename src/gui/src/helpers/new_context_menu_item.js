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

import UIPrompt from '../UI/UIPrompt.js';
import UIAlert from '../UI/UIAlert.js';
import refresh_item_container from './refresh_item_container.js';

// Initialize the favicon cache if it doesn't exist
window.favicon_cache = window.favicon_cache || {};

// Single, unified function for applying favicons to weblink items
function applyWeblinkIcon(item, faviconUrl, url) {
    // Validate inputs
    if (!item || !faviconUrl) return false;
    
    const $item = $(item);
    if (!$item.length) return false;
    
    try {
        // Clear any existing icons first to prevent stacking
        $item.find('img.item-icon').remove();
        
        // Create a fresh icon element
        const $icon = $('<img class="item-icon weblink-icon">');
        $item.prepend($icon);
        
        // Set core attributes
        $icon.attr({
            'src': faviconUrl,
            'data-icon': faviconUrl
        });
        
        // Handle loading errors
        $icon.on('error', function() {
            this.src = window.icons['link.svg'];
        });
        
        // Set essential item attributes
        $item.attr({
            'data-icon': faviconUrl,
            'data-weblink': 'true'
        });
        
        // Store in favicon cache
        if (url) {
            try {
                const domain = new URL(url).hostname;
                window.favicon_cache[domain] = faviconUrl;
                
                // Also store in localStorage for persistence
                localStorage.setItem(`favicon_${domain}`, faviconUrl);
                
                // Add domain to item attributes
                $item.attr('data-domain', domain);
            } catch (e) {
                console.error("Error processing URL:", e);
            }
        }
        
        return true;
    } catch (e) {
        console.error("Error applying weblink icon:", e);
        return false;
    }
}

// Set up global CSS once at startup
(function setupWeblinkStyles() {
    let styleTag = document.getElementById('weblink-global-styles');
    if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = 'weblink-global-styles';
        document.head.appendChild(styleTag);
        
        styleTag.textContent = `
            /* Ensure weblink icons are always visible */
            .item[data-weblink="true"] .item-icon,
            .item[data-name$=".weblink"] .item-icon,
            .weblink-icon {
                visibility: visible !important;
                opacity: 1 !important;
                display: block !important;
                width: 32px !important;
                height: 32px !important;
                margin: 0 auto !important;
                background-size: contain !important;
                object-fit: contain !important;
            }
            
            /* Hide .weblink extension completely */
            .item[data-name$=".weblink"] .item-name {
                visibility: hidden;
                position: relative;
            }
            
            /* Show only the site name */
            .item[data-name$=".weblink"] .item-name:after {
                content: attr(data-display-name);
                visibility: visible;
                position: absolute;
                left: 0;
                right: 0;
                text-align: center;
            }
            
            /* Prevent multiple icons */
            .item[data-weblink="true"] img.item-icon ~ img.item-icon {
                display: none !important;
            }
        `;
    }
    
    // Add a global hook to modify file names when displayed
    if (!window.originalItemNameDisplay) {
        // Backup the original function if it exists
        window.originalItemNameDisplay = window.update_item_name;
        
        // Override the function that updates item names
        window.update_item_name = function(item, newName) {
            // Call the original function first
            if (window.originalItemNameDisplay) {
                window.originalItemNameDisplay(item, newName);
            }
            
            // Then check if this is a weblink and modify the display
            if (item && $(item).length) {
                const $item = $(item);
                const itemName = $item.attr('data-name') || newName;
                
                // Check if this is a weblink
                if (itemName && itemName.toLowerCase().endsWith('.weblink')) {
                    // Extract the simple name (without extension)
                    const nameWithoutExt = itemName.replace(/\.weblink$/i, '');
                    
                    // Find the name element
                    const $nameEl = $item.find('.item-name');
                    if ($nameEl.length) {
                        // Store the full name in data attribute
                        $nameEl.attr('data-full-name', itemName);
                        $nameEl.attr('data-display-name', nameWithoutExt);
                        
                        // Set the text directly
                        $nameEl.text(nameWithoutExt);
                    }
                }
            }
        };
    }
})();

// Set up a global weblink item observer
(function setupWeblinkObserver() {
    // Skip if already initialized
    if (window.weblinkObserverInitialized) return;
    window.weblinkObserverInitialized = true;
    
    // Function to find and fix weblink items
    const fixWeblinkItems = () => {
        // Find all weblink items
        const weblinkItems = document.querySelectorAll('.item[data-name$=".weblink"]');
        
        weblinkItems.forEach(item => {
            const $item = $(item);
            
            // Skip if already processed
            if ($item.attr('data-weblink-processed') === 'true') return;
            
            // Apply icon
            const faviconUrl = $item.attr('data-icon') || $item.attr('data-favicon') || $item.attr('data-icon-url');
            const url = $item.attr('data-url');
            
            // Apply icons first
            if (faviconUrl) {
                applyWeblinkIcon(item, faviconUrl, url);
            }
            
            // Fix the display name
            const $nameEl = $item.find('.item-name');
            if ($nameEl.length) {
                const itemName = $item.attr('data-name');
                if (itemName) {
                    // Strip extension
                    const nameWithoutExt = itemName.replace(/\.weblink$/i, '');
                    
                    // Apply to display name
                    $nameEl.attr('data-full-name', itemName);
                    $nameEl.attr('data-display-name', nameWithoutExt);
                    $nameEl.text(nameWithoutExt);
                }
            }
            
            // Mark as processed to avoid duplicate processing
            $item.attr('data-weblink-processed', 'true');
        });
    };
    
    // Run immediately
    fixWeblinkItems();
    
    // Set up MutationObserver to watch for DOM changes
    const observer = new MutationObserver((mutations) => {
        let shouldFix = false;
        
        mutations.forEach(mutation => {
            // Check if we need to reapply icons and names
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                        if (
                            node.classList && 
                            (node.classList.contains('item') || node.querySelector('.item'))
                        ) {
                            shouldFix = true;
                            break;
                        }
                    }
                }
            }
        });
        
        if (shouldFix) {
            fixWeblinkItems();
        }
    });
    
    // Watch for changes to item names
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
        attributeFilter: ['data-name']
    });
    
    // Also run when desktop refreshes
    document.addEventListener('desktop-refreshed', fixWeblinkItems);
    document.addEventListener('directory-loaded', fixWeblinkItems);
})();

/**
 * Returns a context menu item to create a new folder and a variety of file types.
 * 
 * @param {string} dirname - The directory path to create the item in
 * @param {HTMLElement} append_to_element - Element to append the new item to 
 * @returns {Object} The context menu item object
 */

const new_context_menu_item = function(dirname, append_to_element){
    
    const baseItems = [
        // New Folder
        {
            html: i18n('new_folder'),
            icon: `<img src="${html_encode(window.icons['folder.svg'])}" class="ctx-item-icon">`,
            onClick: function() {
                window.create_folder(dirname, append_to_element);
            },
        },
        // divider
        '-',
        // Text Document
        {
            html: i18n('text_document'),
            icon: `<img src="${html_encode(window.icons['file-text.svg'])}" class="ctx-item-icon">`,
            onClick: async function() {
                window.create_file({dirname: dirname, append_to_element: append_to_element, name: 'New File.txt'});
            }
        },
        // HTML Document
        {
            html: i18n('html_document'),
            icon: `<img src="${html_encode(window.icons['file-html.svg'])}" class="ctx-item-icon">`,
            onClick: async function() {
                window.create_file({dirname: dirname, append_to_element: append_to_element, name: 'New File.html'});
            }
        },
        // Web Link
        {
            html: 'Web Link',
            icon: `<img src="${html_encode(window.icons['link.svg'])}" class="ctx-item-icon">`,
            onClick: async function() {
                // Prompt user for URL
                const url = await UIPrompt({
                    message: 'Enter the URL for the web link:',
                    placeholder: 'https://example.com',
                    defaultValue: 'https://',
                    validator: (value) => {
                        // Simple URL validation
                        return value.startsWith('http://') || value.startsWith('https://') ?
                            true : 'Please enter a valid URL starting with http:// or https://';
                    }
                });
                
                if (url) {
                    // Extract domain for naming and favicon
                        try {
                            const urlObj = new URL(url);
                            const domain = urlObj.hostname;
                            
                        // Extract a simple name from the domain (e.g., "google" from "google.com")
                        let siteName = domain.replace(/^www\./, '');
                        
                        // Further simplify by removing the TLD (.com, .org, etc.)
                        siteName = siteName.split('.')[0];
                        
                        // Capitalize the first letter
                        siteName = siteName.charAt(0).toUpperCase() + siteName.slice(1);
                        
                        // Use simple name but keep .weblink extension for the file system
                        let linkName = siteName;
                        let fileName = linkName + '.weblink';
                        
                        // Get favicon URL from Google favicon service
                        let faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
                        
                        // Check if we have a cached favicon
                        if (window.favicon_cache[domain]) {
                            faviconUrl = window.favicon_cache[domain];
                        }
                        
                        // Store in favicon cache
                        window.favicon_cache[domain] = faviconUrl;

                        // Store the URL and favicon in a comprehensive JSON object
                        const weblink_content = JSON.stringify({
                            url: url,
                            faviconUrl: faviconUrl,
                            type: 'weblink',
                            domain: domain,
                            created: Date.now(),
                            modified: Date.now(),
                            version: '2.0',
                            metadata: {
                                originalUrl: url,
                                originalFaviconUrl: faviconUrl,
                                linkName: linkName,
                                simpleName: siteName
                            }
                        });
                        
                        // Create the file with favicon
                        const item = await window.create_file({
                            dirname: dirname,
                            append_to_element: append_to_element,
                            name: fileName,
                            content: weblink_content,
                            icon: faviconUrl,
                            type: 'weblink',
                            metadata: JSON.stringify({
                                faviconUrl: faviconUrl,
                                url: url,
                                domain: domain,
                                timestamp: Date.now(),
                                version: '2.0'
                            }),
                            html_attributes: {
                                'data-weblink': 'true',
                                'data-icon': faviconUrl,
                                'data-url': url,
                                'data-domain': domain,
                                'data-display-name': linkName,
                                'data-hide-extension': 'true'
                            },
                            force_refresh: true,
                            class: 'weblink-item'
                        });
                        
                        // Apply icon using our consolidated function
                        if (item) {
                            applyWeblinkIcon(item, faviconUrl, url);
                            
                            // Ensure the item is visible in the container
                            const container = append_to_element || document.querySelector('.desktop, .explorer-container.active, .files-container.active');
                            if (container) {
                                // Force a refresh of the container
                                await refresh_item_container(dirname);
                                
                                // Hide the extension in the displayed name
                                const $item = $(item);
                                const $nameElement = $item.find('.item-name');
                                if ($nameElement.length > 0) {
                                    // Store the original name for reference
                                    $nameElement.attr('data-full-name', fileName);
                                    $nameElement.attr('data-display-name', linkName);
                                    
                                    // Set the text directly (no extension)
                                    $nameElement.text(linkName);
                                }
                                
                                // If this is the desktop, trigger a desktop refresh
                                if (container.classList.contains('desktop')) {
                                    if (typeof window.refresh_desktop === 'function') {
                                        window.refresh_desktop();
                                    } else if (typeof window.refresh_desktop_items === 'function') {
                                        window.refresh_desktop_items();
                                    }
                                }
                                
                                // Trigger a custom event to ensure icon is properly applied
                                const event = new CustomEvent('weblink-created', {
                                    detail: {
                                        item: item,
                                        url: url,
                                        faviconUrl: faviconUrl
                                    }
                                });
                                document.dispatchEvent(event);
                            }
                        }
                    } catch (error) {
                        console.error("Error creating web link:", error);
                        UIAlert("Error creating web link: " + error.message);
                    }
                }
            }
        },
        // JPG Image
        {
            html: i18n('jpeg_image'),
            icon: `<img src="${html_encode(window.icons['file-image.svg'])}" class="ctx-item-icon">`,
            onClick: async function() {
                var canvas = document.createElement("canvas");

                canvas.width = 800;
                canvas.height = 600;

                canvas.toBlob((blob) => {
                    window.create_file({dirname: dirname, append_to_element: append_to_element, name: 'New Image.jpg', content: blob});
                });
            }
        },
    ];

    //Show file_templates on the lower part of "New"
    if (window.file_templates.length > 0) {
        // divider
        baseItems.push('-');

        // User templates
        baseItems.push({
            html: "User templates",
            icon: `<img src="${html_encode(window.icons['file-template.svg'])}" class="ctx-item-icon">`,
            items: window.file_templates.map(template => ({
                html: template.html,
                icon: `<img src="${html_encode(window.icons[`file-${template.extension}.svg`])}" class="ctx-item-icon">`,
                onClick: async function () {
                    const content = await puter.fs.read(template.path);
                    window.create_file({
                        dirname: dirname,
                        append_to_element: append_to_element,
                        name: template.name,
                        content,
                    });
                }
            }))
        });
    } else {
        // baseItems.push({
        //     html: "No templates found",
        //     icon: `<img src="${html_encode(window.icons['file-template.svg'])}" class="ctx-item-icon">`,
        // });
    }

    //Conditional rendering for the templates
    return {
        html: i18n('new'),
        items: baseItems
    };
}

export default new_context_menu_item;