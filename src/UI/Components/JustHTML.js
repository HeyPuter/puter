const Component = use('util.Component');

/**
 * Allows using an HTML string as a component.
 */
export default def(class JustHTML extends Component {
    static ID = 'ui.component.JustHTML';

    static PROPERTIES = { html: { value: '' } };
    create_template ({ template }) {
        $(template).html(`<span></span>`);
    }
    on_ready ({ listen }) {
        listen('html', html => {
            $(this.dom_).find('span').html(html);
        });
    }

    _set_dom_based_on_render_mode({ property_values }) {
        if ( property_values.no_shadow ) {
            this.dom_ = this;
            return;
        }

        return super._set_dom_based_on_render_mode();
    }
});
