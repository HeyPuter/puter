/**
 * ContextMenuModal
 *
 * A mobile-friendly context menu modal that appears positioned over a target element.
 * Adapted from voice-recorder project for Puter dashboard use.
 */

/**
 * Detects if device is touch-primary (mobile/tablet)
 * @returns {boolean}
 */
function isTouchPrimaryDevice () {
    return (
        window.matchMedia('(pointer: coarse)').matches &&
        window.matchMedia('(hover: none)').matches
    );
}

export default class ContextMenuModal {
    constructor (options = {}) {
        this.onClose = options.onClose || (() => {
        });
        this.backdrop = null;
        this.modal = null;
        this.menuItems = null;
        this.ignoreInteractions = false;

        // Event handler references for cleanup
        this.backdropClickHandler = null;
        this.escapeKeyHandler = null;
        this.itemClickHandler = null;
    }

    /**
     * Show the modal positioned over a specific element
     * @param {Array} menuItems - Array of menu item objects or '-' for separator
     * @param {DOMRect} targetRect - Bounding rectangle of the tapped item
     * @param {Object} [options] - Optional settings
     * @param {string} [options.title] - Title displayed at the top of the menu
     */
    show (menuItems, targetRect, options = {}) {
        if ( this.backdrop ) return; // Already showing

        this.menuItems = menuItems;
        // Stack of parent menus for submenu drill-in, and the anchor rect so we
        // can reposition when the menu height changes on navigation.
        this._menuStack = [];
        this._targetRect = targetRect;

        // Create backdrop
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'context-menu-modal-backdrop';

        // Create modal dialog
        this.modal = document.createElement('div');
        this.modal.className = 'context-menu-modal-dialog';

        // Build modal content
        let titleHtml = '';
        if ( options.title ) {
            const titleEl = document.createElement('div');
            titleEl.className = 'context-menu-title';
            titleEl.textContent = options.title;
            titleHtml = titleEl.outerHTML;
        }
        this.modal.innerHTML = `
            ${titleHtml}
            <div class="context-menu-items">
                ${this.renderMenuItems(this.getVisibleItems())}
            </div>
        `;

        // Add modal to backdrop
        this.backdrop.appendChild(this.modal);

        // Add to DOM
        document.body.appendChild(this.backdrop);

        // Position modal after adding to DOM (so we can measure it)
        this.positionModal(targetRect);

        // Setup event listeners
        this.setupEventListeners();

        // Ignore interactions briefly to prevent accidental selection on touch devices
        this.ignoreInteractions = true;
        setTimeout(() => {
            this.ignoreInteractions = false;
        }, 100);

        // Trigger animation
        requestAnimationFrame(() => {
            this.backdrop.classList.add('show');
        });
    }

    /**
     * Position the modal over the target element
     * @param {DOMRect} targetRect - Bounding rectangle of the target
     */
    positionModal (targetRect) {
        const isMobile = isTouchPrimaryDevice();
        const modalHeight = this.modal.offsetHeight;
        const modalWidth = this.modal.offsetWidth;
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const margin = 20; // Minimum margin from viewport edges

        const width = isMobile ? viewportWidth * 0.9 : modalWidth;

        // Center over the target horizontally, clamped to the viewport. (The
        // old code hardcoded left:300px on non-touch devices — which route here
        // whenever maxTouchPoints > 0, e.g. touchscreen laptops — so the menu
        // opened nowhere near the item on a wide screen.)
        const itemCenter = targetRect.left + (targetRect.width / 2);
        let left = itemCenter - width / 2;
        left = Math.max(margin, Math.min(left, viewportWidth - width - margin));

        let top = targetRect.top;
        if ( top + modalHeight > viewportHeight - margin ) {
            top = Math.max(margin, viewportHeight - modalHeight - margin);
        }
        if ( top < margin ) {
            top = margin;
        }

        this.modal.style.top = `${top}px`;
        this.modal.style.left = `${left}px`;
        this.modal.style.width = isMobile ? '90%' : 'auto';
    }

    /**
     * The item list currently on screen: the active menu, prefixed with a Back
     * row when we've drilled into a submenu.
     * @returns {Array}
     */
    getVisibleItems () {
        if ( this._menuStack && this._menuStack.length > 0 ) {
            return [{ label: '‹ Back', _isBack: true }, '-', ...this.menuItems];
        }
        return this.menuItems;
    }

    /**
     * Rebuild the item rows in place (after drilling in/out of a submenu) and
     * reposition, since the height changed.
     */
    rerenderItems () {
        const container = this.modal.querySelector('.context-menu-items');
        if ( container ) {
            container.innerHTML = this.renderMenuItems(this.getVisibleItems());
        }
        this.positionModal(this._targetRect);
    }

