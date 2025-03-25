// Web Shortcuts Mod
(function() {
    console.log('[Web Shortcuts] Mod initializing...');

    // URL validation helper
    function isValidURL(str) {
        const pattern = new RegExp('^(https?:\\/\\/)?'+ // protocol
            '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|'+ // domain
            '((\\d{1,3}\\.){3}\\d{1,3}))'+ // OR ip (v4)
            '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*'+ // port and path
            '(\\?[;&a-z\\d%_.~+=-]*)?'+       // query string
            '(\\#[-a-z\\d_]*)?$','i');       // fragment
        return !!pattern.test(str);
    }

    // Extract URL from text
    function extractURL(text) {
        // Clean the text
        text = text.trim();
        
        // If it's already a valid URL, return it
        if (isValidURL(text)) {
            return text;
        }

        // Try to extract a URL
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const matches = text.match(urlRegex);
        return matches ? matches[0] : null;
    }

    // Create web shortcut
    async function createWebShortcut(url, name = null) {
        console.log('[Web Shortcuts] Creating shortcut with URL:', url);
        try {
            if (!url) {
                url = await window.puter.prompt('Enter URL:');
                if (!url) return;
            }

            // Add https:// if no protocol specified
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'https://' + url;
            }

            if (!isValidURL(url)) {
                console.log('[Web Shortcuts] Invalid URL:', url);
                window.puter.alert('Invalid URL');
                return;
            }

            // Get domain/hostname and build favicon link
            const { hostname } = new URL(url);
            const favicon = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;

            // Use hostname as default name if none provided
            if (!name) {
                name = await window.puter.prompt('Enter shortcut name:', hostname);
                if (!name) return;
            }

            console.log('[Web Shortcuts] Creating shortcut:', { url, name, favicon });

            const shortcutData = {
                url: url,
                favicon: favicon,
                created: new Date().toISOString(),
                type: 'link'
            };

            // Build the path for storing the shortcut
            const filePath = `${window.desktop_path}/${name}.weblink`;

            // Write the file
            const file = await window.puter.fs.write(
                filePath,
                JSON.stringify(shortcutData),
                {
                    type: 'link',
                    icon: favicon
                }
            );

            console.log('[Web Shortcuts] File created:', file);

            // Create the UI icon on the desktop
            window.UIItem({
                appendTo: $('.desktop.item-container'),
                'data-type': 'link',
                uid: file.uid,
                path: filePath,
                icon: favicon,
                name: name,
                is_dir: false,
                metadata: JSON.stringify(shortcutData)
            });

            window.puter.notify('Web shortcut created successfully');
        } catch (error) {
            console.error('[Web Shortcuts] Error creating shortcut:', error);
            window.puter.alert('Error creating web shortcut: ' + (error.message || 'Please check the URL and try again'));
        }
    }

    // Add context menu items
    window.addEventListener('DOMContentLoaded', () => {
        console.log('[Web Shortcuts] DOM Content Loaded');
        
        // Get desktop element
        const el_desktop = document.querySelector('.desktop');
        console.log('[Web Shortcuts] Desktop element found:', !!el_desktop);
        
        if (!el_desktop) return;

        // Handle paste events
        el_desktop.addEventListener('paste', (e) => {
            console.log('[Web Shortcuts] Paste event on desktop:', e.target === el_desktop);
            if (e.target !== el_desktop) return;
            const text = e.clipboardData.getData('text');
            if (isValidURL(text)) {
                e.preventDefault();
                createWebShortcut(text);
            }
        });

        // Handle drop events
        el_desktop.addEventListener('drop', (e) => {
            console.log('[Web Shortcuts] Drop event on desktop:', e.target === el_desktop);
            if (e.target !== el_desktop) return;
            e.preventDefault();
            const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
            if (url && isValidURL(url)) {
                createWebShortcut(url);
            }
        });

        // Listen for context menu opening
        window.addEventListener('ctxmenu-will-open', (e) => {
            console.log('[Web Shortcuts] Context menu will open:', e.detail);
            const options = e.detail.options;
            
            // Only modify desktop context menu
            if (!options || !options.items) {
                console.log('[Web Shortcuts] No menu options found');
                return;
            }

            // Check if this is a desktop context menu
            const isDesktopMenu = options.items.some(item => 
                (item.html === 'New Folder' || item.html === window.i18n('new_folder')) ||
                (item.html === 'Paste' || item.html === window.i18n('paste'))
            );
            console.log('[Web Shortcuts] Is desktop menu:', isDesktopMenu);

            if (isDesktopMenu) {
                // Find the position to insert our menu item (after "New")
                const newIndex = options.items.findIndex(item => 
                    item.html === 'New' || item.html === window.i18n('new')
                );
                console.log('[Web Shortcuts] New menu index:', newIndex);

                // Insert our menu item after "New" and before the next divider
                if (newIndex !== -1) {
                    let insertIndex = newIndex + 1;
                    // Find the next divider
                    while (insertIndex < options.items.length && options.items[insertIndex] !== '-') {
                        insertIndex++;
                    }
                    
                    console.log('[Web Shortcuts] Inserting at index:', insertIndex);
                    
                    // Insert our item before the divider
                    options.items.splice(insertIndex, 0, {
                        html: 'Create Web Shortcut',
                        icon: '<img src="' + window.icons['link.svg'] + '" style="width:16px; height:16px; margin-bottom: -3px;">',
                        onClick: () => createWebShortcut()
                    });

                    console.log('[Web Shortcuts] Menu items after insertion:', options.items);
                }
            }
        });

        // Add right-click handler to desktop
        el_desktop.addEventListener('contextmenu', (e) => {
            console.log('[Web Shortcuts] Context menu event on desktop:', e.target === el_desktop);
            // Only handle right-clicks directly on the desktop, not on items
            if (e.target !== el_desktop) return;
            
            // The rest of the context menu handling will be done by the ctxmenu-will-open event
        });

        console.log('[Web Shortcuts] All event listeners attached');
    });

    console.log('[Web Shortcuts] Mod initialization complete');
})(); 