module.exports = registry => {
    console.log('filesystem __entry__.js');
    registry.add_test('write', require('./write.js'));
};