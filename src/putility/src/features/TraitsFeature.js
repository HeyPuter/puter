/*
 * Copyright (C) 2024 Puter Technologies Inc.
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

module.exports = {
    // old implementation
    install_in_instance_: (instance, { parameters }) => {
        const impls = instance._get_merged_static_object('IMPLEMENTS');
        
        instance._.impls = {};
        
        for ( const impl_name in impls ) {
            const impl = impls[impl_name];
            const bound_impl = {};
            for ( const method_name in impl ) {
                const fn = impl[method_name];
                bound_impl[method_name] = fn.bind(instance);
            }
            instance._.impls[impl_name] = bound_impl;
        }
        
        instance.as = trait_name => instance._.impls[trait_name];
        instance.list_traits = () => Object.keys(instance._.impls);
    },

    // new implementation
    install_in_instance: (instance, { parameters }) => {
        const chain = instance._get_inheritance_chain();
        instance._.impls = {};
        
        instance.as = trait_name => instance._.impls[trait_name];
        instance.list_traits = () => Object.keys(instance._.impls);
        instance.mixin = (name, impl) => instance._.impls[name] = impl;

        for ( const cls of chain ) {
            const cls_traits = cls.IMPLEMENTS;
            if ( ! cls_traits ) continue;
            const trait_keys = [
                ...Object.getOwnPropertySymbols(cls_traits),
                ...Object.keys(cls_traits),
            ];
            for ( const trait_name of trait_keys ) {
                const impl = instance._.impls[trait_name] ??
                    (instance._.impls[trait_name] = {});
                const cls_impl = cls_traits[trait_name];

                for ( const method_name in cls_impl ) {
                    const fn = cls_impl[method_name];
                    impl[method_name] = fn.bind(instance);
                }
            }
        }
    }
};
