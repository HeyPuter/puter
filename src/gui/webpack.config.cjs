const BaseConfig = require('./webpack/BaseConfig.cjs');

module.exports = async () => ({
    ...(await BaseConfig({ env: 'dev' })),
    optimization: {
        minimize: false
    },
});
