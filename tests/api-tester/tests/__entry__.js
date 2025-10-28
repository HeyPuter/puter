module.exports = registry => {
    // ======================================================================
    // Auth
    // ======================================================================
    registry.add_test('auth', require('./auth'));

    // ======================================================================
    // File System
    // ======================================================================
    registry.add_test('write_cart', require('./write_cart'));
    registry.add_test('move_cart', require('./move_cart'));
    registry.add_test('copy_cart', require('./copy_cart'));
    registry.add_test('write_and_read', require('./write_and_read'));
    registry.add_test('move', require('./move'));
    registry.add_test('stat', require('./stat'));
    registry.add_test('readdir', require('./readdir'));
    registry.add_test('mkdir', require('./mkdir'));
    registry.add_test('batch', require('./batch'));
    registry.add_test('delete', require('./delete'));
    registry.add_test('telem_write', require('./telem_write'));
};
