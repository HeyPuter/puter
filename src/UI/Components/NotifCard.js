const Component = use('util.Component');

export default def(class NotifCard extends Component {
    static ID = 'ui.component.NotifCard';
    static RENDER_MODE = Component.NO_SHADOW;

    static PROPERTIES = {
        text: { value: 'no text' },
        style: {},
    }

    create_template ({ template }) {
        $(template).html(/*html*/`
            <div class="settings-card thin-card ${ this.get('style') ? this.get('style') : '' }">
                <div>
                    ${ this.get('text') }
                </div>
            </div>
        `);
    }
});
