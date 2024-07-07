const { AdvancedBase } = require("@heyputer/puter-js-common");

class ServicePatch extends AdvancedBase {
    patch ({ original_service }) {
        const patch_methods = this._get_merged_static_object('PATCH_METHODS');
        for ( const k in patch_methods ) {
            if ( typeof patch_methods[k] !== 'function' ) {
                throw new Error(`Patch method ${k} to ${original_service.service_name} ` +
                    `from ${this.constructor.name} ` +
                    `is not a function.`)
            }

            const patch_method = patch_methods[k];

            const patch_arguments = {
                that: original_service,
                original: original_service[k].bind(original_service),
            };

            original_service[k] = (...a) => {
                return patch_method.call(this, patch_arguments, ...a);
            }
        }
    }
}

module.exports = ServicePatch;
