// This doesn't go in ./bases because it logically depends on
// both ./bases and ./traits, and ./traits depends on ./bases.

const { TraitBase } = require("./bases/TraitBase");

class AdvancedBase extends TraitBase {
    static TRAITS = [
        require('./traits/NodeModuleDITrait'),
        require('./traits/PropertiesTrait'),
    ]
}

module.exports = {
    AdvancedBase,
};
