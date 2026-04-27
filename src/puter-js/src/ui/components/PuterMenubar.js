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
    #focusedIndex = null;
    #menubarActive = false;
    #altDown = false;
    #altConsumed = false;

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
            .menu-button.active,
            .menu-button.focused {
                background-color: #e2e2e2;
            }
            .menu-button:focus { outline: none; }
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
        // Remove any stale document listeners from a prior render
        if ( this._keyHandler ) {
            document.removeEventListener('keydown', this._keyHandler, true);
        }
        if ( this._keyUpHandler ) {
            document.removeEventListener('keyup', this._keyUpHandler, true);
        }

        const buttons = this.$$('.menu-button');
        buttons.forEach((btn) => {
            const index = parseInt(btn.dataset.index, 10);
            const item = this.#items[index];
            if ( ! item ) return;

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.#focusedIndex = index;
                this.#menubarActive = true;
                if ( this.#activeButtonEl === btn ) {
                    this._closeDropdown();
                    this._deactivateMenubar();
                    return;
                }
                this._openDropdown(btn, item);
            });

            // Hover-switch when a dropdown is already open
            btn.addEventListener('mouseenter', () => {
                if ( this.#activeDropdown && this.#activeButtonEl !== btn ) {
                    this.#focusedIndex = index;
                    this._openDropdown(btn, item);
                }
            });
        });

        this._keyHandler = (e) => this._onGlobalKeyDown(e);
        this._keyUpHandler = (e) => this._onGlobalKeyUp(e);
        document.addEventListener('keydown', this._keyHandler, true);
        document.addEventListener('keyup', this._keyUpHandler, true);
    }

    _onGlobalKeyDown (e) {
        // Track Alt-alone (pressed and released without another key)
        if ( e.key === 'Alt' && !e.repeat ) {
            this.#altDown = true;
            this.#altConsumed = false;
        } else if ( this.#altDown && e.key !== 'Alt' ) {
            this.#altConsumed = true;
        }

        // F10 toggles menubar focus regardless
        if ( e.key === 'F10' ) {
            if ( this.#menubarActive || this.#activeDropdown ) {
                this._closeDropdown();
                this._deactivateMenubar();
            } else {
                this._activateMenubar();
            }
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }

        // While a dropdown is open, it owns key handling (and will emit puter-menu-navigate)
        if ( this.#activeDropdown ) return;
        if ( ! this.#menubarActive ) return;

        switch ( e.key ) {
            case 'ArrowRight':
                this._moveButtonFocus(+1);
                break;
            case 'ArrowLeft':
                this._moveButtonFocus(-1);
                break;
            case 'ArrowDown':
            case 'Enter':
            case ' ':
                this._openFocusedButton(true);
                break;
            case 'Escape':
            case 'Tab':
                this._deactivateMenubar();
                break;
            default:
                return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
    }

    _onGlobalKeyUp (e) {
        if ( e.key === 'Alt' ) {
            const wasAloneTap = this.#altDown && !this.#altConsumed;
            this.#altDown = false;
            this.#altConsumed = false;
            if ( wasAloneTap ) {
                if ( this.#menubarActive || this.#activeDropdown ) {
                    this._closeDropdown();
                    this._deactivateMenubar();
                } else {
                    this._activateMenubar();
                }
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        }
    }

    _activateMenubar () {
        if ( !this.#items || !this.#items.length ) return;
        // Don't steal focus if a context menu is already open
        if ( document.querySelector('puter-context-menu') ) return;
        this.#menubarActive = true;
        this.#focusedIndex = 0;
        this._renderButtonFocus();
    }

    _deactivateMenubar () {
        this.#menubarActive = false;
        this.#focusedIndex = null;
        this._renderButtonFocus();
    }

    _renderButtonFocus () {
        this.$$('.menu-button').forEach((btn) => {
            const idx = parseInt(btn.dataset.index, 10);
            btn.classList.toggle('focused', idx === this.#focusedIndex);
        });
    }

    _moveButtonFocus (delta, { swapDropdown = true } = {}) {
        if ( ! this.#items.length ) return;
        const n = this.#items.length;
        const cur = this.#focusedIndex == null ? (delta > 0 ? -1 : 0) : this.#focusedIndex;
        const next = (cur + delta + n) % n;
        this.#focusedIndex = next;
        this._renderButtonFocus();

        // If a dropdown is already open, swap to the new button's dropdown
        if ( swapDropdown && this.#activeDropdown ) {
            const btn = this._buttonEl(next);
            const item = this.#items[next];
            if ( btn && item ) this._openDropdown(btn, item);
        }
    }

    _buttonEl (index) {
        return this.$(`.menu-button[data-index="${index}"]`);
    }

    _openFocusedButton (focusFirstItem) {
        if ( this.#focusedIndex == null ) return;
        const btn = this._buttonEl(this.#focusedIndex);
        const item = this.#items[this.#focusedIndex];
        if ( !btn || !item ) return;
        this._openDropdown(btn, item);
        if ( focusFirstItem && this.#activeDropdown ) {
            requestAnimationFrame(() => {
                const dd = this.#activeDropdown;
                if ( dd && typeof dd._focusableIndices === 'function' ) {
                    const f = dd._focusableIndices();
                    if ( f.length ) dd._setFocusIndex(f[0]);
                }
            });
        }
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
            this._deactivateMenubar();
        });
        dropdown.addEventListener('close', () => {
            // The context menu closes itself on outside click; sync our state
            if ( this.#activeDropdown === dropdown ) {
                buttonEl.classList.remove('active');
                this.#activeDropdown = null;
                this.#activeButtonEl = null;
            }
        });
        // Keyboard navigate request bubbling from the context menu
        dropdown.addEventListener('puter-menu-navigate', (e) => {
            if ( ! e.detail ) return;
            const delta = e.detail.direction === 'right' ? +1 : -1;
            this._moveButtonFocus(delta, { swapDropdown: false });
            this._openFocusedButton(true);
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
        if ( this._keyHandler ) {
            document.removeEventListener('keydown', this._keyHandler, true);
        }
        if ( this._keyUpHandler ) {
            document.removeEventListener('keyup', this._keyUpHandler, true);
        }
    }

    _escapeHTML (str) {
        if ( ! str ) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

export default PuterMenubar;
