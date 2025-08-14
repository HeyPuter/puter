module.exports = registry => {
    registry.add_bench('write-intensive-1', require('./write_intensive_1.js'));
};
