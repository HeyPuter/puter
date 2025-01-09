const chai = require('chai');
chai.use(require('chai-as-promised'))
const expect = chai.expect;

module.exports = {
    name: 'write and read',
    do: async t => {
        let result;

        const TEST_FILENAME = 'test_rw.txt';

        await t.write(TEST_FILENAME, 'example\n', { overwrite: true });

        await t.case('read matches what was written', async () => {
            result = await t.read(TEST_FILENAME);
            expect(result).equal('example\n');
        });

        await t.case('write throws for overwrite=false', () => {
            expect(
                t.write(TEST_FILENAME, 'no-change\n')
            ).rejectedWith(Error);
        });

        await t.case('write updates for overwrite=true', async () => {
            await t.write(TEST_FILENAME, 'yes-change\n', {
                overwrite: true,
            });
            result = await t.read(TEST_FILENAME);
            expect(result).equal('yes-change\n');
        });

        await t.case('write updates for overwrite=true', async () => {
            await t.write(TEST_FILENAME, 'yes-change\n', {
                overwrite: true,
            });
            result = await t.read(TEST_FILENAME, { version_id: '1' });
            expect(result).equal('yes-change\n');
        });

        await t.case('read with no path or uid provided fails', async () => {
            let threw = false;
            try {
                const res = await t.get('read', {});
            } catch (e) {
                expect(e.response.status).equal(400);
                expect(e.response.data).deep.equal({
                    message: 'Field \`file\` is required.',
                    code: 'field_missing',
                    key: 'file',
                });
                threw = true;
            }
            expect(threw).true;
        });

        await t.case('read for non-existing path fails', async () => {
            let threw = false;
            try {
                await t.read('i-do-not-exist.txt');
            } catch (e) {
                expect(e.response.status).equal(404);
                expect(e.response.data).deep.equal({ message: 'Path not found.' });
                threw = true;
            }
            expect(threw).true;
        });
    }
};
