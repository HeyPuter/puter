const Component = use('util.Component');

/**
 * Allows a flex layout of composed components to be
 * treated as a component.
 */
export default def(class Flexer extends Component {
    static ID = 'ui.component.Flexer';

    static PROPERTIES = {
        children: {},
        gap: { value: '20pt' },
    }

    static CSS = `
        :host > div {
            display: flex;
            flex-direction: column;
            justify-content: center;
        }
    `;

    create_template ({ template }) {
        // TODO: The way we handle loading assets doesn't work well
        // with web components, so for now it goes in the template.
        $(template).html(`
            <div><slot name="inside"></slot></div>
        `);
    }

    on_ready ({ listen }) {
        for ( const child of this.get('children') ) {
            child.setAttribute('slot', 'inside');
            child.attach(this);
        }

        listen('gap', gap => {
            $(this.dom_).find('div').first().css('gap', gap);
        });
    }
});
