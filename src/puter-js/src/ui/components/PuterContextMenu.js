/**
 * <puter-context-menu> - Positioned context menu with nested submenus.
 *
 * Properties: items (array of {label, icon?, action?, items?, disabled?, separator?})
 * Attributes: x, y (position in pixels)
 * Events: select (detail = selected item), close
 */

import PuterWebComponent from '../PuterWebComponent.js';
import { defaultFontFamily } from '../PuterDefaultStyles.js';

class PuterContextMenu extends PuterWebComponent {
    #items = [];
    #activeSubmenu = null;
    #submenuTimeout = null;
    #focusedIndex = null;
    #mouseLocs = [];
    #submenuCloseTimer = null;
    #submenuDirection = 'right';
    #typeaheadBuffer = '';
    #typeaheadTimer = null;
    #mouseTracker = null;
    #pendingFocusIndex = null;

    get items () {
        return this.#items;
    }
    set items (val) {
        this.#items = val || [];
        if ( this.shadowRoot && this.isConnected ) {
            this._rerender();
        }
    }

    getStyles () {
        // Copied directly from src/gui/src/css/style.css (.context-menu rules)
        return `
            :host {
                position: fixed;
                z-index: 9999999999;
            }

            /* .context-menu — lines 1647-1666 of style.css */
            .context-menu {
                overflow: hidden;
                white-space: nowrap;
                font-family: sans-serif;
                background: #FFF;
                color: #333;
                border-radius: 2px;
                padding: 3px 0;
                min-width: 200px;
                background-color: rgb(255 255 255 / 92%);
                backdrop-filter: blur(3px);
                border: 1px solid #e6e4e466;
                box-shadow: 0px 0px 15px #00000066;
                padding-left: 6px;
                padding-right: 6px;
                padding-top: 4px;
                padding-bottom: 4px;
                user-select: none;
                -webkit-user-select: none;
            }

            /* .context-menu-item:not(.context-menu-divider) — lines 1686-1694 */
            .menu-item {
                display: flex;
                align-items: center;
                padding: 5px;
                list-style-type: none;
                user-select: none;
                -webkit-user-select: none;
                font-size: 12px;
                height: 25px;
                box-sizing: border-box;
                position: relative;
                cursor: default;
                white-space: nowrap;
                color: #333;
            }

            /* .context-menu-item-active:not(.context-menu-divider) — lines 1742-1745 */
            .menu-item:hover:not(.disabled):not(.divider),
            .menu-item.focused:not(.disabled):not(.divider),
            .menu-item.has-open-submenu {
                background-color: hsl(213, 74%, 56%);
                color: white;
                border-radius: 4px;
            }

            /* Active item turns all children white */
            .menu-item:hover:not(.disabled):not(.divider) .icon,
            .menu-item:hover:not(.disabled):not(.divider) .check,
            .menu-item:hover:not(.disabled):not(.divider) .submenu-arrow,
            .menu-item:hover:not(.disabled):not(.divider) .shortcut,
            .menu-item:hover:not(.disabled):not(.divider) .label,
            .menu-item.focused:not(.disabled):not(.divider) .icon,
            .menu-item.focused:not(.disabled):not(.divider) .check,
            .menu-item.focused:not(.disabled):not(.divider) .submenu-arrow,
            .menu-item.focused:not(.disabled):not(.divider) .shortcut,
            .menu-item.focused:not(.disabled):not(.divider) .label,
            .menu-item.has-open-submenu .icon,
            .menu-item.has-open-submenu .check,
            .menu-item.has-open-submenu .submenu-arrow,
            .menu-item.has-open-submenu .shortcut,
            .menu-item.has-open-submenu .label {
                color: white;
            }
            .menu-item:hover:not(.disabled):not(.divider) .icon svg,
            .menu-item.focused:not(.disabled):not(.divider) .icon svg,
            .menu-item.has-open-submenu .icon svg {
                filter: brightness(0) invert(1);
            }
            .menu-item:hover:not(.disabled):not(.divider) .icon img,
            .menu-item.focused:not(.disabled):not(.divider) .icon img,
            .menu-item.has-open-submenu .icon img {
                filter: brightness(0) invert(1);
            }

            /* .has-open-context-menu-submenu — line 1738-1739 */
            .menu-item.has-open-submenu:not(:hover) {
                background-color: #dfdfdf;
                color: #333;
            }
            .menu-item.has-open-submenu:not(:hover) .icon,
            .menu-item.has-open-submenu:not(:hover) .icon svg,
            .menu-item.has-open-submenu:not(:hover) .icon img {
                filter: none;
                color: #333;
            }

            /* .context-menu-item-disabled — lines 1753-1758 */
            .menu-item.disabled {
                opacity: 0.5;
                background-color: transparent;
                color: initial;
                cursor: initial;
            }

            /* Danger items: no special color in puter.com default theme */
            .menu-item.danger {
                color: #333;
            }
            .menu-item.danger .icon {
                color: #333;
            }

            /* .context-menu-divider — lines 1681-1684 */
            .divider {
                padding-top: 5px;
                padding-bottom: 5px;
                cursor: default;
                height: auto;
                pointer-events: none;
            }
            .divider hr {
                border: none;
                background: #ccc;
                height: 1px;
                width: 100%;
                margin: 0;
            }

            /* .context-menu-item-icon — lines 1760-1767 */
            .icon {
                display: inline-block;
                width: 20px;
                text-align: center;
                margin-right: 5px;
                font-size: 14px;
                line-height: 5px;
                flex-shrink: 0;
                color: #333;
            }
            .icon svg {
                width: 15px;
                height: 15px;
                vertical-align: middle;
            }
            /* .ctx-item-icon — lines 1696-1703 */
            .icon img {
                width: 15px;
                height: 15px;
                object-fit: contain;
                filter: drop-shadow(0px 0px 0.3px rgb(51, 51, 51));
            }

            .label {
                flex: 1;
                font-weight: 400;
            }

            .check {
                width: 20px;
                text-align: center;
                margin-right: 5px;
                flex-shrink: 0;
                font-size: 14px;
                line-height: 5px;
                color: #333;
            }

            /* .submenu-arrow — lines 1705-1709 */
            .submenu-arrow {
                width: 15px;
                height: 15px;
                float: right;
                flex-shrink: 0;
                color: #555;
            }

            .shortcut {
                margin-left: 16px;
                font-size: 11px;
                color: #999;
            }

            /* === iOS-style action sheet (mobile) ========================= */
            :host(.sheet-mode) {
                left: 0 !important;
                right: 0 !important;
                top: auto !important;
                bottom: 0 !important;
                padding: 0 8px calc(8px + env(safe-area-inset-bottom)) 8px;
                box-sizing: border-box;
                animation: puter-sheet-in 260ms cubic-bezier(0.22, 1, 0.36, 1);
            }

            :host(.sheet-mode.sheet-closing) {
                animation: puter-sheet-out 240ms cubic-bezier(0.4, 0, 1, 1) forwards;
            }

            @keyframes puter-sheet-in {
                from { transform: translateY(100%); }
                to   { transform: translateY(0); }
            }

            @keyframes puter-sheet-out {
                from { transform: translateY(0); }
                to   { transform: translateY(100%); }
            }

            :host(.sheet-mode) .context-menu {
                min-width: 0;
                width: 100%;
                border-radius: 14px;
                padding: 6px 0;
                background-color: rgb(255 255 255 / 96%);
                border: none;
                box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.18);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                             Helvetica, Arial, sans-serif;
                -webkit-font-smoothing: antialiased;
            }

            :host(.sheet-mode) .menu-item {
                height: auto;
                min-height: 48px;
                padding: 12px 16px;
                font-size: 16px;
                border-radius: 0;
            }

            :host(.sheet-mode) .menu-item:hover:not(.disabled):not(.divider) {
                background-color: rgba(0, 122, 255, 0.1);
                color: inherit;
                border-radius: 0;
            }
            :host(.sheet-mode) .menu-item:active:not(.disabled):not(.divider) {
                background-color: rgba(0, 122, 255, 0.2);
            }
            :host(.sheet-mode) .menu-item:hover:not(.disabled):not(.divider) .label,
            :host(.sheet-mode) .menu-item:hover:not(.disabled):not(.divider) .icon,
            :host(.sheet-mode) .menu-item:active:not(.disabled):not(.divider) .label,
            :host(.sheet-mode) .menu-item:active:not(.disabled):not(.divider) .icon {
                color: #333;
            }
            :host(.sheet-mode) .menu-item:hover .icon svg,
            :host(.sheet-mode) .menu-item:active .icon svg,
            :host(.sheet-mode) .menu-item:hover .icon img,
            :host(.sheet-mode) .menu-item:active .icon img {
                filter: none;
            }

            :host(.sheet-mode) .divider {
                min-height: 24px;
                padding: 0;
                display: flex;
                align-items: center;
            }
            :host(.sheet-mode) .divider hr {
                background: rgba(60, 60, 67, 0.2);
            }

            :host(.sheet-mode) .icon {
                width: 24px;
                margin-right: 12px;
            }
            :host(.sheet-mode) .icon svg,
            :host(.sheet-mode) .icon img {
                width: 20px;
                height: 20px;
            }
        `;
    }

