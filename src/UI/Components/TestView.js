const Component = use('util.Component');

/**
 * A simple component when you just need to test something.
 */
export default def(class TestView extends Component {
    static ID = 'ui.component.TestView';

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
});
