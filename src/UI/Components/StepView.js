const Component = use('util.Component');

export default def(class StepView extends Component {
    static ID = 'ui.component.StepView';

    static PROPERTIES = {
        children: {},
        done: { value: false },
        position: { value: 0 },
    }

    static CSS = `
        #wrapper { display: none }
        * { -webkit-font-smoothing: antialiased;}
    `;

    create_template ({ template }) {
        $(template).html(`
            <div id="wrapper">
                <slot name="inside"></slot>
            </div>
        `);
    }

    on_focus () {
        this.children[this.get('position')].focus();
    }

    on_ready ({ listen }) {
        for ( const child of this.get('children') ) {
            child.setAttribute('slot', 'inside');
            child.attach(this);
            $(child).hide();
        }

        // show the first child
        $(this.children[0]).show();

        // listen for changes to the current step
        listen('position', position => {
            // hide all children
            for ( const child of this.children ) {
                $(child).hide();
            }

            // show the child at the current position
            $(this.children[position]).show();
            this.children[position].focus();
        });

        // now that we're ready, show the wrapper
        $(this.dom_).find('#wrapper').show();
    }

    back () {
        if ( this.get('position') === 0 ) return;
        this.set('position', this.get('position') - 1);
    }

    next () {
        if ( this.get('position') === this.children.length - 1 ) {
            this.set('done', true);
            return;
        }
        this.set('position', this.get('position') + 1);
    }
});
