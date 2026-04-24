export default class AdvancedBase {
    constructor (parameters = {}) {
        this._ = {};

        this.#installProperties(parameters);
        this.#installTraits();
    }

    _get_inheritance_chain () {
        const chain = [];
        let cls = this.constructor;
        while ( cls && cls !== Function.prototype ) {
            chain.push(cls);
            cls = Object.getPrototypeOf(cls);
        }
        return chain.reverse();
    }

    _get_merged_static_array (key) {
        const values = [];
        let last = null;
        for ( const cls of this._get_inheritance_chain() ) {
            if ( Array.isArray(cls[key]) && cls[key] !== last ) {
                last = cls[key];
                values.push(...cls[key]);
            }
        }
        return values;
    }

    _get_merged_static_object (key) {
        const values = {};
        for ( const cls of this._get_inheritance_chain() ) {
            if ( cls[key] ) {
                Object.assign(values, cls[key]);
            }
        }
        return values;
    }

    #installProperties (parameters) {
        const properties = this._get_merged_static_object('PROPERTIES');
        this._.properties = {};

        this.onchange = (name, callback) => {
            this._.properties[name].listeners.push(callback);
        };

        for ( const name of Reflect.ownKeys(properties) ) {
            const definition = properties[name];
            const state = {
                definition,
                listeners: [],
                value: undefined,
            };
            this._.properties[name] = state;

            let spec = null;
            if ( typeof definition === 'object' && definition !== null ) {
                spec = { ...definition };
                if ( spec.factory ) {
                    spec.value = spec.factory({ parameters });
                }
            } else if ( typeof definition === 'function' ) {
                spec = {
                    value: definition(),
                };
            }

            if ( spec === null ) {
                throw new Error(`Invalid property definition for ${String(name)}`);
            }

            Object.defineProperty(this, name, {
                get: () => state.value,
                set: (value) => {
                    const old_value = this[name];
                    for ( const listener of state.listeners ) {
                        listener(value, { old_value });
                    }

                    const intermediate_value = value;
                    if ( spec.adapt ) {
                        value = spec.adapt(value);
                    }
                    state.value = value;

                    if ( spec.post_set ) {
                        spec.post_set.call(this, value, {
                            intermediate_value,
                            old_value,
                        });
                    }
                },
            });

            state.value = spec.value;

            if ( definition.construct ) {
                const key = typeof definition.construct === 'string'
                    ? definition.construct
                    : name;
                this[name] = parameters[key];
            }
        }
    }

    #installTraits () {
        this._.impls = {};

        this.as = trait_name => this._.impls[trait_name];
        this.list_traits = () => Object.keys(this._.impls);
        this.mixin = (name, impl) => {
            this._.impls[name] = impl;
            return impl;
        };

        for ( const cls of this._get_inheritance_chain() ) {
            const cls_traits = cls.IMPLEMENTS;
            if ( ! cls_traits ) continue;

            const trait_names = Reflect.ownKeys(cls_traits);
            for ( const trait_name of trait_names ) {
                const impl = this._.impls[trait_name] ??
                    (this._.impls[trait_name] = {});
                const cls_impl = cls_traits[trait_name];

                for ( const method_name in cls_impl ) {
                    impl[method_name] = cls_impl[method_name].bind(this);
                }
            }
        }
    }
}
