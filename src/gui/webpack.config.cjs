const BaseConfig = require('./webpack/BaseConfig.cjs');

module.exports = {
    ...BaseConfig(),
    optimization: {
        minimize: false
    },
};
