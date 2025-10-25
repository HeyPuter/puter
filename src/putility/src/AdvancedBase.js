/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 */

// This doesn't go in ./bases because it logically depends on
// both ./bases and ./traits, and ./traits depends on ./bases.

const { FeatureBase } = require("./bases/FeatureBase");

class AdvancedBase extends FeatureBase {
    static FEATURES = [
        require('./features/NodeModuleDIFeature'),
        require('./features/PropertiesFeature'),
        require('./features/TraitsFeature'),
        require('./features/NariMethodsFeature'),
        require('./features/TopicsFeature'),
    ]
}

module.exports = {
    AdvancedBase,
};
