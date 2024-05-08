import { Component, defineComponent } from "../../util/Component.js";

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

defineComponent('c-just-html', JustHTML);
