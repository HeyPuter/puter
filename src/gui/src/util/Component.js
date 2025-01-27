/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
import ValueHolder from "./ValueHolder.js";

export const Component = def(class Component extends HTMLElement {
    static ID = 'util.Component';

    #has_created_element = false;
    #has_called_on_ready = false;

    // Render modes
    static NO_SHADOW = Symbol('no-shadow');

    static TODO = [
        'value bindings for create_template',
    ]

    static on_self_registered ({ is_owner, on_other_registered }) {
        // Only invoked for Component itself, not subclasses
        if ( ! is_owner ) return;

        // Automatically define components for all HTML elements
        on_other_registered(({ cls }) => {
            if ( cls.ID === 'ui.component.StepHeading' ) {
                globalThis.sh_shouldbe = cls;
            }
            if ( globalThis.lib.is_subclass(cls, HTMLElement) ) {
                defineComponent(cls);
            }
        });
    }

    _set_dom_based_on_render_mode () {
        if ( this.constructor.RENDER_MODE === Component.NO_SHADOW ) {
            this.dom_ = this;
        } else {
            this.dom_ = this.attachShadow({ mode: 'open' });
        }
    }

    constructor (property_values) {
        super();

        property_values = property_values || {};

        // We allow a subclass of component to define custom behavior
        // for the `RENDER_MODE` static property. This is so JustHTML
        // can have ths `no_shadow: true` option.
        this._set_dom_based_on_render_mode({ property_values });

        this.values_ = {};

        if ( this.constructor.template ) {
            const template = document.querySelector(this.constructor.template);
            this.dom_.appendChild(template.content.cloneNode(true));
        }

        for ( const key in this.constructor.PROPERTIES ) {
            let initial_value;
            if ( property_values && key in property_values ) {
                initial_value = property_values[key];
            } else if ( this.constructor.PROPERTIES[key].value !== undefined ) {
                initial_value = this.constructor.PROPERTIES[key].value;
            }
            this.values_[key] = ValueHolder.adapt(initial_value);

            const listener_key = `property.${key}`;
            if ( property_values[listener_key] ) {
                this.values_[key].sub((value, more) => {
                    more = { ...more, component: this };
                    property_values[listener_key](value, more);
                });
            }
        }

        // Convenience for setting a property while composing components
        if ( property_values && property_values.hasOwnProperty('_ref') ) {
            property_values._ref(this);
        }

        // Setup focus handling
        if ( property_values && property_values[`event.focus`] ) {
            const on_focus_ = this.on_focus;
            this.on_focus = (...a) => {
                property_values[`event.focus`]();
                on_focus_ && on_focus_(...a);
            }
        }
        this.addEventListener('focus', () => {
            if ( this.on_focus ) {
                this.on_focus();
            }
        });
    }

    focus () {
        super.focus();
        // Apparently the 'focus' event only fires when the element is focused
        // by other means than calling .focus() on it, so this isn't redundant.

        // We use a 0ms timeout to ensure that the focus event has been
        // processed before we call on_focus, which may rely on the focus
        // event having been processed (and typically does).
        setTimeout(() => {
            if ( this.on_focus ) {
                this.on_focus();
            }
        }, 0);
    }

    get (key) {
        if ( ! this.values_.hasOwnProperty(key) ) {
            throw new Error(`Unknown property \`${key}\` in ${
                this.constructor.ID || this.constructor.name}`);
        }
        return this.values_[key].get();
    }

    set (key, value) {
        this.values_[key].set(value);
    }

    connectedCallback () {
        if (!this.#has_called_on_ready) {
            this.on_ready && this.on_ready(this.get_api_());
            this.#has_called_on_ready = true;
        }
    }

    attach (destination) {
        if (!this.#has_created_element) {
            const el = this.create_element_();
            this.dom_.appendChild(el);
            this.#has_created_element = true;
        }

        if ( destination instanceof HTMLElement ) {
            destination.appendChild(this);
            return;
        }

        if ( destination instanceof ShadowRoot ) {
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
            this.create_template({
                template,
                content: template.content,
            });
        }
        const el = template.content.cloneNode(true);
        return el;
    }

    get_api_ () {
        return {
            listen: (name, callback) => {
                if ( Array.isArray(name) ) {
                    const names = name;
                    for ( const name of names ) {
                        this.values_[name].sub((_, more) => {
                            callback(this, { ...more, name });
                        });
                    }
                }
                this.values_[name].sub(callback);
                callback(this.values_[name].get(), {});
            },
            dom: this.dom_,
        };
    }
});

export const defineComponent = (component) => {
    // Web components need tags (despite that we never use the tags)
    // because it was designed this way.
    if ( globalThis.lib.is_subclass(component, HTMLElement) ) {
        let name = component.ID;
        name = 'c-' + name.split('.').pop().toLowerCase();
        // TODO: This is necessary because files can be loaded from
        // both `/src/UI` and `/UI` in the URL; we need to fix that
        if ( customElements.get(name) ) return;
        customElements.define(name, component);
        component.defined_as = name;
    }
};
