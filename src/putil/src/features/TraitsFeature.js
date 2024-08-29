module.exports = {
    install_in_instance: (instance, { parameters }) => {
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
};
