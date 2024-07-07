const { BasicBase } = require("./BasicBase");

class TraitBase extends BasicBase {
    constructor (parameters, ...a) {
        super(parameters, ...a);
        for ( const trait of this.traits ) {
            trait.install_in_instance(
                this,
                {
                    parameters: parameters || {},
                }
            )
        }
    }

    get traits () {
        return this._get_merged_static_array('TRAITS');
    }
}

module.exports = {
    TraitBase,
};
