module.exports = registry => {
    registry.add_test('whoami', require('./whoami.js'));
};