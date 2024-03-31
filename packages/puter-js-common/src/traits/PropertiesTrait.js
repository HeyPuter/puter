module.exports = {
    install_in_instance: (instance) => {
        const properties = instance._get_merged_static_object('PROPERTIES');

        for ( const k in properties ) {
            if ( typeof properties[k] === 'function' ) {
                instance[k] = properties[k]();
                continue;
            }

            if ( typeof properties[k] === 'object' ) {
                // This will be supported in the future.
                throw new Error(`Property ${k} in ${instance.constructor.name} ` +
                    `is not a supported property specification.`);
            }

            instance[k] = properties[k];
        }
    }
}
