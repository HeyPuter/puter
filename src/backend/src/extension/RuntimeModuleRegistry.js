const { AdvancedBase } = require("@heyputer/putility");
const { RuntimeModule } = require("./RuntimeModule");

class RuntimeModuleRegistry extends AdvancedBase {
    constructor () {
        super();
        this.modules_ = {};
    }
    
    register (extensionModule, options = {}) {
        if ( ! (extensionModule instanceof RuntimeModule) ) {
            throw new Error(`expected a RuntimeModule, but got: ${
                extensionModule?.constructor?.name ?? typeof extensionModule})`);
        }
        const uniqueName = options.as ?? extensionModule.name ?? require('uuid').v4();
        if ( this.modules_.hasOwnProperty(uniqueName) ) {
            throw new Error(`duplicate runtime module: ${uniqueName}`);
        }
        console.log(`registering with name... ${uniqueName}`);
        this.modules_[uniqueName] = extensionModule;
        extensionModule.runtimeModuleRegistry = this;
    }
    
    exportsOf (name) {
        if ( ! this.modules_[name] ) {
            throw new Error(`could not find runtime module: ${name}`);
        }
        return this.modules_[name].exports;
    }
}

module.exports = {
    RuntimeModuleRegistry
};
