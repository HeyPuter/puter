module.exports = registry => {
    registry.add_bench('write_intensive_1', require('./write_intensive_1.js'));
    registry.add_bench('stat_intensive_1', require('./stat_intensive_1.js'));
};
