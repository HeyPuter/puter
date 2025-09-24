const chai = require('chai');
chai.use(require('chai-as-promised'))
const expect = chai.expect;

module.exports = {
    name: 'whoami',
    description: 'a demo test for puterjs',
    do: async t => {
        const puter = t.puter;

        await t.case('demo (whoami)', async () => {
            const result = await puter.auth.whoami();
            expect(result.username).to.equal('admin');
        });
    }
}