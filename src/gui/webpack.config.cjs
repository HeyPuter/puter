const BaseConfig = require('./webpack/BaseConfig.cjs');

module.exports = {
    ...BaseConfig({ env: 'dev' }),
    optimization: {
        minimize: false
    },
};
