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

// Initialize global weblink icon persistence system
(function initializeWeblinkIconSystem() {
    // Create global cache for favicons if it doesn't exist
    if (!window.favicon_cache) {
        window.favicon_cache = {};
    }
    
    // Load cached favicons from localStorage
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('favicon_')) {
                const domain = key.replace('favicon_', '');
                const value = localStorage.getItem(key);
                window.favicon_cache[domain] = value;
            }
        }
    } catch (e) {
        console.error("Error loading cached favicons:", e);
    }
    
    // Create a global MutationObserver to watch for new weblink items
    try {
        // Function to apply favicon to a weblink item
        const applyFaviconToWeblinkItem = (item) => {
            // Check if this is a weblink item
            if (!item || !item.classList || !item.classList.contains('item')) return;
            
            const fileName = item.getAttribute('data-name');
            if (!fileName || !fileName.toLowerCase().endsWith('.weblink')) return;
            
            console.log("Found weblink item:", fileName);
            
            // Try to get the favicon URL from various sources
            let faviconUrl = null;
            
            // 1. Check if the item already has a favicon URL stored
            faviconUrl = item.getAttribute('data-icon-url') ||
                         item.getAttribute('data-favicon') ||
                         item.getAttribute('data-icon');
            
            // 2. If not, try to extract the domain from the item's data
            if (!faviconUrl) {
                const itemUrl = item.getAttribute('data-url');
                if (itemUrl) {
                    try {
                        const urlObj = new URL(itemUrl);
                        const domain = urlObj.hostname;
                        
                        // Check if we have a cached favicon for this domain
                        faviconUrl = window.favicon_cache[domain];
                        
                        // If not, use the default icon
                        if (!faviconUrl) {
                            faviconUrl = window.icons['link.svg'];
                        }
                    } catch (e) {
                        console.error("Error extracting domain from URL:", e);
                        faviconUrl = window.icons['link.svg'];
                    }
                }
            }
            
            // If we still don't have a favicon URL, use the default icon
            if (!faviconUrl) {
                faviconUrl = window.icons['link.svg'];
            }
            
            console.log("Using favicon URL for weblink item:", faviconUrl);
            
            // Apply the favicon to the item
            // 1. Find the icon element
            const iconElement = item.querySelector('img.item-icon');
            if (iconElement) {
                // Set the src attribute
                iconElement.src = faviconUrl;
                
                // Add data attributes to prevent the icon from being changed
                iconElement.setAttribute('data-original-icon', faviconUrl);
                iconElement.setAttribute('data-icon-locked', 'true');
                
                // Add !important to the style to prevent it from being overridden
                iconElement.style.cssText = `
                    width: 32px !important;
                    height: 32px !important;
                    content: url('${faviconUrl}') !important;
                    background-image: url('${faviconUrl}') !important;
                `;
                
                console.log("Applied favicon to icon element");
            }
            
            // 2. Set data attributes on the item element
            item.setAttribute('data-icon', faviconUrl);
            item.setAttribute('data-original-icon', faviconUrl);
            item.setAttribute('data-icon-locked', 'true');
            item.setAttribute('data-weblink-icon', faviconUrl);
            
            // 3. Add a style tag with !important rules for this specific item
            const itemId = item.id || item.getAttribute('data-uid') || `weblink-${Date.now()}`;
            if (!item.id) {
                item.id = itemId;
            }
            
            const styleId = `style-${itemId}`;
            let styleTag = document.getElementById(styleId);
            if (!styleTag) {
                styleTag = document.createElement('style');
                styleTag.id = styleId;
                document.head.appendChild(styleTag);
            }
            
            styleTag.textContent = `
                #${itemId} img.item-icon,
                [data-uid="${itemId}"] img.item-icon {
                    content: url('${faviconUrl}') !important;
                    background-image: url('${faviconUrl}') !important;
                }
            `;
            
            console.log("Added style tag for weblink item");
        };
        
        // Create a MutationObserver to watch for new weblink items
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                // Check if any new nodes were added
                if (mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach((node) => {
                        // Check if this is an element node
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // Check if this is a weblink item
                            if (node.classList && node.classList.contains('item')) {
                                const fileName = node.getAttribute('data-name');
                                if (fileName && fileName.toLowerCase().endsWith('.weblink')) {
                                    console.log("MutationObserver: Found new weblink item:", fileName);
                                    applyFaviconToWeblinkItem(node);
                                }
                            }
                            
                            // Also check children for weblink items
                            const weblinkItems = node.querySelectorAll('.item[data-name$=".weblink"]');
                            if (weblinkItems.length > 0) {
                                console.log("MutationObserver: Found new weblink items in children:", weblinkItems.length);
                                weblinkItems.forEach(applyFaviconToWeblinkItem);
                            }
                        }
                    });
                }
                
                // Check if any attributes were modified
                if (mutation.type === 'attributes' &&
                    mutation.attributeName === 'src' &&
                    mutation.target.classList &&
                    mutation.target.classList.contains('item-icon')) {
                    
                    // Check if this is a weblink item icon
                    const item = mutation.target.closest('.item[data-name$=".weblink"]');
                    if (item) {
                        const originalIcon = mutation.target.getAttribute('data-original-icon');
                        if (originalIcon && mutation.target.src !== originalIcon) {
                            console.log("MutationObserver: Weblink icon src changed, resetting");
                            mutation.target.src = originalIcon;
                        }
                    }
                }
            });
        });
        
        // Start observing the document
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'data-name']
        });
        
        // Store the observer in a global variable to prevent garbage collection
        window.weblinkIconObserver = observer;
        
        console.log("Global weblink icon persistence system initialized");
        
        // Add global CSS rules to ensure all weblink icons are properly displayed
        try {
            console.log("Adding global CSS rules for weblink icons");
            
            // Create a global style tag for weblink icons if it doesn't exist
            let globalStyleTag = document.getElementById('weblink-icons-global-style');
            if (!globalStyleTag) {
                globalStyleTag = document.createElement('style');
                globalStyleTag.id = 'weblink-icons-global-style';
                document.head.appendChild(globalStyleTag);
            }
            
            // Add comprehensive CSS rules to ensure icons are displayed correctly
            globalStyleTag.textContent = `
                /* Ensure weblink icons are always visible */
                .item[data-name$=".weblink"] .item-icon,
                .weblink-item .item-icon,
                .item[data-weblink="true"] .item-icon,
                .item[data-has-custom-icon="true"] .item-icon {
                    visibility: visible !important;
                    opacity: 1 !important;
                    display: block !important;
                }
                
                /* Ensure persistent icons are not overridden */
                .persistent-icon {
                    width: 32px !important;
                    height: 32px !important;
                }
                
                /* Force immediate display of icons */
                .item[data-icon-locked="true"] .item-icon {
                    visibility: visible !important;
                    opacity: 1 !important;
                    display: block !important;
                }
            `;
            
            console.log("Global CSS rules added for weblink icons");
        } catch (e) {
            console.error("Error adding global CSS rules:", e);
        }
        
        // Apply favicons to existing weblink items
        setTimeout(() => {
            const existingWeblinkItems = document.querySelectorAll('.item[data-name$=".weblink"]');
            if (existingWeblinkItems.length > 0) {
                console.log("Found existing weblink items:", existingWeblinkItems.length);
                existingWeblinkItems.forEach(applyFaviconToWeblinkItem);
            }
        }, 500);
        
        // Also apply favicons periodically to catch any items that might have been missed
        setInterval(() => {
            const weblinkItems = document.querySelectorAll('.item[data-name$=".weblink"]');
            if (weblinkItems.length > 0) {
                weblinkItems.forEach(applyFaviconToWeblinkItem);
            }
        }, 5000);
        
    } catch (e) {
        console.error("Error setting up global weblink icon persistence system:", e);
    }
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
                    try {
                        // Get a name for the link based on the URL
                        let linkName = 'New Link';
                        try {
                            // Try to extract a name from the URL
                            const urlObj = new URL(url);
                            linkName = urlObj.hostname.replace(/^www\./, '');
                            console.log("Extracted link name from URL:", linkName);
                        } catch (e) {
                            // If URL parsing fails, use default name
                            console.error("Error parsing URL:", e);
                        }

                        // Try to fetch and preload the favicon using multiple sources
                        let faviconUrl = null;
                        try {
                            const urlObj = new URL(url);
                            const domain = urlObj.hostname;
                            
                            // Define multiple favicon sources to try
                            const faviconSources = [
                                // Direct favicon.ico from the domain root (most reliable)
                                `https://${domain}/favicon.ico`,
                                // DuckDuckGo's favicon service
                                `https://icons.duckduckgo.com/ip3/${domain}.ico`,
                                // Google's favicon service with higher resolution
                                `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
                                // Fallback to Google's service with no size parameter
                                `https://www.google.com/s2/favicons?domain=${domain}`,
                                // Final fallback to default icon
                                window.icons['link.svg']
                            ];
                            
                            console.log("Attempting to fetch favicon from multiple sources");
                            
                            // Try each source in sequence until one works
                            for (const source of faviconSources) {
                                try {
                                    console.log("Trying favicon source:", source);
                                    
                                    // Skip the default icon in the validation check
                                    if (source === window.icons['link.svg']) {
                                        console.log("Using default icon as last resort");
                                        faviconUrl = source;
                                        break;
                                    }
                                    
                                    // Preload the favicon to ensure it's in the browser cache
                                    const isValid = await new Promise((resolve) => {
                                        const preloadImg = new Image();
                                        
                                        // Set a small size to force loading
                                        preloadImg.style.width = '1px';
                                        preloadImg.style.height = '1px';
                                        preloadImg.style.position = 'absolute';
                                        preloadImg.style.opacity = '0.01';
                                        
                                        // Add to DOM to force loading
                                        document.body.appendChild(preloadImg);
                                        
                                        preloadImg.onload = () => {
                                            // Check if the image is a valid favicon (not a placeholder)
                                            // Create a canvas to analyze the image
                                            const canvas = document.createElement('canvas');
                                            const ctx = canvas.getContext('2d');
                                            canvas.width = preloadImg.width;
                                            canvas.height = preloadImg.height;
                                            
                                            // Draw the image to the canvas
                                            ctx.drawImage(preloadImg, 0, 0);
                                            
                                            // Get the image data
                                            let imageData;
                                            try {
                                                imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                                            } catch (e) {
                                                console.warn("Could not get image data (CORS issue):", e);
                                                // If we can't analyze the image due to CORS, assume it's valid
                                                document.body.removeChild(preloadImg);
                                                resolve(true);
                                                return;
                                            }
                                            
                                            // Check if the image is a single letter (Google's fallback)
                                            // This is a heuristic: if most pixels are transparent or the same color,
                                            // it's likely a placeholder with a letter
                                            const data = imageData.data;
                                            let transparentPixels = 0;
                                            let colorCounts = {};
                                            
                                            for (let i = 0; i < data.length; i += 4) {
                                                // Check for transparency
                                                if (data[i + 3] < 10) {
                                                    transparentPixels++;
                                                } else {
                                                    // Count colors
                                                    const color = `${data[i]},${data[i + 1]},${data[i + 2]}`;
                                                    colorCounts[color] = (colorCounts[color] || 0) + 1;
                                                }
                                            }
                                            
                                            // Calculate total pixels
                                            const totalPixels = canvas.width * canvas.height;
                                            
                                            // If more than 90% of pixels are transparent, it's likely not a real favicon
                                            if (transparentPixels / totalPixels > 0.9) {
                                                console.warn("Image is mostly transparent, likely not a real favicon");
                                                document.body.removeChild(preloadImg);
                                                resolve(false);
                                                return;
                                            }
                                            
                                            // If one color dominates (>80% of non-transparent pixels), it might be a letter
                                            const nonTransparentPixels = totalPixels - transparentPixels;
                                            let dominantColorCount = 0;
                                            
                                            for (const color in colorCounts) {
                                                if (colorCounts[color] > dominantColorCount) {
                                                    dominantColorCount = colorCounts[color];
                                                }
                                            }
                                            
                                            // If one color is dominant and the image is small, it might be a letter
                                            if (dominantColorCount / nonTransparentPixels > 0.8 &&
                                                canvas.width <= 64 && canvas.height <= 64) {
                                                console.warn("Image has a dominant color, might be a letter placeholder");
                                                document.body.removeChild(preloadImg);
                                                resolve(false);
                                                return;
                                            }
                                            
                                            // If we get here, the image is likely a valid favicon
                                            console.log("Image appears to be a valid favicon");
                                            document.body.removeChild(preloadImg);
                                            resolve(true);
                                        };
                                        
                                        preloadImg.onerror = () => {
                                            console.warn("Failed to load favicon from source:", source);
                                            if (document.body.contains(preloadImg)) {
                                                document.body.removeChild(preloadImg);
                                            }
                                            resolve(false);
                                        };
                                        
                                        // Set a timeout in case the image takes too long to load
                                        setTimeout(() => {
                                            if (!preloadImg.complete) {
                                                console.warn("Favicon preload timed out for source:", source);
                                                if (document.body.contains(preloadImg)) {
                                                    document.body.removeChild(preloadImg);
                                                }
                                                resolve(false);
                                            }
                                        }, 1500);
                                        
                                        // Start loading the image
                                        preloadImg.src = source;
                                    });
                                    
                                    if (isValid) {
                                        console.log("Found valid favicon at:", source);
                                        faviconUrl = source;
                                        break;
                                    }
                                } catch (sourceError) {
                                    console.warn("Error trying favicon source:", sourceError);
                                    // Continue to the next source
                                }
                            }
                            
                            // If no valid favicon was found, use the default icon
                            if (!faviconUrl) {
                                console.log("No valid favicon found, using default icon");
                                faviconUrl = window.icons['link.svg'];
                            }
                            
                            // Create a permanent copy of the favicon in the DOM to ensure it's always available
                            const faviconId = `favicon-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
                            const faviconImg = document.createElement('img');
                            faviconImg.id = faviconId;
                            faviconImg.src = faviconUrl;
                            faviconImg.style.position = 'absolute';
                            faviconImg.style.width = '1px';
                            faviconImg.style.height = '1px';
                            faviconImg.style.opacity = '0.01';
                            faviconImg.style.pointerEvents = 'none';
                            faviconImg.style.left = '-9999px';
                            faviconImg.setAttribute('data-permanent-favicon', 'true');
                            faviconImg.setAttribute('data-domain', domain);
                            document.body.appendChild(faviconImg);
                            
                            // Store the favicon in a global cache
                            if (!window.favicon_cache) {
                                window.favicon_cache = {};
                            }
                            window.favicon_cache[domain] = faviconUrl;
                            
                            // Also store in localStorage for persistence
                            try {
                                localStorage.setItem(`favicon_${domain}`, faviconUrl);
                            } catch (e) {
                                console.error("Error storing favicon in localStorage:", e);
                            }
                            
                        } catch (e) {
                            console.error("Error in favicon fetching process:", e);
                            faviconUrl = window.icons['link.svg'];
                        }

                        // Store the URL and favicon in a comprehensive JSON object
                        const weblink_content = JSON.stringify({
                            url: url,
                            faviconUrl: faviconUrl,
                            iconDataUrl: faviconUrl, // For backward compatibility
                            type: 'weblink',
                            domain: new URL(url).hostname,
                            created: Date.now(),
                            modified: Date.now(),
                            version: '2.0',
                            metadata: {
                                originalUrl: url,
                                originalFaviconUrl: faviconUrl,
                                linkName: linkName
                            }
                        });
                        
                        console.log("Creating weblink file:", {
                            dirname: dirname,
                            name: linkName + '.weblink',
                            content: weblink_content,
                            url: url,
                            faviconUrl: faviconUrl
                        });
                        
                        // Create the file with favicon - with enhanced metadata and attributes
                        const item = await window.create_file({
                            dirname: dirname,
                            append_to_element: append_to_element,
                            name: linkName + '.weblink',
                            content: weblink_content,
                            icon: faviconUrl,
                            type: 'weblink',
                            metadata: JSON.stringify({
                                faviconUrl: faviconUrl,
                                iconDataUrl: faviconUrl, // Add for backward compatibility
                                url: url,
                                domain: new URL(url).hostname,
                                timestamp: Date.now(),
                                version: '2.0' // Version to identify enhanced weblinks
                            }),
                            // Add comprehensive HTML attributes to force the icon to be visible
                            html_attributes: {
                                'data-has-custom-icon': 'true',
                                'data-icon-url': faviconUrl,
                                'data-weblink': 'true',
                                'data-favicon': faviconUrl,
                                'data-original-icon': faviconUrl,
                                'data-icon-locked': 'true',
                                'data-weblink-icon': faviconUrl,
                                'data-url': url,
                                'data-domain': new URL(url).hostname,
                                'data-icon-version': '2.0',
                                'style': `--icon-url: url('${faviconUrl}') !important;`
                            },
                            // Add any additional parameters that might help with visibility
                            force_refresh: true,
                            show_immediately: true,
                            skip_history: false,
                            priority: 'high',
                            // Add custom CSS class for targeting
                            class: 'weblink-item persistent-icon-item'
                        });
                        
                        // Store the URL and favicon in localStorage for extra reliability
                        if (item) {
                            const uid = $(item).attr('data-uid');
                            if (uid) {
                                localStorage.setItem('weblink_' + uid, url);
                                localStorage.setItem('weblink_icon_' + uid, faviconUrl);
                                
                                // Also store by domain for cross-item consistency
                                try {
                                    const domain = new URL(url).hostname;
                                    localStorage.setItem('favicon_' + domain, faviconUrl);
                                } catch (e) {
                                    console.error("Error storing domain favicon:", e);
                                }
                            }
                        }
                        
                        // If the item was created successfully, ensure the icon is set
                        if (item) {
                            const $item = $(item);
                            
                            // Apply icon in multiple ways to ensure it's visible and persists
                            const applyIcon = async () => {
                                console.log("Applying persistent icon to item:", faviconUrl);
                                
                                // APPROACH 1: Replace the entire icon element with a persistent one
                                const $icon = $item.find('img.item-icon');
                                if ($icon.length > 0) {
                                    // Create a completely new image element with enhanced attributes
                                    const newIconElement = document.createElement('img');
                                    newIconElement.className = 'item-icon persistent-icon';
                                    newIconElement.src = faviconUrl;
                                    
                                    // Add important styling to prevent overrides
                                    newIconElement.style.cssText = `
                                        width: 32px !important;
                                        height: 32px !important;
                                        content: url('${faviconUrl}') !important;
                                        background-image: url('${faviconUrl}') !important;
                                        background-size: contain !important;
                                        background-repeat: no-repeat !important;
                                        background-position: center !important;
                                    `;
                                    
                                    // Add data attributes to prevent the icon from being changed
                                    newIconElement.setAttribute('data-icon', faviconUrl);
                                    newIconElement.setAttribute('data-original-icon', faviconUrl);
                                    newIconElement.setAttribute('data-icon-locked', 'true');
                                    newIconElement.setAttribute('data-weblink-icon', faviconUrl);
                                    newIconElement.setAttribute('data-domain', new URL(url).hostname);
                                    
                                    // Replace the existing icon with our new one
                                    $icon[0].parentNode.replaceChild(newIconElement, $icon[0]);
                                    
                                    // Handle favicon loading error
                                    newIconElement.onerror = function() {
                                        console.warn("Icon failed to load, using fallback");
                                        this.src = window.icons['link.svg'];
                                    };
                                    
                                    // Add event listener to prevent the src from being changed
                                    newIconElement.addEventListener('load', function() {
                                        console.log("Icon loaded successfully");
                                        // Force a repaint to ensure the icon is displayed
                                        this.style.display = 'none';
                                        void this.offsetHeight;
                                        this.style.display = '';
                                    });
                                } else {
                                    console.warn("No icon element found, creating one");
                                    const newIcon = document.createElement('img');
                                    newIcon.className = 'item-icon persistent-icon';
                                    newIcon.src = faviconUrl;
                                    
                                    // Add important styling
                                    newIcon.style.cssText = `
                                        width: 32px !important;
                                        height: 32px !important;
                                        content: url('${faviconUrl}') !important;
                                        background-image: url('${faviconUrl}') !important;
                                        background-size: contain !important;
                                        background-repeat: no-repeat !important;
                                        background-position: center !important;
                                    `;
                                    
                                    // Add data attributes
                                    newIcon.setAttribute('data-icon', faviconUrl);
                                    newIcon.setAttribute('data-original-icon', faviconUrl);
                                    newIcon.setAttribute('data-icon-locked', 'true');
                                    
                                    // Add to the item
                                    $item.prepend(newIcon);
                                    
                                    // Handle errors
                                    newIcon.onerror = function() {
                                        console.warn("Icon failed to load, using fallback");
                                        this.src = window.icons['link.svg'];
                                    };
                                }
                                
                                // APPROACH 2: Set item attributes and inline styles
                                $item.attr({
                                    'data-icon': faviconUrl,
                                    'data-url': url,
                                    'data-type': 'weblink',
                                });
                                
                                // Add inline style with !important to force the icon
                                const currentStyle = $item.attr('style') || '';
                                $item.attr('style', currentStyle +
                                    `;--icon-url: url('${faviconUrl}') !important;` +
                                    `background-image: url('${faviconUrl}') !important;`);
                                
                                // APPROACH 3: Set background image on all possible containers
                                const $iconContainer = $item.find('.item-icon-container');
                                if ($iconContainer.length > 0) {
                                    $iconContainer.css({
                                        'background-image': `url('${faviconUrl}') !important`,
                                        'background-size': 'contain !important',
                                        'background-repeat': 'no-repeat !important',
                                        'background-position': 'center !important'
                                    });
                                }
                                
                                // APPROACH 4: Add a custom style tag for this specific item
                                const itemId = $item.attr('id') || `weblink-${Date.now()}`;
                                if (!$item.attr('id')) {
                                    $item.attr('id', itemId);
                                }
                                
                                const styleId = `style-${itemId}`;
                                let $styleTag = $(`#${styleId}`);
                                if ($styleTag.length === 0) {
                                    $styleTag = $(`<style id="${styleId}"></style>`);
                                    $('head').append($styleTag);
                                }
                                
                                $styleTag.html(`
                                    #${itemId} .item-icon {
                                        background-image: url('${faviconUrl}') !important;
                                        content: url('${faviconUrl}') !important;
                                    }
                                    #${itemId}[data-has-custom-icon="true"] .item-icon-container {
                                        background-image: url('${faviconUrl}') !important;
                                    }
                                `);
                                
                                // Force a DOM reflow to ensure the icon is displayed
                                void $item[0].offsetHeight;
                                
                                // Force multiple refreshes of the desktop view to ensure the file appears
                                console.log("Forcing multiple refreshes of the desktop view");
                                await refresh_item_container(dirname);
                                
                                // Add a small delay and refresh again to ensure the file appears
                                await new Promise(resolve => setTimeout(resolve, 100));
                                await refresh_item_container(dirname);
                                
                                // Apply the icon again after a short delay to ensure it's visible
                                setTimeout(() => {
                                    const $iconAfterRefresh = $item.find('img.item-icon');
                                    if ($iconAfterRefresh.length > 0) {
                                        $iconAfterRefresh.attr('src', faviconUrl);
                                    }
                                    console.log("Icon applied after refresh");
                                }, 100);
                            };
                            
                            // Apply icon immediately
                            await applyIcon();
                            
                            // And apply again after short delays to ensure it sticks
                            setTimeout(() => { applyIcon(); }, 300);
                            setTimeout(() => { applyIcon(); }, 1000);
                            
                            // APPROACH 5: Direct DOM manipulation for maximum control
                            // This is a more aggressive approach that directly modifies the DOM
                            setTimeout(() => {
                                try {
                                    // Find all possible icon elements related to this item
                                    const itemId = $item.attr('id');
                                    const uid = $item.attr('data-uid');
                                    
                                    // Query selectors to find all possible icon elements
                                    const selectors = [
                                        `#${itemId} img.item-icon`,
                                        `[data-uid="${uid}"] img.item-icon`,
                                        `[data-uid="${uid}"] .item-icon-container img`,
                                        `.item[data-name="${linkName}.weblink"] img.item-icon`
                                    ];
                                    
                                    // Try each selector
                                    selectors.forEach(selector => {
                                        const elements = document.querySelectorAll(selector);
                                        if (elements.length > 0) {
                                            console.log(`Found ${elements.length} elements with selector: ${selector}`);
                                            elements.forEach(el => {
                                                // Force the src attribute
                                                el.src = faviconUrl;
                                                // Also set as a background image
                                                el.style.backgroundImage = `url('${faviconUrl}')`;
                                                // Force a repaint
                                                el.style.display = 'none';
                                                void el.offsetHeight;
                                                el.style.display = '';
                                            });
                                        }
                                    });
                                    
                                    // Also try to find the parent container and set its background
                                    const containers = document.querySelectorAll(`[data-uid="${uid}"] .item-icon-container`);
                                    containers.forEach(container => {
                                        container.style.backgroundImage = `url('${faviconUrl}')`;
                                    });
                                    
                                    console.log("Direct DOM manipulation completed");
                                } catch (e) {
                                    console.error("Error during direct DOM manipulation:", e);
                                }
                            }, 500);
                            
                            // APPROACH 6: Use MutationObserver to watch for DOM changes
                            // This will ensure the icon is set correctly even if the DOM changes
                            try {
                                const uid = $item.attr('data-uid');
                                if (uid) {
                                    console.log("Setting up MutationObserver for item:", uid);
                                    
                                    // Create a MutationObserver to watch for changes to the DOM
                                    const observer = new MutationObserver((mutations) => {
                                        mutations.forEach((mutation) => {
                                            // Check if any new nodes were added
                                            if (mutation.addedNodes.length > 0) {
                                                // Look for icon elements in the added nodes
                                                mutation.addedNodes.forEach((node) => {
                                                    if (node.nodeType === Node.ELEMENT_NODE) {
                                                        // Check if this is an icon element
                                                        if (node.classList && node.classList.contains('item-icon')) {
                                                            console.log("MutationObserver: Found new icon element");
                                                            node.src = faviconUrl;
                                                        }
                                                        
                                                        // Also check children
                                                        const icons = node.querySelectorAll('.item-icon');
                                                        if (icons.length > 0) {
                                                            console.log("MutationObserver: Found new icon elements in children");
                                                            icons.forEach(icon => {
                                                                icon.src = faviconUrl;
                                                            });
                                                        }
                                                    }
                                                });
                                            }
                                            
                                            // Check if any attributes were modified
                                            if (mutation.type === 'attributes' &&
                                                mutation.attributeName === 'src' &&
                                                mutation.target.classList &&
                                                mutation.target.classList.contains('item-icon')) {
                                                // If the src attribute of an icon was changed, set it back
                                                if (mutation.target.src !== faviconUrl) {
                                                    console.log("MutationObserver: Icon src changed, resetting");
                                                    mutation.target.src = faviconUrl;
                                                }
                                            }
                                        });
                                    });
                                    
                                    // Start observing the document
                                    observer.observe(document.body, {
                                        childList: true,
                                        subtree: true,
                                        attributes: true,
                                        attributeFilter: ['src']
                                    });
                                    
                                    // Stop observing after 5 seconds to avoid memory leaks
                                    setTimeout(() => {
                                        console.log("Stopping MutationObserver");
                                        observer.disconnect();
                                    }, 5000);
                                }
                            } catch (e) {
                                console.error("Error setting up MutationObserver:", e);
                            }
                            
                            console.log("Set icon directly on item:", faviconUrl);
                        }
                        
                        // Store the URL in localStorage for extra reliability
                        if (item) {
                            const uid = $(item).attr('data-uid');
                            if (uid) {
                                localStorage.setItem('weblink_' + uid, url);
                            }
                        }
                        
                        // APPROACH 7: Create a permanent visible element with the icon
                        // This will ensure the icon is always visible
                        try {
                            console.log("Creating permanent visible element with icon");
                            
                            // Find the container where the file should be displayed
                            let container = null;
                            if (append_to_element) {
                                container = append_to_element;
                            } else {
                                // Try to find the desktop or current directory container
                                container = document.querySelector('.desktop, .explorer-container.active, .files-container.active');
                            }
                            
                            if (container) {
                                console.log("Found container for permanent element");
                                
                                // Generate a unique ID for this element
                                const uniqueId = `weblink-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
                                
                                // Create a permanent element with the icon
                                const permanentElement = document.createElement('div');
                                permanentElement.id = uniqueId;
                                permanentElement.className = 'item weblink-item permanent-item';
                                permanentElement.setAttribute('data-name', linkName + '.weblink');
                                permanentElement.setAttribute('data-type', 'weblink');
                                permanentElement.setAttribute('data-icon', faviconUrl);
                                permanentElement.setAttribute('data-url', url);
                                permanentElement.setAttribute('data-permanent', 'true');
                                
                                // Add inline styles to ensure it's always visible
                                permanentElement.style.display = 'inline-block';
                                permanentElement.style.position = 'relative';
                                permanentElement.style.margin = '10px';
                                permanentElement.style.textAlign = 'center';
                                permanentElement.style.verticalAlign = 'top';
                                permanentElement.style.width = '80px';
                                permanentElement.style.height = '80px';
                                permanentElement.style.zIndex = '1000'; // High z-index to ensure visibility
                                
                                // Create the icon element
                                const iconElement = document.createElement('img');
                                iconElement.className = 'item-icon';
                                iconElement.src = faviconUrl;
                                iconElement.style.width = '32px';
                                iconElement.style.height = '32px';
                                iconElement.style.display = 'block';
                                iconElement.style.margin = '0 auto 5px auto';
                                
                                // Create the name element
                                const nameElement = document.createElement('div');
                                nameElement.className = 'item-name';
                                nameElement.textContent = linkName + '.weblink';
                                nameElement.style.fontSize = '12px';
                                nameElement.style.wordWrap = 'break-word';
                                
                                // Add the elements to the permanent element
                                permanentElement.appendChild(iconElement);
                                permanentElement.appendChild(nameElement);
                                
                                // Add the permanent element to the container
                                container.appendChild(permanentElement);
                                
                                // Add a click handler to open the URL
                                permanentElement.addEventListener('click', () => {
                                    window.open(url, '_blank', 'noopener,noreferrer');
                                });
                                
                                // Add a style tag to ensure this element is always visible
                                const styleTag = document.createElement('style');
                                styleTag.id = `style-${uniqueId}`;
                                styleTag.textContent = `
                                    #${uniqueId} {
                                        display: inline-block !important;
                                        visibility: visible !important;
                                        opacity: 1 !important;
                                    }
                                    #${uniqueId} .item-icon {
                                        content: url('${faviconUrl}') !important;
                                        background-image: url('${faviconUrl}') !important;
                                    }
                                `;
                                document.head.appendChild(styleTag);
                                
                                // Set up a MutationObserver to ensure the element is not removed
                                const observer = new MutationObserver((mutations) => {
                                    // Check if our element was removed
                                    if (!document.getElementById(uniqueId)) {
                                        console.log("Permanent element was removed, re-adding it");
                                        container.appendChild(permanentElement);
                                    }
                                    
                                    // Also check if the icon was changed
                                    const icon = document.querySelector(`#${uniqueId} .item-icon`);
                                    if (icon && icon.src !== faviconUrl) {
                                        console.log("Icon was changed, resetting it");
                                        icon.src = faviconUrl;
                                    }
                                });
                                
                                // Start observing the container
                                observer.observe(container, {
                                    childList: true,
                                    subtree: true,
                                    attributes: true,
                                    attributeFilter: ['src', 'style', 'class']
                                });
                                
                                // Keep the observer running indefinitely
                                // Store it in a global variable to prevent garbage collection
                                window.weblinkObservers = window.weblinkObservers || {};
                                window.weblinkObservers[uniqueId] = observer;
                                
                                console.log("Permanent element created with ID:", uniqueId);
                            }
                        } catch (e) {
                            console.error("Error creating permanent element:", e);
                        }
                        
                        // Add global CSS rules to ensure all weblink icons are properly displayed
                        try {
                            console.log("Adding global CSS rules for weblink icons");
                            
                            // Create a global style tag for weblink icons if it doesn't exist
                            let globalStyleTag = document.getElementById('weblink-icons-global-style');
                            if (!globalStyleTag) {
                                globalStyleTag = document.createElement('style');
                                globalStyleTag.id = 'weblink-icons-global-style';
                                document.head.appendChild(globalStyleTag);
                            }
                            
                            // Add comprehensive CSS rules to ensure icons are displayed correctly
                            globalStyleTag.textContent = `
                                /* Ensure weblink icons are always visible */
                                .item[data-name$=".weblink"] .item-icon,
                                .weblink-item .item-icon,
                                .item[data-weblink="true"] .item-icon,
                                .item[data-has-custom-icon="true"] .item-icon {
                                    visibility: visible !important;
                                    opacity: 1 !important;
                                    display: block !important;
                                }
                                
                                /* Ensure persistent icons are not overridden */
                                .persistent-icon {
                                    width: 32px !important;
                                    height: 32px !important;
                                }
                                
                                /* Force immediate display of icons */
                                .item[data-icon-locked="true"] .item-icon {
                                    visibility: visible !important;
                                    opacity: 1 !important;
                                    display: block !important;
                                }
                                
                                /* Specific rule for this domain */
                                .item[data-domain="${new URL(url).hostname}"] .item-icon {
                                    content: url('${faviconUrl}') !important;
                                    background-image: url('${faviconUrl}') !important;
                                }
                            `;
                            
                            console.log("Global CSS rules added for weblink icons");
                        } catch (e) {
                            console.error("Error adding global CSS rules:", e);
                        }
                        
                        // Try to force a more comprehensive refresh of the file system view
                        try {
                            console.log("Attempting to force a comprehensive refresh");
                            
                            // Try to find and trigger the refresh button if it exists
                            const refreshButtons = document.querySelectorAll('.refresh-btn, .refresh-button, [data-action="refresh"]');
                            if (refreshButtons.length > 0) {
                                console.log("Found refresh button, clicking it");
                                refreshButtons[0].click();
                            }
                            
                            // Try to trigger a refresh event on the container
                            const containers = document.querySelectorAll('.explorer-container, .files-container, .desktop');
                            if (containers.length > 0) {
                                console.log("Found container, triggering refresh event");
                                $(containers[0]).trigger('refresh');
                            }
                            
                            // If the append_to_element is provided, try to refresh it directly
                            if (append_to_element) {
                                console.log("Refreshing append_to_element directly");
                                $(append_to_element).trigger('refresh');
                                
                                // Also try to find its parent container and refresh that
                                const parentContainer = $(append_to_element).closest('.explorer-container, .files-container, .desktop');
                                if (parentContainer.length > 0) {
                                    console.log("Found parent container, triggering refresh event");
                                    parentContainer.trigger('refresh');
                                }
                            }
                            
                            // As a last resort, try to reload the current directory
                            if (window.current_directory) {
                                console.log("Attempting to reload current directory");
                                if (typeof window.load_directory === 'function') {
                                    window.load_directory(window.current_directory);
                                }
                            }
                        } catch (e) {
                            console.error("Error during comprehensive refresh:", e);
                        }
                        
                        console.log("Created web link with URL:", url);
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