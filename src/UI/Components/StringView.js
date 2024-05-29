const Component = use('util.Component');

/**
 * A simple component that displays a string in the
 * specified style.
 */
export default def(class StringView extends Component {
    static ID = 'ui.component.StringView';

    static PROPERTIES = {
        text: { value: '' },
        heading: { value: 0 },
        no_html_encode: { value: false },
    }

    static CSS = /*css*/`
        h2 {
            margin: 0;
            color: hsl(220, 25%, 31%);
        }
        span {
            color: #3b4863;
        }
    `;

    create_template ({ template }) {
        $(template).html(`<span></span>`);
    }

    on_ready ({ listen }) {
        // TODO: listener composition, to avoid this
        const either = ({ heading, text }) => {
            const wrapper_nodeName = heading ? 'h' + heading : 'span';
            $(this.dom_).find('span').html(`<${wrapper_nodeName}>${
                this.get('no_html_encode') ? text : html_encode(text)
            }</${wrapper_nodeName}>`);
        };
        listen('heading', heading => {
            either({ heading, text: this.get('text') });
        });
        listen('text', text => {
            either({ heading: this.get('heading'), text });
        });
    }
});
