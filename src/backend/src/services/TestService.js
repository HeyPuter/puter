const BaseService = require('./BaseService');

class TestService extends BaseService {
    method_to_mock () {
        return 5;
    }

    __test_method_to_mock () {
        return 7;
    }

    _test ({ assert }) {
        assert.equal(this.method_to_mock(), 7);
    }
}

module.exports = { TestService };
