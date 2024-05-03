import { Component } from "../../util/Component.js";

/**
 * Allows a flex layout of composed components to be
 * treated as a component.
 */
export default class Flexer extends Component {
    static PROPERTIES = {
        children: {},
    }

    create_template ({ template }) {
        // TODO: The way we handle loading assets doesn't work well
        // with web components, so for now it goes in the template.
        $(template).html(`
            <slot name="inside"></slot>
        `);
    }

    on_ready () {
        console.log('Flexer on_ready called');
        for ( const child of this.get('children') ) {
            child.setAttribute('slot', 'inside');
            child.attach(this);
        }
    }
}

// TODO: This is necessary because files can be loaded from
// both `/src/UI` and `/UI` in the URL; we need to fix that
if ( ! window.__component_flexer ) {
    window.__component_flexer = true;

    console.log('this is here');
    customElements.define('c-flexer', Flexer);
}
