const chai = require('chai');
chai.use(require('chai-as-promised'))
const expect = chai.expect;

module.exports = {
    name: 'write',
    description: 'a collection of tests for writing to the filesystem',
    do: async t => {
        const puter = t.puter;

        await t.case('demo (whoami)', async () => {
            const result = await puter.auth.whoami();
            expect(result.username).to.equal('admin');
        });

        await t.case('write and share', async () => {
            let result = await puter.fs.write('~/test.txt', 'hello');
            expect(result.name).to.equal('test.txt');

            result = await puter.fs.share('~/test.txt', {
                recipients: ['tom', 'jerry'],
                access: 'read',
                withPermissions: true,
            });
            console.log('result', result);
            expect(result.recipients.length).to.equal(2);
        });

        await t.case('write with share args', async () => {
            let result = await puter.fs.write('~/test.txt', 'hello', {
                share: {
                    recipients: ['tom', 'jerry'],
                    access: 'read',
                },
                withPermissions: true,
            });
            expect(result.share.recipients.length).to.equal(2);
        });
    }
}