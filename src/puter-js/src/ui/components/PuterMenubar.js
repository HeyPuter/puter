/**
 * <puter-menubar> - Application menubar with dropdown menus.
 *
 * Properties: items (array of {label, action?, items?})
 * Events: select (detail = selected item)
 *
 * Reuses <puter-context-menu> for dropdowns.
 */

import PuterWebComponent from '../PuterWebComponent.js';
import { defaultFontFamily } from '../PuterDefaultStyles.js';

class PuterMenubar extends PuterWebComponent {
    #items = [];
    #activeDropdown = null;
    #activeButtonEl = null;

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
        return `
            :host {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                z-index: 9999;
                font-family: ${defaultFontFamily};
                user-select: none;
                -webkit-user-select: none;
            }
            .menubar {
                display: flex;
                box-sizing: border-box;
                overflow: hidden;
                border-bottom: 1px solid #e3e3e3;
                background-color: #fafafa;
                padding: 2px 5px;
                align-items: center;
                height: 36px;
            }
            .menu-button {
                background: none;
                border: none;
                font-family: inherit;
                padding: 3px 10px;
                font-size: 13px;
                border-radius: 3px;
                cursor: default;
                color: #333;
                line-height: 1.2;
                margin: 0 1px;
            }
            .menu-button:hover,
            .menu-button.active {
                background-color: #e2e2e2;
            }
            @media (max-width: 480px) {
                .menubar {
                    height: 40px;
                    overflow-x: auto;
                    overflow-y: hidden;
                    -webkit-overflow-scrolling: touch;
                    scrollbar-width: none;
                }
                .menubar::-webkit-scrollbar {
                    display: none;
                }
                .menu-button {
                    font-size: 14px;
                    padding: 6px 12px;
                    flex-shrink: 0;
                }
            }
        `;
    }

    render () {
        const items = this.#items || [];
        const buttonsHTML = items.map((item, index) => {
            return `<button class="menu-button" data-index="${index}">${this._escapeHTML(item.label || '')}</button>`;
        }).join('');
        return `<div class="menubar">${buttonsHTML}</div>`;
    }

    onReady () {
        const buttons = this.$$('.menu-button');
        buttons.forEach((btn) => {
            const index = parseInt(btn.dataset.index, 10);
            const item = this.#items[index];
            if ( ! item ) return;

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if ( this.#activeButtonEl === btn ) {
                    this._closeDropdown();
                    return;
                }
                this._openDropdown(btn, item);
            });

            // Hover-switch when a dropdown is already open
            btn.addEventListener('mouseenter', () => {
                if ( this.#activeDropdown && this.#activeButtonEl !== btn ) {
                    this._openDropdown(btn, item);
                }
            });
        });
    }

    _openDropdown (buttonEl, item) {
        this._closeDropdown();

        if ( typeof item.action === 'function' && (!item.items || item.items.length === 0) ) {
            // Top-level item with no submenu — fire action immediately
            item.action();
            this.emitEvent('select', item);
            return;
        }

        if ( !item.items || item.items.length === 0 ) return;

        const rect = buttonEl.getBoundingClientRect();
        const dropdown = document.createElement('puter-context-menu');
        dropdown.setAttribute('data-submenu', ''); // skip mobile sheet behavior
        dropdown.items = item.items;
        dropdown.setAttribute('x', String(rect.left));
        dropdown.setAttribute('y', String(rect.bottom));

        dropdown.addEventListener('select', (e) => {
            this.emitEvent('select', e.detail);
            this._closeDropdown();
        });
        dropdown.addEventListener('close', () => {
            // The context menu closes itself on outside click; sync our state
            if ( this.#activeDropdown === dropdown ) {
                buttonEl.classList.remove('active');
                this.#activeDropdown = null;
                this.#activeButtonEl = null;
            }
        });

        document.body.appendChild(dropdown);
        buttonEl.classList.add('active');
        this.#activeDropdown = dropdown;
        this.#activeButtonEl = buttonEl;
    }

    _closeDropdown () {
        if ( this.#activeButtonEl ) {
            this.#activeButtonEl.classList.remove('active');
        }
        if ( this.#activeDropdown ) {
            // Trigger the context menu's own _closeAll via remove
            this.#activeDropdown.remove();
        }
        this.#activeDropdown = null;
        this.#activeButtonEl = null;
    }

    disconnectedCallback () {
        this._closeDropdown();
    }

    _escapeHTML (str) {
        if ( ! str ) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

export default PuterMenubar;
