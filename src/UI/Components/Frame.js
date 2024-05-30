const Component = use('util.Component');

export default def(class Frame extends Component {
    static ID = 'ui.component.Frame';
    static RENDER_MODE = Component.NO_SHADOW;

    static PROPERTIES = {
        component: {},
    }

    on_ready ({ listen }) {
        listen('component', component => {
            this.dom_.innerHTML = '';
            if ( ! component ) {
                return;
            }
            component.attach(this.dom_);
        });
    }
});
