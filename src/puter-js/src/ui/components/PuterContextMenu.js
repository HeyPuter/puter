/**
 * <puter-context-menu> - Positioned context menu with nested submenus.
 *
 * Properties: items (array of {label, icon?, action?, items?, disabled?, separator?})
 * Attributes: x, y (position in pixels)
 * Events: select (detail = selected item), close
 */

import PuterWebComponent from '../PuterWebComponent.js';
import { themeCSS } from '../PuterTheme.js';

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
            this.shadowRoot.innerHTML = `<style>${themeCSS}\n${this.getStyles()}</style>${this.render()}`;
            this.onReady();
        }
    }

    getStyles () {
        return `
            :host {
                position: fixed;
                z-index: 999999999;
            }
            .context-menu {
                min-width: 180px;
                max-width: calc(100vw - 16px);
                background: #ffffff;
                border: 1px solid rgba(0, 0, 0, 0.06);
                border-radius: 10px;
                box-shadow:
                    0 1px 2px rgba(0, 0, 0, 0.04),
                    0 8px 24px rgba(0, 0, 0, 0.10),
                    0 16px 48px rgba(0, 0, 0, 0.06);
                padding: 6px 0;
                font-family: var(--puter-font-family);
                font-size: 13px;
                color: #1a1a1a;
                user-select: none;
                -webkit-user-select: none;
                overflow: hidden;
                animation: menuFadeIn 0.12s ease-out;
            }
            @keyframes menuFadeIn {
                from { opacity: 0; transform: translateY(-4px) scale(0.98); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
            .menu-item {
                display: flex;
                align-items: center;
                height: 30px;
                padding: 0 14px 0 12px;
                cursor: default;
                position: relative;
                white-space: nowrap;
                color: #1a1a1a;
                transition: background 0.08s ease;
            }
            .menu-item:hover:not(.disabled):not(.divider),
            .menu-item.has-open-submenu {
                background: rgba(0, 0, 0, 0.05);
            }
            .menu-item.danger {
                color: #dc2626;
            }
            .menu-item.danger:hover:not(.disabled) {
                background: rgba(220, 38, 38, 0.08);
            }
            .menu-item.danger .icon {
                color: #dc2626;
            }
            .menu-item.disabled {
                color: #b8b8b8;
                cursor: default;
            }
            .menu-item.disabled .icon {
                opacity: 0.4;
            }
            .divider {
                padding: 4px 0;
                cursor: default;
                height: auto;
                pointer-events: none;
            }
            .divider hr {
                border: none;
                border-top: 1px solid rgba(0, 0, 0, 0.08);
                margin: 0;
            }
            .icon {
                width: 18px;
                height: 18px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                margin-right: 12px;
                color: #555;
                flex-shrink: 0;
            }
            .icon svg {
                width: 16px;
                height: 16px;
            }
            .icon img {
                width: 16px;
                height: 16px;
                object-fit: contain;
            }
            .label {
                flex: 1;
                font-weight: 400;
                letter-spacing: -0.005em;
            }
            .check {
                width: 18px;
                margin-right: 8px;
                text-align: center;
                flex-shrink: 0;
                color: #555;
                font-size: 12px;
            }
            .submenu-arrow {
                width: 12px;
                height: 12px;
                margin-left: 8px;
                flex-shrink: 0;
                opacity: 0.45;
                color: #555;
            }
            .shortcut {
                margin-left: 16px;
                font-size: 12px;
                color: #999;
                letter-spacing: 0.02em;
            }
            @media (max-width: 480px), (pointer: coarse) {
                .context-menu {
                    min-width: 240px;
                    border-radius: 14px;
                    padding: 4px 0;
                    font-size: 16px;
                }
                .menu-item {
                    height: auto;
                    min-height: 48px;
                    padding: 0 18px 0 16px;
                }
                .icon {
                    width: 22px;
                    height: 22px;
                    margin-right: 16px;
                }
                .icon svg, .icon img {
                    width: 20px;
                    height: 20px;
                }
                .submenu-arrow {
                    width: 18px;
                    height: 18px;
                }
                .shortcut {
                    font-size: 14px;
                }
            }
            /* Action sheet mode (mobile) */
            :host(.sheet-mode) {
                left: 0 !important;
                right: 0 !important;
                top: auto !important;
                bottom: 0 !important;
                padding: 0 8px max(8px, env(safe-area-inset-bottom));
                animation: sheetSlideUp 0.3s cubic-bezier(0.32, 0.72, 0, 1);
            }
            :host(.sheet-mode) .context-menu {
                min-width: 0;
                width: 100%;
                max-width: 100%;
                border-radius: 14px;
                padding: 4px 0;
                box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.12);
                animation: none;
            }
            :host(.sheet-closing) {
                animation: sheetSlideDown 0.25s cubic-bezier(0.4, 0, 1, 1) forwards;
            }
            @keyframes sheetSlideUp {
                from { transform: translateY(100%); }
                to { transform: translateY(0); }
            }
            @keyframes sheetSlideDown {
                from { transform: translateY(0); }
                to { transform: translateY(100%); }
            }
            @media (prefers-color-scheme: dark) {
                .context-menu {
                    background: rgba(40, 40, 44, 0.96);
                    backdrop-filter: blur(20px) saturate(180%);
                    -webkit-backdrop-filter: blur(20px) saturate(180%);
                    border-color: rgba(255, 255, 255, 0.08);
                    box-shadow:
                        0 1px 2px rgba(0, 0, 0, 0.3),
                        0 8px 24px rgba(0, 0, 0, 0.4);
                    color: #f5f5f7;
                }
                .menu-item { color: #f5f5f7; }
                .menu-item:hover:not(.disabled):not(.divider),
                .menu-item.has-open-submenu {
                    background: rgba(255, 255, 255, 0.08);
                }
                .menu-item.danger { color: #f87171; }
                .menu-item.danger:hover:not(.disabled) {
                    background: rgba(248, 113, 113, 0.12);
                }
                .menu-item.danger .icon { color: #f87171; }
                .menu-item.disabled { color: #666; }
                .icon, .check, .submenu-arrow { color: #aaa; }
                .divider hr { border-top-color: rgba(255, 255, 255, 0.10); }
                .shortcut { color: #888; }
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
