import { Component } from "../../util/Component.js";

/**
 * A simple component when you just need to test something.
 */
export default class TestView extends Component {
    static CSS = `
        div {
            background-color: lightblue;
            padding: 1em;
            border-radius: 0.5em;
        }
    `;

    create_template ({ template }) {
        $(template).html(`
            <div>I am a test view</div>
        `);
    }
}

// TODO: This is necessary because files can be loaded from
// both `/src/UI` and `/UI` in the URL; we need to fix that
if ( ! window.__component_testView ) {
    window.__component_testView = true;

    customElements.define('c-test-view', TestView);
}
