const Component = use('util.Component');

export default def(class ActionCard extends Component {
    static ID = 'ui.component.ActionCard';
    static RENDER_MODE = Component.NO_SHADOW;

    static PROPERTIES = {
        title: {
            value: 'Title'
        },
        info: {},
        button_text: {},
        button_style: {},
        on_click: {},
        style: {},
    }

    create_template ({ template }) {
        $(template).html(/*html*/`
            <div class="settings-card ${ this.get('style') ? this.get('style') : '' }">
                <div>
                    <strong style="display: block">${ this.get('title') }</strong>
                    <span style="display: block margin-top: 5px">${
                        this.get('info')
                    }</span>
                </div>
                <div style="flex-grow: 1">
                    <button class="button ${ this.get('button_style') }" style="float: right;">${
                        this.get('button_text')
                    }</button>
                </div>
            </div>
        `);
    }

    on_ready ({ listen }) {
        $(this.dom_).find('button').on('click', this.get('on_click') || (() => {}));
    }
});
