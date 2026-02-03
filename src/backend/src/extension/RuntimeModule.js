const { AdvancedBase } = require('@heyputer/putility');

class RuntimeModule extends AdvancedBase {
    constructor (options = {}) {
        super();
        this.exports_ = undefined;
        this.exports_is_set_ = false;
        this.remappings = options.remappings ?? {};

        this.name = options.name ?? undefined;
    }
    set exports (value) {
        this.exports_is_set_ = true;
        this.exports_ = value;
    }
    get exports () {
        if ( this.exports_is_set_ === false && this.defer ) {
            this.exports = this.defer();
        }
        return this.exports_;
    }
    import (name) {
        if ( this.remappings.hasOwnProperty(name) ) {
            name = this.remappings[name];
        }
        return this.runtimeModuleRegistry.exportsOf(name);
    }
}

module.exports = { RuntimeModule };