    render () {
        return `<div class="context-menu">${this._renderItems(this.#items)}</div>`;
    }

    _renderItems (items) {
        // Detect whether ANY item has an icon or check, so we can reserve
        // the icon column on items without one — keeps labels aligned.
        const hasIconColumn = items.some(it =>
            it && typeof it === 'object' && (it.icon || it.checked !== undefined));

        return items.map((item, index) => {
            // Separator
            if ( item === '-' || item.separator ) {
                return '<div class="menu-item divider"><hr></div>';
            }

            const classes = ['menu-item'];
            if ( item.disabled ) classes.push('disabled');
            if ( item.type === 'danger' || item.danger ) classes.push('danger');
            const hasSubmenu = item.items && item.items.length > 0;

            let iconHTML = '';
            if ( item.checked !== undefined ) {
                iconHTML = `<span class="check">${item.checked ? '\u2713' : ''}</span>`;
            } else if ( item.icon ) {
                iconHTML = item.icon.startsWith('<')
                    ? `<span class="icon">${item.icon}</span>`
                    : `<span class="icon"><img src="${this._escapeAttr(item.icon)}" alt=""></span>`;
            } else if ( hasIconColumn ) {
                // Reserve column for alignment
                iconHTML = '<span class="icon"></span>';
            }

            const arrowHTML = hasSubmenu
                ? '<svg class="submenu-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'
                : '';

            const shortcutHTML = item.shortcut
                ? `<span class="shortcut">${this._escapeHTML(item.shortcut)}</span>`
                : '';

            return `
                <div class="${classes.join(' ')}" data-index="${index}" ${hasSubmenu ? 'data-has-submenu="true"' : ''}>
                    ${iconHTML}
                    <span class="label">${this._escapeHTML(item.label || '')}</span>
                    ${shortcutHTML}
                    ${arrowHTML}
                </div>`;
        }).join('');
    }

