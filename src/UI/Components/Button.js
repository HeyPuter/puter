export default class Button extends Component {
    static PROPERTIES = {
        label_key: {
            description: 'The key to use to look up the label for the button',
        },
        click: {
            description: 'The function to call when the button is clicked',
        },
    }

    create_template ({ template }) {
        $(template).html(`
            <button class="button button-block button-primary" data-button>
                ${i18n(this.get('label_key'))}
            </button>
        `);
    }
}