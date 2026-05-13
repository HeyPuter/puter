/**
 * PuterWebComponent - Base class for all Puter web components.
 * Provides Shadow DOM setup, style injection, and common helpers.
 */

class PuterWebComponent extends (globalThis.HTMLElement || Object) {
    constructor () {
        super();
        if ( typeof globalThis.HTMLElement !== 'undefined' ) {
            this.attachShadow({ mode: 'open' });
        }
    }

    connectedCallback () {
        this._setupThemeWatchers();
        this._applyTheme();
        this._rerender();
    }

    disconnectedCallback () {
        this._teardownThemeWatchers();
    }

    _setupThemeWatchers () {
        if ( typeof globalThis.MutationObserver !== 'undefined' && ! this._themeObserver ) {
            this._themeObserver = new globalThis.MutationObserver(() => this._applyTheme());
            this._themeObserver.observe(this, { attributes: true, attributeFilter: ['theme'] });
        }
        if ( typeof globalThis.matchMedia === 'function' && ! this._themeMediaQuery ) {
            this._themeMediaQuery = globalThis.matchMedia('(prefers-color-scheme: dark)');
            this._themeMediaListener = () => this._applyTheme();
            if ( this._themeMediaQuery.addEventListener ) {
                this._themeMediaQuery.addEventListener('change', this._themeMediaListener);
            }
        }
    }

    _teardownThemeWatchers () {
        if ( this._themeObserver ) {
            this._themeObserver.disconnect();
            this._themeObserver = null;
        }
        if ( this._themeMediaQuery && this._themeMediaListener && this._themeMediaQuery.removeEventListener ) {
            this._themeMediaQuery.removeEventListener('change', this._themeMediaListener);
        }
        this._themeMediaQuery = null;
        this._themeMediaListener = null;
    }

    /**
     * Resolves the effective theme from the `theme` attribute and the system
     * preference, then toggles a `.puter-theme-dark` class on the host so
     * components can style with `:host(.puter-theme-dark) ...`.
     *   theme="dark"   → always dark
     *   theme="light"  → always light
     *   unset / other  → follow system (prefers-color-scheme)
     */
    _applyTheme () {
        if ( typeof this.getAttribute !== 'function' ) return;
        const themeAttr = this.getAttribute('theme');
        let isDark;
        if ( themeAttr === 'dark' ) {
            isDark = true;
        } else if ( themeAttr === 'light' ) {
            isDark = false;
        } else {
            isDark = typeof globalThis.matchMedia === 'function'
                && globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
        }
        this.classList.toggle('puter-theme-dark', isDark);
    }

    _rerender () {
        if ( ! this.shadowRoot ) return;
        this.shadowRoot.innerHTML = `<style>${this.getStyles()}</style>${this.render()}`;
        this.onReady();
    }

    /** Override in subclass: return CSS string */
    getStyles () {
        return '';
    }

    /** Override in subclass: return HTML string */
    render () {
        return '';
    }

    /** Override in subclass: called after render, set up event listeners here */
    onReady () {
    }

    /** Dispatch a CustomEvent from this element */
    emitEvent (name, detail) {
        this.dispatchEvent(new CustomEvent(name, {
            detail,
            bubbles: true,
            composed: true,
        }));
    }

    /** Query within shadow root */
    $ (selector) {
        return this.shadowRoot?.querySelector(selector);
    }

    /** Query all within shadow root */
    $$ (selector) {
        return this.shadowRoot?.querySelectorAll(selector);
    }

    /** Open a <dialog> inside the shadow root */
    open () {
        const dialog = this.$('dialog');
        if ( dialog && !dialog.open ) {
            dialog.showModal();
        }
    }

    /** Close and remove this component */
    close () {
        const dialog = this.$('dialog');
        if ( dialog ) dialog.close();
        this.remove();
    }
}

export default PuterWebComponent;
