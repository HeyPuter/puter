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
     */
    show (menuItems, targetRect) {
        if ( this.backdrop ) return; // Already showing

        this.menuItems = menuItems;

        // Create backdrop
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'context-menu-modal-backdrop';

        // Create modal dialog
        this.modal = document.createElement('div');
        this.modal.className = 'context-menu-modal-dialog';

        // Build modal content
        this.modal.innerHTML = `
            <div class="context-menu-items">
                ${this.renderMenuItems(menuItems)}
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

        // Default: align with item left and top
        let top = targetRect.top;
        let left = targetRect.left;

        // Use target width as minimum, but allow modal to be wider if needed
        const width = Math.max(targetRect.width, modalWidth);

        // Horizontal positioning - center over item if possible
        const itemCenter = targetRect.left + (targetRect.width / 2);
        const modalHalfWidth = width / 2;

        if ( itemCenter - modalHalfWidth >= margin &&
            itemCenter + modalHalfWidth <= viewportWidth - margin ) {
            left = itemCenter - modalHalfWidth;
        } else {
            // Align with item left, but ensure within viewport
            left = 20; //Math.max(margin, Math.min(left, viewportWidth - width - margin));
        }

        // Vertical positioning - ensure modal stays within viewport
        if ( top + modalHeight > viewportHeight - margin ) {
            // Would go off bottom, shift up
            top = Math.max(margin, viewportHeight - modalHeight - margin);
        }

        if ( top < margin ) {
            top = margin;
        }

        // Apply positioning
        this.modal.style.top = `${top}px`;
        this.modal.style.left = isMobile ? `${left}px` : '300px';
        this.modal.style.width = isMobile ? '90%' : 'auto';
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

            return `
                <button class="context-menu-item ${deleteClass}" data-index="${index}">
                    <div class="context-menu-item-icon">
                        ${iconHtml}
                    </div>
                    <span class="context-menu-item-label">${label}</span>
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

        // Handle menu item clicks
        this.itemClickHandler = (e) => {
            if ( this.ignoreInteractions ) return;

            const itemBtn = e.target.closest('.context-menu-item');
            if ( ! itemBtn ) return;

            const index = parseInt(itemBtn.dataset.index, 10);
            const menuItem = this.menuItems[index];

            if ( menuItem && menuItem !== '-' && !menuItem.is_divider ) {
                // Support both action formats
                const handler = menuItem.action || menuItem.onClick;
                if ( handler ) {
                    this.close();
                    // Execute action after close animation starts
                    setTimeout(() => {
                        handler();
                    }, 50);
                }
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