    /**
     * Render menu items as HTML
     * Supports both Puter format (html/onClick) and voice-recorder format (label/action)
     * @param {Array} menuItems - Array of menu items
     * @returns {string} HTML string
     */
    renderMenuItems (menuItems) {
        return menuItems.map((item, index) => {
            // Handle separators
            if ( item === '-' || item.is_divider ) {
                return '<div class="context-menu-separator"></div>';
            }

            // Get label - support both formats
            const label = item.label || item.html || '';

            // Check for delete/danger styling
            const isDelete = label.toLowerCase().includes('delete');
            const deleteClass = isDelete ? 'context-menu-item--delete' : '';
            const disabledClass = item.disabled ? 'context-menu-item--disabled' : '';
            const hasSubmenu = Array.isArray(item.items) && item.items.length > 0;

            // Get icon - support both formats (HTML string or base64)
            let iconHtml = '';
            if ( item.icon ) {
                if ( item.icon.startsWith('data:') ) {
                    // Base64 image
                    iconHtml = `<img src="${item.icon}" alt="" />`;
                } else {
                    // HTML string (SVG)
                    iconHtml = item.icon;
                }
            }

            // A submenu row gets a trailing chevron; a Back row a leading one.
            const submenuChevron = hasSubmenu
                ? '<span class="context-menu-item-chevron">›</span>'
                : '';

            return `
                <button class="context-menu-item ${deleteClass} ${disabledClass}" data-index="${index}"${item.disabled ? ' disabled' : ''}>
                    <div class="context-menu-item-icon">
                        ${iconHtml}
                    </div>
                    <span class="context-menu-item-label">${label}</span>
                    ${submenuChevron}
                </button>
            `;
        }).join('');
    }

    /**
     * Setup event listeners
     */
    setupEventListeners () {
        // Close on backdrop click
        this.backdropClickHandler = (e) => {
            if ( e.target === this.backdrop ) {
                this.close();
            }
        };
        this.backdrop.addEventListener('click', this.backdropClickHandler);

        // Prevent text selection and close on backdrop touch
        this.backdrop.addEventListener('touchstart', (e) => {
            if ( e.target === this.backdrop ) {
                e.preventDefault();
                this.close();
            }
        }, { passive: false });

        // Handle menu item clicks
        this.itemClickHandler = (e) => {
            if ( this.ignoreInteractions ) return;

            const itemBtn = e.target.closest('.context-menu-item');
            if ( ! itemBtn ) return;

            const index = parseInt(itemBtn.dataset.index, 10);
            const menuItem = this.getVisibleItems()[index];
            if ( ! menuItem || menuItem === '-' || menuItem.is_divider ) return;

            // Back out of a submenu.
            if ( menuItem._isBack ) {
                this.menuItems = this._menuStack.pop();
                this.rerenderItems();
                return;
            }

            // Disabled items are inert (mirrors the desktop UIContextMenu).
            if ( menuItem.disabled ) return;

            // Drill into a submenu (e.g. "New", "Open With") instead of leaving
            // it a dead button.
            if ( Array.isArray(menuItem.items) && menuItem.items.length > 0 ) {
                this._menuStack.push(this.menuItems);
                this.menuItems = menuItem.items;
                this.rerenderItems();
                return;
            }

            // Support both action formats
            const handler = menuItem.action || menuItem.onClick;
            if ( handler ) {
                this.close();
                // Execute action after close animation starts
                setTimeout(() => {
                    handler();
                }, 50);
            }
        };
        this.modal.addEventListener('click', this.itemClickHandler);

        // Handle Escape key
        this.escapeKeyHandler = (e) => {
            if ( e.key === 'Escape' ) {
                this.close();
            }
        };
        document.addEventListener('keydown', this.escapeKeyHandler);
    }

    /**
     * Close the modal with animation
     */
    close () {
        if ( ! this.backdrop ) return;

        // Remove event listeners
        if ( this.backdropClickHandler ) {
            this.backdrop.removeEventListener('click', this.backdropClickHandler);
        }
        if ( this.itemClickHandler && this.modal ) {
            this.modal.removeEventListener('click', this.itemClickHandler);
        }
        if ( this.escapeKeyHandler ) {
            document.removeEventListener('keydown', this.escapeKeyHandler);
        }

        // Trigger closing animation
        this.backdrop.classList.remove('show');

        // Remove from DOM after animation
        setTimeout(() => {
            if ( this.backdrop && this.backdrop.parentNode ) {
                this.backdrop.parentNode.removeChild(this.backdrop);
            }
            this.backdrop = null;
            this.modal = null;
            this.menuItems = null;
            this.onClose();
        }, 200);
    }
}

export { isTouchPrimaryDevice };
