//@puter priority -1
console.log('exporting something...');
extension.exports = {
    testval: 5,
};

extension.on('init', () => {
    extension.emit('hello', {
        from: 'exports_something',
    });
});
