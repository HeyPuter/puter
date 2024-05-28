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
});
