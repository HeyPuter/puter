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
            /* Hover is driven by JS (.hovered) rather than :hover so we can
               clear stale keyboard focus the moment the mouse takes over and
               keep the two highlight sources from ever co-existing. */
            .menu-button.hovered,
            .menu-button.active,
            .menu-button.focused {
                background-color: #e2e2e2;
            }
            /* Suppress browser-native focus ring and tap highlight without
               touching background. CAUTION: setting background-color here
               would tie specificity with .menu-button.active and win by
               source order, which would erase the open-menu highlight as
               soon as the button takes DOM :focus from a click. */
            .menu-button:focus,
            .menu-button:focus-visible,
            .menu-button:active {
                outline: none;
                -webkit-tap-highlight-color: transparent;
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
            /* Dark theme — applied when system prefers dark and no light
               override is set, or when theme="dark" is forced. The base
               class toggles .puter-theme-dark on the host accordingly. */
            :host(.puter-theme-dark) .menubar {
                background-color: #2a2a2a;
                border-bottom-color: #3a3a3a;
            }
            :host(.puter-theme-dark) .menu-button {
                color: #e6e6e6;
            }
            :host(.puter-theme-dark) .menu-button.hovered,
            :host(.puter-theme-dark) .menu-button.active,
            :host(.puter-theme-dark) .menu-button.focused {
                background-color: #3a3a3a;
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
        if ( this._docPointerDownHandler ) {
            document.removeEventListener('pointerdown', this._docPointerDownHandler, true);
        }
        if ( this._docFocusInHandler ) {
            document.removeEventListener('focusin', this._docFocusInHandler, true);
        }
        if ( this._winBlurHandler ) {
            window.removeEventListener('blur', this._winBlurHandler);
        }
        if ( this._mouseMoveHandler ) {
            document.removeEventListener('mousemove', this._mouseMoveHandler);
        }

        const buttons = this.$$('.menu-button');
        buttons.forEach((btn) => {
            const index = parseInt(btn.dataset.index, 10);
            const item = this.#items[index];
            if ( ! item ) return;

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                // The dropdown closes on outside pointerdown, which fires
                // before this click. If the user is pressing the same button
                // that just closed, treat the press as a toggle-close —
                // don't reopen on the trailing click.
                if ( this._suppressClickFor === btn ) {
                    this._suppressClickFor = null;
                    return;
                }
                this.#focusedIndex = index;
                this.#menubarActive = true;
                if ( this.#activeButtonEl === btn ) {
                    this._closeDropdown();
                    this._deactivateMenubar();
                    return;
                }
                this._openDropdown(btn, item);
            });

            // JS-managed hover. Adding .hovered while clearing any keyboard
            // .focused guarantees only one button highlights at a time, no
            // matter the source.
            btn.addEventListener('mouseenter', () => {
                btn.classList.add('hovered');
                // Mouse takes over: clear keyboard focus from everywhere
                // and drop any lingering DOM :focus on a sibling button.
                if ( this.#focusedIndex !== null ) {
                    this.#focusedIndex = null;
                    this._renderButtonFocus();
                }
                const root = this.shadowRoot;
                const active = root && root.activeElement;
                if ( active && active !== btn && active.classList.contains('menu-button') ) {
                    active.blur();
                }
                this._setKeyboardNav(false);
                // Hover-switch when a dropdown is already open
                if ( this.#activeDropdown && this.#activeButtonEl !== btn ) {
                    this._openDropdown(btn, item);
                }
            });
            btn.addEventListener('mouseleave', () => {
                btn.classList.remove('hovered');
            });
        });

        this._keyHandler = (e) => this._onGlobalKeyDown(e);
        this._keyUpHandler = (e) => this._onGlobalKeyUp(e);
        document.addEventListener('keydown', this._keyHandler, true);
        document.addEventListener('keyup', this._keyUpHandler, true);

        // Capture-phase pointerdown on document. The open context menu also
        // listens in capture for outside-pointerdown to close itself; that
        // listener registers later (when the dropdown opens) so ours runs
        // first. If the press lands on the currently-active button, mark it
        // so the trailing click — which would otherwise reopen the just-closed
        // dropdown — is treated as a toggle-close. Uses composedPath because
        // the button lives inside this shadow root.
        this._docPointerDownHandler = (e) => {
            const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
            if ( this.#activeButtonEl && path.includes(this.#activeButtonEl) ) {
                this._suppressClickFor = this.#activeButtonEl;
                clearTimeout(this._suppressClickTimer);
                this._suppressClickTimer = setTimeout(() => {
                    this._suppressClickFor = null;
                }, 400);
            }
            // If the click lands fully outside the menubar host, drop any
            // residual keyboard state. Without this, an Alt-activated menubar
            // would keep intercepting arrow keys typed into other inputs.
            // When a dropdown is open, its own close event will deactivate
            // the menubar — leave that path alone here.
            if ( this.#menubarActive && ! this.#activeDropdown && ! path.includes(this) ) {
                this._deactivateMenubar();
            }
        };
        document.addEventListener('pointerdown', this._docPointerDownHandler, true);

        // Focus moving to an element outside the menubar (e.g. a text input)
        // should also drop menubar state so global key handling stops.
        this._docFocusInHandler = (e) => {
            if ( ! this.#menubarActive ) return;
            if ( this.#activeDropdown ) return;
            const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
            if ( ! path.includes(this) ) {
                this._deactivateMenubar();
            }
        };
        document.addEventListener('focusin', this._docFocusInHandler, true);

        // Window losing focus (alt-tab, devtools, etc.) — reset state.
        this._winBlurHandler = () => {
            if ( this.#menubarActive && ! this.#activeDropdown ) {
                this._deactivateMenubar();
            }
            this.#altDown = false;
            this.#altConsumed = false;
        };
        window.addEventListener('blur', this._winBlurHandler);

        // Once the user actually moves the mouse, exit keyboard-nav mode so
        // :hover styling on menubar buttons works normally again.
        this._mouseMoveHandler = () => this._setKeyboardNav(false);
        document.addEventListener('mousemove', this._mouseMoveHandler);
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
                this._moveButtonFocus(+1, { openDropdown: true });
                break;
            case 'ArrowLeft':
                this._moveButtonFocus(-1, { openDropdown: true });
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
        this._setKeyboardNav(true);
    }

    _deactivateMenubar () {
        this.#menubarActive = false;
        this.#focusedIndex = null;
        this._renderButtonFocus();
        this._setKeyboardNav(false);
    }

    _renderButtonFocus () {
        this.$$('.menu-button').forEach((btn) => {
            const idx = parseInt(btn.dataset.index, 10);
            btn.classList.toggle('focused', idx === this.#focusedIndex);
        });
    }

    _setKeyboardNav (on) {
        const menubar = this.$('.menubar');
        if ( menubar ) menubar.classList.toggle('keyboard-nav', on);
    }

    _moveButtonFocus (delta, { swapDropdown = true, openDropdown = false } = {}) {
        if ( ! this.#items.length ) return;
        const n = this.#items.length;
        const cur = this.#focusedIndex == null ? (delta > 0 ? -1 : 0) : this.#focusedIndex;
        const next = (cur + delta + n) % n;
        this.#focusedIndex = next;
        this._renderButtonFocus();
        this._setKeyboardNav(true);

        const btn = this._buttonEl(next);
        const item = this.#items[next];
        if ( ! btn || ! item ) return;

        // If a dropdown is already open, swap to the new button's dropdown
        if ( swapDropdown && this.#activeDropdown ) {
            this._openDropdown(btn, item);
            return;
        }

        // Arrow-nav at the menubar level opens the focused button's dropdown
        // but does NOT pre-focus the first item — let the user press ArrowDown
        // to enter the menu.
        if ( openDropdown ) {
            this._openFocusedButton(false);
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
                    if ( typeof dd._setKeyboardNav === 'function' ) {
                        dd._setKeyboardNav(true);
                    }
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
        // Forward any forced theme so the dropdown paints in the same theme.
        const themeAttr = this.getAttribute('theme');
        if ( themeAttr ) dropdown.setAttribute('theme', themeAttr);
        dropdown.items = item.items;
        dropdown.setAttribute('x', String(rect.left));
        dropdown.setAttribute('y', String(rect.bottom));

        dropdown.addEventListener('select', (e) => {
            this.emitEvent('select', e.detail);
            this._closeDropdown();
            this._deactivateMenubar();
        });
        dropdown.addEventListener('close', () => {
            // The context menu closes itself on outside click / Escape /
            // selection. Sync our state and fully deactivate the menubar so
            // a stray arrow / Enter / Space keypress doesn't re-open it.
            if ( this.#activeDropdown === dropdown ) {
                buttonEl.classList.remove('active');
                this.#activeDropdown = null;
                this.#activeButtonEl = null;
                this._deactivateMenubar();
            }
        });
        // Keyboard navigate request bubbling from the context menu.
        // Arrow-left/right closes the current dropdown and opens the adjacent
        // button's dropdown, mirroring menubar-level arrow nav.
        // Arrow-up at the dropdown's first item closes it and returns
        // focus to the same menubar button (which can re-open with ArrowDown).
        dropdown.addEventListener('puter-menu-navigate', (e) => {
            if ( ! e.detail ) return;
            if ( e.detail.direction === 'up' ) {
                this._closeDropdown();
                this._renderButtonFocus();
                this._setKeyboardNav(true);
                return;
            }
            const delta = e.detail.direction === 'right' ? +1 : -1;
            this._closeDropdown();
            this._moveButtonFocus(delta, { swapDropdown: false, openDropdown: true });
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
        super.disconnectedCallback();
        this._closeDropdown();
        clearTimeout(this._suppressClickTimer);
        this._suppressClickFor = null;
        if ( this._keyHandler ) {
            document.removeEventListener('keydown', this._keyHandler, true);
        }
        if ( this._keyUpHandler ) {
            document.removeEventListener('keyup', this._keyUpHandler, true);
        }
        if ( this._docPointerDownHandler ) {
            document.removeEventListener('pointerdown', this._docPointerDownHandler, true);
        }
        if ( this._docFocusInHandler ) {
            document.removeEventListener('focusin', this._docFocusInHandler, true);
        }
        if ( this._winBlurHandler ) {
            window.removeEventListener('blur', this._winBlurHandler);
        }
        if ( this._mouseMoveHandler ) {
            document.removeEventListener('mousemove', this._mouseMoveHandler);
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