    onReady () {
        this._positionMenu();
        this._bindEvents();
    }

    _positionMenu () {
        const menu = this.$('.context-menu');
        if ( ! menu ) return;

        // On mobile/touch devices, render as action sheet (bottom-anchored)
        // Skip for submenus — they cascade as nested popovers, not sheets.
        if ( this._isMobile() && !this.hasAttribute('data-submenu') ) {
            this.classList.add('sheet-mode');
            // Add backdrop overlay for action sheet mode
            this._showBackdrop();
            return;
        }

        const x = parseInt(this.getAttribute('x') || '0', 10);
        const y = parseInt(this.getAttribute('y') || '0', 10);

        // Position initially
        this.style.left = `${x }px`;
        this.style.top = `${y }px`;

        // Nested submenus are positioned by their parent — skip self-clip
        if ( this.hasAttribute('data-parent-managed') ) return;

        // Flip if overflowing viewport
        requestAnimationFrame(() => {
            const rect = menu.getBoundingClientRect();
            if ( rect.right > window.innerWidth ) {
                this.style.left = `${Math.max(0, x - rect.width) }px`;
            }
            if ( rect.bottom > window.innerHeight ) {
                this.style.top = `${Math.max(0, window.innerHeight - rect.height - 10) }px`;
            }
        });
    }

