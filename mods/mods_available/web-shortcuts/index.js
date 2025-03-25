/**
 * Web Shortcuts Mod for Puter
 * 
 * This mod adds a "Create Web Shortcut" option to the context menu
 * that allows users to create .weblink files that open websites.
 */

const BaseService = require("../../../src/backend/src/services/BaseService");

class WebShortcutsService extends BaseService {
    async _init() {
        const svc_puterHomepage = this.services.get('puter-homepage');
        svc_puterHomepage.register_script('/web-shortcuts/main.js');
    }
}

// Function to extract URL from text (handles pasted URLs)
function extractURL(text) {
    // Remove any warning messages that might be in the pasted content
    const cleanText = text.replace(/⚠️Warning⚠️.*?(?=http)/s, '').trim();
    
    // Try to find a URL in the text
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = cleanText.match(urlRegex);
    
    if (matches && matches.length > 0) {
        return matches[0];
    }
    
    return text;
}

// Function to validate URL
function isValidURL(url) {
    try {
        new URL(url);
        return true;
    } catch (error) {
        return false;
    }
}

// Function to create a web shortcut
async function createWebShortcut(targetPath, url = null) {
    try {
        // If no URL provided, prompt the user
        if (!url) {
            let userInput = prompt('Enter or paste the URL for the web shortcut:', 'https://example.com');
            if (!userInput) {
                console.log('User cancelled URL input');
                return;
            }
            url = extractURL(userInput);
        }
        
        // Ensure URL has protocol
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
        
        // Validate URL
        if (!isValidURL(url)) {
            console.error('Invalid URL:', url);
            alert('Invalid URL. Please enter a valid URL.');
            return;
        }
        
        // Get the website title (for the shortcut name)
        const validUrl = new URL(url);
        const siteName = validUrl.hostname;
        
        // Get the favicon
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${validUrl.origin}&sz=64`;
        
        // Create a JSON file that will store the shortcut data
        const shortcutData = {
            url: validUrl.href,
            icon: faviconUrl,
            type: 'web_shortcut'
        };
        
        // Create the shortcut file
        const shortcutFileName = `${siteName}.weblink`;
        
        // Get the target path (default to desktop if not provided)
        const desktopPath = window.desktop_path || '/Desktop';
        const targetDirectory = targetPath || desktopPath;
        
        // Write the file
        const result = await window.puter.fs.write(
            targetDirectory + '/' + shortcutFileName, 
            JSON.stringify(shortcutData),
            { dedupeName: true }
        );
        
        console.log('Web shortcut created:', result);
    } catch (error) {
        console.error('Error creating web shortcut:', error);
        alert('Error creating web shortcut: ' + error.message);
    }
}

// Handle URL drops on desktop
window.addEventListener('dragover', function(e) {
    // Check if we're dragging over the desktop
    if (!$(e.target).closest('.desktop').length) return;
    
    // Check if we have text/uri-list or text/plain data
    if (e.dataTransfer.types.includes('text/uri-list') || 
        e.dataTransfer.types.includes('text/plain')) {
        e.preventDefault();
        e.stopPropagation();
    }
});

window.addEventListener('drop', async function(e) {
    // Check if we're dropping on the desktop
    if (!$(e.target).closest('.desktop').length) return;
    
    // Check if we have text/uri-list or text/plain data
    if (e.dataTransfer.types.includes('text/uri-list')) {
        e.preventDefault();
        e.stopPropagation();
        
        const url = e.dataTransfer.getData('text/uri-list');
        if (isValidURL(url)) {
            await createWebShortcut(window.desktop_path, url);
        }
    } else if (e.dataTransfer.types.includes('text/plain')) {
        e.preventDefault();
        e.stopPropagation();
        
        const text = e.dataTransfer.getData('text/plain');
        const url = extractURL(text);
        if (isValidURL(url)) {
            await createWebShortcut(window.desktop_path, url);
        }
    }
});

// Handle URL pastes on desktop
window.addEventListener('paste', async function(e) {
    // Check if we're pasting on the desktop
    if (!$(e.target).closest('.desktop').length) return;
    
    const text = e.clipboardData.getData('text/plain');
    const url = extractURL(text);
    
    if (isValidURL(url)) {
        e.preventDefault();
        e.stopPropagation();
        await createWebShortcut(window.desktop_path, url);
    }
});

// Add "Create Web Shortcut" to the desktop context menu
window.addEventListener('ctxmenu-will-open', function(e) {
    const options = e.detail.options;
    
    // Only add to desktop context menu or directory context menus
    if (!options || !options.items) return;
    
    // Check if this is a desktop or directory context menu
    const isDesktopOrDirMenu = options.items.some(item => 
        (item.html === 'New Folder' || item.html === i18n('new_folder')) ||
        (item.html === 'Paste' || item.html === i18n('paste'))
    );
    
    if (isDesktopOrDirMenu) {
        // Find the position to insert our menu item (after "New Folder")
        let insertIndex = options.items.findIndex(item => 
            item.html === 'New Folder' || item.html === i18n('new_folder')
        );
        
        if (insertIndex === -1) {
            // If "New Folder" not found, insert at the beginning
            insertIndex = 0;
        } else {
            // Insert after "New Folder"
            insertIndex += 1;
        }
        
        // Get the target path
        let targetPath;
        if (options.parent_element) {
            const $parentElement = $(options.parent_element);
            if ($parentElement.hasClass('item-container')) {
                targetPath = $parentElement.attr('data-path');
            } else if ($parentElement.hasClass('item') && $parentElement.attr('data-is_dir') === '1') {
                targetPath = $parentElement.attr('data-path');
            }
        }
        
        // Insert our menu item
        options.items.splice(insertIndex, 0, {
            html: 'Create Web Shortcut',
            icon: '<img src="' + window.icons['link.svg'] + '" style="width:16px; height:16px; margin-bottom: -3px;">',
            onClick: function() {
                createWebShortcut(targetPath);
            }
        });
    }
});

// Add "Create Web Shortcut" to the "New" submenu in the desktop context menu
const originalUIContextMenu = window.UIContextMenu;
window.UIContextMenu = function(options) {
    if (options && options.items) {
        // Find the "New" submenu
        const newItemIndex = options.items.findIndex(item => 
            (item.html === 'New' || item.html === i18n('new')) && 
            Array.isArray(item.items)
        );
        
        if (newItemIndex !== -1 && options.items[newItemIndex].items) {
            // Add our item to the "New" submenu
            options.items[newItemIndex].items.push({
                html: 'Web Shortcut',
                icon: '<img src="' + window.icons['link.svg'] + '" style="width:16px; height:16px; margin-bottom: -3px;">',
                onClick: function() {
                    // Get the target path
                    let targetPath;
                    if (options.parent_element) {
                        const $parentElement = $(options.parent_element);
                        if ($parentElement.hasClass('item-container')) {
                            targetPath = $parentElement.attr('data-path');
                        } else if ($parentElement.hasClass('item') && $parentElement.attr('data-is_dir') === '1') {
                            targetPath = $parentElement.attr('data-path');
                        }
                    }
                    createWebShortcut(targetPath);
                }
            });
        }
    }
    
    return originalUIContextMenu(options);
};

module.exports = WebShortcutsService;