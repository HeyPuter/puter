/**
 * PuterWebComponent - Base class for all Puter web components.
 * Provides Shadow DOM setup, theme injection, and common helpers.
 *
 * Theme attribute:
 *   - "default" (or omitted): puter.com native styles
 *   - "custom": current custom styles with CSS variable support
 */

import { themeCSS } from './PuterTheme.js';

class PuterWebComponent extends (globalThis.HTMLElement || Object) {
    static get observedAttributes () {
        return ['theme'];
    }

    constructor () {
        super();
        if ( typeof globalThis.HTMLElement !== 'undefined' ) {
            this.attachShadow({ mode: 'open' });
        }
    }

    connectedCallback () {
        this._rerender();
    }

    attributeChangedCallback (name, oldVal, newVal) {
        if ( name === 'theme' && oldVal !== newVal && this.isConnected ) {
            this._rerender();
        }
    }

    /** Re-render the component with the appropriate theme styles */
    _rerender () {
        if ( ! this.shadowRoot ) return;
        const theme = this.getTheme();
        const styles = theme === 'custom'
            ? `${themeCSS}\n${this.getStyles()}`
            : this.getDefaultStyles();
        this.shadowRoot.innerHTML = `<style>${styles}</style>${this.render()}`;
        this.onReady();
    }

    /** Get the current theme: "default" or "custom" */
    getTheme () {
        return this.getAttribute('theme') || 'default';
    }

    /** Override in subclass: return CSS string for "custom" theme */
    getStyles () {
        return '';
    }

    /** Override in subclass: return CSS string for "default" (puter.com) theme */
    getDefaultStyles () {
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
