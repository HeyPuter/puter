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
        this._rerender();
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
