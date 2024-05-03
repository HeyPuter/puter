import ValueHolder from "./ValueHolder.js";

export class Component extends HTMLElement {
    constructor (property_values) {
        super();

        this.dom_ = this.attachShadow({ mode: 'open' });

        this.values_ = {};

        if ( this.constructor.template ) {
            const template = document.querySelector(this.constructor.template);
            this.dom_.appendChild(template.content.cloneNode(true));
        }

        for ( const key in this.constructor.PROPERTIES ) {
            let initial_value;
            if ( property_values && key in property_values ) {
                initial_value = property_values[key];
            }
            this.values_[key] = ValueHolder.adapt(initial_value);
        }
    }

    get (key) {
        return this.values_[key].get();
    }

    connectedCallback () {
        console.log('connectedCallback called')
        this.on_ready && this.on_ready(this.get_api_());
    }

    attach (destination) {
        const el = this.create_element_();
        this.dom_.appendChild(el);

        if ( destination instanceof HTMLElement ) {
            destination.appendChild(this);
            return;
        }

        if ( destination.$ === 'placeholder' ) {
            destination.replaceWith(this);
            return;
        }

        // TODO: generalize displaying errors about a value;
        //   always show: typeof value, value.toString()
        throw new Error(`Unknown destination type: ${destination}`);
    }

    place (slot_name, child_node) {
        child_node.setAttribute('slot', slot_name);
        this.appendChild(child_node);
    }

    create_element_ () {
        const template = document.createElement('template');
        if ( this.constructor.CSS ) {
            const style = document.createElement('style');
            style.textContent = this.constructor.CSS;
            this.dom_.appendChild(style);
        }
        if ( this.create_template ) {
            this.create_template({ template });
        }
        const el = template.content.cloneNode(true);
        return el;
    }

    get_api_ () {
        return {
            listen: (name, callback) => {
                this.values_[name].sub(callback);
                callback(this.values_[name].get());
            }
        };
    }
}
