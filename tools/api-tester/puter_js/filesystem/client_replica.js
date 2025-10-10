const chai = require('chai');
chai.use(require('chai-as-promised'))
const expect = chai.expect;

module.exports = {
    name: 'client_replica',
    description: '',
    do: async t => {
        const puter = t.puter;

        await t.case('check available', async () => {
            const result = await puter.auth.whoami();

            // sleep for 1 second
            await new Promise(resolve => setTimeout(resolve, 10000));

            const available = puter.fs.replica.available;
            expect(available).to.equal(true);
        });
    }
}