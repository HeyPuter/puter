/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 */

const { BasicBase } = require('./BasicBase');

class FeatureBase extends BasicBase {
    constructor (parameters, ...a) {
        super(parameters, ...a);

        this._ = {
            features: this._get_merged_static_array('FEATURES'),
        };

        for ( const feature of this._.features ) {
            feature.install_in_instance(this,
                            {
                                parameters: parameters || {},
                            });
        }
    }
}

module.exports = {
    FeatureBase,
};
