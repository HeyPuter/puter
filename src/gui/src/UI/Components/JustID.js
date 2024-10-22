const Component = use('util.Component');

export default def(class JustID extends Component {
    static ID = 'ui.component.JustID';
    static RENDER_MODE = Component.NO_SHADOW;

    static PROPERTIES = {
        id: { value: undefined },
    }

    create_template ({ template }) {
        const size = 24;
        $(template).html(/*html*/`
            <div
                style="height: 358px"
                id="${this.get('id')}"></div>
        `);
    }
})
