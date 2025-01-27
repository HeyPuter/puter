const chai = require('chai');
chai.use(require('chai-as-promised'))
const expect = chai.expect;

module.exports = {
    name: 'single write for trace and span',
    do: async t => {
        let result;

        const TEST_FILENAME = 'test_telem.txt';

        await t.write(TEST_FILENAME, 'example\n', { overwrite: true });
    }
};
