import { Component } from "../../util/Component.js";

/**
 * Allows using an HTML string as a component.
 */
export default class JustHTML extends Component {
    static PROPERTIES = { html: { value: '' } };
    create_template ({ template }) {
        $(template).html(`<span></span>`);
    }
    on_ready ({ listen }) {
        listen('html', html => {
            $(this.dom_).find('span').html(html);
        });
    }
}

// TODO: This is necessary because files can be loaded from
// both `/src/UI` and `/UI` in the URL; we need to fix that
if ( ! window.__component_justHTML ) {
    window.__component_justHTML = true;

    customElements.define('c-just-html', JustHTML);
}