    _isMobile () {
        return window.innerWidth <= 480 ||
            (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 768);
    }

    _showBackdrop () {
        if ( this._backdrop ) return;
        const backdrop = document.createElement('div');
        backdrop.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.35);
            z-index: 999999998;
            opacity: 0;
            transition: opacity 0.2s ease;
        `;
        document.body.appendChild(backdrop);
        requestAnimationFrame(() => {
            backdrop.style.opacity = '1';
        });
        backdrop.addEventListener('click', () => this._closeAll());
        this._backdrop = backdrop;
    }

    _hideBackdrop () {
        if ( ! this._backdrop ) return;
        const backdrop = this._backdrop;
        backdrop.style.opacity = '0';
        setTimeout(() => backdrop.remove(), 200);
        this._backdrop = null;
    }

    _bindEvents () {
        // Remove any stale document listeners from a prior render
        if ( this._outsideClickHandler ) {
            document.removeEventListener('click', this._outsideClickHandler, true);
        }
        if ( this._keyHandler ) {
            document.removeEventListener('keydown', this._keyHandler, true);
        }
        if ( this.#mouseTracker ) {
            document.removeEventListener('mousemove', this.#mouseTracker);
            this.#mouseTracker = null;
        }

        const menuItems = this.$$('.menu-item:not(.divider):not(.disabled)');

        menuItems.forEach((el) => {
            const index = parseInt(el.dataset.index, 10);
            const item = this.#items[index];
            if ( ! item ) return;

            // Click handler
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                if ( item.items && item.items.length > 0 ) {
                    // On touch devices: tap opens submenu
                    if ( !this.#activeSubmenu || this.#activeSubmenu.parentEl !== el ) {
                        clearTimeout(this.#submenuTimeout);
                        this._cancelSubmenuClose();
                        this._showSubmenu(el, item.items);
                    }
                    return;
                }

                if ( typeof item.action === 'function' ) {
                    item.action();
                }
                this.emitEvent('select', item);
                this._closeAll();
            });

            // Hover: mouse takes over focus highlight
            el.addEventListener('mouseenter', () => {
                if ( el.dataset.hasSubmenu === 'true' ) {
                    this.#pendingFocusIndex = null;
                    this._setFocusIndex(index);
                    this._cancelSubmenuClose();
                    clearTimeout(this.#submenuTimeout);
                    // If a different submenu is already open, swap eagerly
                    if ( this.#activeSubmenu && this.#activeSubmenu.parentEl !== el ) {
                        this._showSubmenu(el, item.items);
                    } else if ( ! this.#activeSubmenu ) {
                        this.#submenuTimeout = setTimeout(() => {
                            this._showSubmenu(el, item.items);
                        }, 200);
                    }
                } else if ( this.#activeSubmenu ) {
                    // Safe-triangle: if cursor is heading toward the submenu,
                    // defer focus change so intermediate items don't highlight
                    if ( this._isMouseHeadingToSubmenu(this.#activeSubmenu.element) ) {
                        this.#pendingFocusIndex = index;
                        this._cancelSubmenuClose();
                        this.#submenuCloseTimer = setTimeout(() => this._submenuCloseCheck(), 100);
                        return;
                    }
                    this._setFocusIndex(index);
                    this._scheduleSubmenuClose();
                } else {
                    this._setFocusIndex(index);
                }
            });

            el.addEventListener('mouseleave', () => {
                clearTimeout(this.#submenuTimeout);
                if ( el.dataset.hasSubmenu === 'true' && this.#activeSubmenu && this.#activeSubmenu.parentEl === el ) {
                    this._scheduleSubmenuClose();
                }
            });
        });

        // Close on outside click
        this._outsideClickHandler = (e) => {
            if ( ! this.contains(e.target) ) {
                this._closeAll();
            }
        };
        setTimeout(() => {
            document.addEventListener('click', this._outsideClickHandler, true);
        }, 0);

        // Track mouse for safe-triangle submenu hover
        this.#mouseTracker = (e) => {
            this.#mouseLocs.push({ x: e.clientX, y: e.clientY });
            if ( this.#mouseLocs.length > 3 ) this.#mouseLocs.shift();
        };
        document.addEventListener('mousemove', this.#mouseTracker);

        // Keyboard navigation — capture phase, each menu listens; deepest open handles
        this._keyHandler = (e) => {
            if ( this.#activeSubmenu ) return; // let the deeper submenu handle
            const consumed = this._handleKey(e);
            if ( consumed ) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        };
        document.addEventListener('keydown', this._keyHandler, true);
    }

    _handleKey (e) {
        const key = e.key;
        if ( e.metaKey || e.ctrlKey ) return false; // pass-through host shortcuts

        switch ( key ) {
            case 'Escape':
                this._closeAll();
                return true;
            case 'ArrowDown':
                this._moveFocus(+1);
                return true;
            case 'ArrowUp':
                this._moveFocus(-1);
                return true;
            case 'Home': {
                const f = this._focusableIndices();
                if ( f.length ) this._setFocusIndex(f[0]);
                return true;
            }
            case 'End': {
                const f = this._focusableIndices();
                if ( f.length ) this._setFocusIndex(f[f.length - 1]);
                return true;
            }
            case 'Enter':
            case ' ':
                this._activateFocused();
                return true;
            case 'ArrowRight':
                if ( this._openFocusedSubmenu() ) return true;
                // Only the root forwards to the menubar; inside submenus it's a no-op
                if ( ! this._parentMenu ) {
                    this.dispatchEvent(new CustomEvent('puter-menu-navigate', {
                        detail: { direction: 'right' },
                        bubbles: true,
                        composed: true,
                    }));
                }
                return true;
            case 'ArrowLeft':
                if ( this._parentMenu ) {
                    this._parentMenu._hideActiveSubmenu();
                    // Restore parent's focus to the item that owned this submenu
                    const parentItem = this._parentItemEl;
                    if ( parentItem ) {
                        const pIdx = parseInt(parentItem.dataset.index, 10);
                        this._parentMenu._setFocusIndex(pIdx);
                    }
                    return true;
                }
                // Root — let menubar step left
                this.dispatchEvent(new CustomEvent('puter-menu-navigate', {
                    detail: { direction: 'left' },
                    bubbles: true,
                    composed: true,
                }));
                return true;
            case 'Tab':
                this._closeAll();
                return true;
            default:
                if ( key.length === 1 && !e.altKey ) {
                    return this._typeahead(key);
                }
                return false;
        }
    }

    _focusableIndices () {
        const out = [];
        this.#items.forEach((item, i) => {
            if ( item === '-' || (item && item.separator) ) return;
            if ( item && item.disabled ) return;
            out.push(i);
        });
        return out;
    }

    _setFocusIndex (index) {
        this.#focusedIndex = index;
        this.$$('.menu-item').forEach((el) => {
            const i = parseInt(el.dataset.index, 10);
            el.classList.toggle('focused', i === index);
        });
        const el = this._itemEl(index);
        if ( el && typeof el.scrollIntoView === 'function' ) {
            el.scrollIntoView({ block: 'nearest' });
        }
    }

    _clearFocus () {
        this.#focusedIndex = null;
        this.$$('.menu-item.focused').forEach((el) => el.classList.remove('focused'));
    }

    _itemEl (index) {
        return this.$(`.menu-item[data-index="${index}"]`);
    }

    _moveFocus (delta) {
        const focusable = this._focusableIndices();
        if ( ! focusable.length ) return;
        let pos = focusable.indexOf(this.#focusedIndex);
        if ( pos === -1 ) {
            pos = delta > 0 ? -1 : focusable.length;
        }
        const next = (pos + delta + focusable.length) % focusable.length;
        this._setFocusIndex(focusable[next]);
    }

    _activateFocused () {
        if ( this.#focusedIndex === null ) return;
        const el = this._itemEl(this.#focusedIndex);
        if ( el ) el.click();
    }

    _openFocusedSubmenu () {
        if ( this.#focusedIndex === null ) return false;
        const item = this.#items[this.#focusedIndex];
        if ( !item || !item.items || !item.items.length ) return false;
        const el = this._itemEl(this.#focusedIndex);
        if ( ! el ) return false;
        clearTimeout(this.#submenuTimeout);
        this._cancelSubmenuClose();
        this._showSubmenu(el, item.items);
        // Focus first item in submenu
        requestAnimationFrame(() => {
            const sub = this.#activeSubmenu && this.#activeSubmenu.element;
            if ( sub ) {
                const f = sub._focusableIndices();
                if ( f.length ) sub._setFocusIndex(f[0]);
            }
        });
        return true;
    }

    _typeahead (char) {
        const lower = char.toLowerCase();
        this.#typeaheadBuffer += lower;
        clearTimeout(this.#typeaheadTimer);
        this.#typeaheadTimer = setTimeout(() => {
            this.#typeaheadBuffer = '';
        }, 500);

        const focusable = this._focusableIndices();
        if ( ! focusable.length ) return false;
        const start = focusable.indexOf(this.#focusedIndex);
        const buf = this.#typeaheadBuffer;
        // Search starting after current, then wrap
        for ( let i = 1; i <= focusable.length; i++ ) {
            const idx = focusable[(Math.max(0, start) + i) % focusable.length];
            const label = (this.#items[idx] && this.#items[idx].label) || '';
            if ( label.toLowerCase().startsWith(buf) ) {
                this._setFocusIndex(idx);
                return true;
            }
        }
        // If single char and nothing started with it, try prefix match with just this char
        if ( buf.length > 1 ) {
            for ( let i = 1; i <= focusable.length; i++ ) {
                const idx = focusable[(Math.max(0, start) + i) % focusable.length];
                const label = (this.#items[idx] && this.#items[idx].label) || '';
                if ( label.toLowerCase().startsWith(lower) ) {
                    this._setFocusIndex(idx);
                    this.#typeaheadBuffer = lower;
                    return true;
                }
            }
        }
        return false;
    }

    _showSubmenu (parentEl, items) {
        this._hideActiveSubmenu();
        this._cancelSubmenuClose();

        parentEl.classList.add('has-open-submenu');

        const submenu = document.createElement('puter-context-menu');
        submenu.setAttribute('data-submenu', '');
        submenu.setAttribute('data-parent-managed', '');
        submenu.items = items;
        submenu._parentMenu = this;
        submenu._parentItemEl = parentEl;

        const parentRect = parentEl.getBoundingClientRect();
        const isNarrow = window.innerWidth < 480;

        // Initial tentative placement; we'll flip after measuring
        if ( isNarrow ) {
            submenu.setAttribute('x', String(parentRect.left));
            submenu.setAttribute('y', String(parentRect.bottom + 2));
            this.#submenuDirection = 'below';
        } else {
            submenu.setAttribute('x', String(parentRect.right + 2));
            submenu.setAttribute('y', String(parentRect.top));
            this.#submenuDirection = 'right';
        }

        submenu.addEventListener('select', (e) => {
            this.emitEvent('select', e.detail);
            this._closeAll();
        });

        document.body.appendChild(submenu);
        this.#activeSubmenu = { element: submenu, parentEl };

        // After submenu renders, measure and flip if needed
        requestAnimationFrame(() => {
            if ( !this.#activeSubmenu || this.#activeSubmenu.element !== submenu ) return;
            const subRoot = submenu.shadowRoot && submenu.shadowRoot.querySelector('.context-menu');
            if ( ! subRoot ) return;
            const subRect = subRoot.getBoundingClientRect();
            const subW = subRect.width;
            const subH = subRect.height;

            if ( ! isNarrow ) {
                // Horizontal flip: no room on the right → place to the left of parent
                let left = parentRect.right + 2;
                if ( left + subW > window.innerWidth ) {
                    left = Math.max(0, parentRect.left - subW - 2);
                    this.#submenuDirection = 'left';
                }
                // Vertical shift: don't overflow bottom
                let top = parentRect.top;
                if ( top + subH > window.innerHeight - 10 ) {
                    top = Math.max(0, window.innerHeight - subH - 10);
                }
                submenu.style.left = `${left}px`;
                submenu.style.top = `${top}px`;
            } else {
                // Narrow: opens below parent; shift up only if overflow
                let left = parentRect.left;
                if ( left + subW > window.innerWidth ) {
                    left = Math.max(0, window.innerWidth - subW - 4);
                }
                let top = parentRect.bottom + 2;
                if ( top + subH > window.innerHeight - 10 ) {
                    top = Math.max(0, window.innerHeight - subH - 10);
                }
                submenu.style.left = `${left}px`;
                submenu.style.top = `${top}px`;
            }
        });

        // When mouse enters submenu, cancel any pending close
        submenu.addEventListener('mouseenter', () => {
            this._cancelSubmenuClose();
            clearTimeout(this.#submenuTimeout);
        });
        // When mouse leaves submenu entirely, start close
        submenu.addEventListener('mouseleave', () => {
            this._scheduleSubmenuClose();
        });
    }

    _scheduleSubmenuClose () {
        this._cancelSubmenuClose();
        this.#submenuCloseTimer = setTimeout(() => this._submenuCloseCheck(), 50);
    }

    _cancelSubmenuClose () {
        if ( this.#submenuCloseTimer ) {
            clearTimeout(this.#submenuCloseTimer);
            this.#submenuCloseTimer = null;
        }
        // User reached the submenu — discard deferred focus
        this.#pendingFocusIndex = null;
    }

    _submenuCloseCheck () {
        this.#submenuCloseTimer = null;
        if ( ! this.#activeSubmenu ) return;

        // If cursor is currently over the submenu or the parent item, keep open
        const submenu = this.#activeSubmenu.element;
        const parentEl = this.#activeSubmenu.parentEl;
        const latest = this.#mouseLocs[this.#mouseLocs.length - 1];
        if ( latest ) {
            if ( this._pointInElement(latest, submenu) || this._pointInRect(latest, parentEl.getBoundingClientRect()) ) {
                return;
            }
        }

        // Safe-triangle check: is the cursor trajectory heading into the submenu?
        if ( this._isMouseHeadingToSubmenu(submenu) ) {
            // Re-check after a longer delay; meanwhile mouseenter can cancel
            this.#submenuCloseTimer = setTimeout(() => this._submenuCloseCheck(), 300);
            return;
        }

        this._hideActiveSubmenu();
    }

    _pointInRect (p, r) {
        return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
    }

    _pointInElement (p, el) {
        const root = el.shadowRoot && el.shadowRoot.querySelector('.context-menu');
        if ( ! root ) return false;
        return this._pointInRect(p, root.getBoundingClientRect());
    }

    _isMouseHeadingToSubmenu (submenu) {
        if ( this.#mouseLocs.length < 2 ) return false;
        const root = submenu.shadowRoot && submenu.shadowRoot.querySelector('.context-menu');
        if ( ! root ) return false;
        const r = root.getBoundingClientRect();
        const loc = this.#mouseLocs[this.#mouseLocs.length - 1];
        const prevLoc = this.#mouseLocs[0];

        // Choose the submenu's two corners on the edge the cursor must cross
        let decreasingCorner, increasingCorner;
        switch ( this.#submenuDirection ) {
            case 'left':
                decreasingCorner = { x: r.right, y: r.bottom };
                increasingCorner = { x: r.right, y: r.top };
                break;
            case 'below':
                decreasingCorner = { x: r.right, y: r.top };
                increasingCorner = { x: r.left, y: r.top };
                break;
            case 'right':
            default:
                decreasingCorner = { x: r.left, y: r.top };
                increasingCorner = { x: r.left, y: r.bottom };
                break;
        }

        const slope = (a, b) => (b.y - a.y) / (b.x - a.x);
        const decSlope = slope(loc, decreasingCorner);
        const incSlope = slope(loc, increasingCorner);
        const prevDecSlope = slope(prevLoc, decreasingCorner);
        const prevIncSlope = slope(prevLoc, increasingCorner);

        return decSlope < prevDecSlope && incSlope > prevIncSlope;
    }

    _hideSubmenu (parentEl) {
        if ( this.#activeSubmenu && this.#activeSubmenu.parentEl === parentEl ) {
            this._hideActiveSubmenu();
        }
    }

    _hideActiveSubmenu () {
        if ( this.#activeSubmenu ) {
            this.#activeSubmenu.element.remove();
            this.#activeSubmenu.parentEl.classList.remove('has-open-submenu');
            this.#activeSubmenu = null;
        }
        // Apply deferred focus from safe-triangle hover
        if ( this.#pendingFocusIndex !== null ) {
            this._setFocusIndex(this.#pendingFocusIndex);
            this.#pendingFocusIndex = null;
        }
    }

    _closeAll () {
        if ( this._closing ) return;
        this._closing = true;
        this._cancelSubmenuClose();
        clearTimeout(this.#submenuTimeout);
        clearTimeout(this.#typeaheadTimer);
        this._hideActiveSubmenu();
        if ( this._outsideClickHandler ) {
            document.removeEventListener('click', this._outsideClickHandler, true);
        }
        if ( this._keyHandler ) {
            document.removeEventListener('keydown', this._keyHandler, true);
        }
        if ( this.#mouseTracker ) {
            document.removeEventListener('mousemove', this.#mouseTracker);
            this.#mouseTracker = null;
        }
        this.emitEvent('close', {});

        // Sheet-mode close: animate down, then remove
        if ( this.classList.contains('sheet-mode') ) {
            this.classList.add('sheet-closing');
            this._hideBackdrop();
            setTimeout(() => this.remove(), 250);
        } else {
            this.remove();
        }
    }

    disconnectedCallback () {
        if ( this._outsideClickHandler ) {
            document.removeEventListener('click', this._outsideClickHandler, true);
        }
        if ( this._keyHandler ) {
            document.removeEventListener('keydown', this._keyHandler, true);
        }
        if ( this.#mouseTracker ) {
            document.removeEventListener('mousemove', this.#mouseTracker);
            this.#mouseTracker = null;
        }
        this._cancelSubmenuClose();
        clearTimeout(this.#submenuTimeout);
        clearTimeout(this.#typeaheadTimer);
        this._hideActiveSubmenu();
        this._hideBackdrop();
    }

    _escapeHTML (str) {
        if ( ! str ) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    _escapeAttr (str) {
        if ( ! str ) return '';
        return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
}

export default PuterContextMenu;
