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
            .menu-item.has-open-submenu .icon,
            .menu-item.has-open-submenu .check,
            .menu-item.has-open-submenu .submenu-arrow,
            .menu-item.has-open-submenu .shortcut,
            .menu-item.has-open-submenu .label {
                color: white;
            }
            .menu-item:hover:not(.disabled):not(.divider) .icon svg,
            .menu-item.has-open-submenu .icon svg {
                filter: brightness(0) invert(1);
            }
            .menu-item:hover:not(.disabled):not(.divider) .icon img,
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

            // Submenu on hover
            if ( el.dataset.hasSubmenu === 'true' ) {
                el.addEventListener('mouseenter', () => {
                    clearTimeout(this.#submenuTimeout);
                    this.#submenuTimeout = setTimeout(() => {
                        this._showSubmenu(el, item.items);
                    }, 200);
                });
                el.addEventListener('mouseleave', () => {
                    clearTimeout(this.#submenuTimeout);
                    this.#submenuTimeout = setTimeout(() => {
                        this._hideSubmenu(el);
                    }, 300);
                });
            } else {
                el.addEventListener('mouseenter', () => {
                    this._hideActiveSubmenu();
                });
            }
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

        // Keyboard navigation
        this._keyHandler = (e) => {
            if ( e.key === 'Escape' ) {
                this._closeAll();
            }
        };
        document.addEventListener('keydown', this._keyHandler);
    }

    _showSubmenu (parentEl, items) {
        this._hideActiveSubmenu();

        parentEl.classList.add('has-open-submenu');

        const submenu = document.createElement('puter-context-menu');
        submenu.setAttribute('data-submenu', '');
        submenu.items = items;
        // Position relative to parent item
        const rect = parentEl.getBoundingClientRect();
        // On narrow screens, position below parent instead of beside
        const isNarrow = window.innerWidth < 480;
        if ( isNarrow ) {
            submenu.setAttribute('x', String(rect.left));
            submenu.setAttribute('y', String(rect.bottom + 2));
        } else {
            submenu.setAttribute('x', String(rect.right + 2));
            submenu.setAttribute('y', String(rect.top));
        }

        // Forward select events
        submenu.addEventListener('select', (e) => {
            this.emitEvent('select', e.detail);
            this._closeAll();
        });

        document.body.appendChild(submenu);
        this.#activeSubmenu = { element: submenu, parentEl };

        // Keep submenu open when hovering it
        submenu.addEventListener('mouseenter', () => {
            clearTimeout(this.#submenuTimeout);
        });
        submenu.addEventListener('mouseleave', () => {
            this.#submenuTimeout = setTimeout(() => {
                this._hideSubmenu(parentEl);
            }, 300);
        });
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
    }

    _closeAll () {
        if ( this._closing ) return;
        this._closing = true;
        this._hideActiveSubmenu();
        document.removeEventListener('click', this._outsideClickHandler, true);
        document.removeEventListener('keydown', this._keyHandler);
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
            document.removeEventListener('keydown', this._keyHandler);
        }
        clearTimeout(this.#submenuTimeout);
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
