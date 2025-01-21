const { verify_fsentry } = require("./fsentry");
const { expect } = require("chai");

module.exports = {
    name: 'stat',
    do: async t => {
        let result;

        const TEST_FILENAME = 'test_stat.txt';

        let recorded_uid = null;

        await t.case('stat with path (no flags)', async () => {
            await t.write(TEST_FILENAME, 'stat test\n', { overwrite: true });
            result = await t.stat(TEST_FILENAME);

            await verify_fsentry(t, result);
            recorded_uid = result.uid;
            await t.case('filename is correct', () => {
                expect(result.name).equal('test_stat.txt');
            });
        })

        await t.case('stat with uid (no flags)', async () => {
            result = await t.statu(recorded_uid);

            await verify_fsentry(t, result);
            await t.case('filename is correct', () => {
                expect(result.name).equal('test_stat.txt');
            });
        })

        await t.case('stat with no path or uid provided fails', async () => {
            let threw = false;
            try {
                const res = await t.get('stat', {});
            } catch (e) {
                expect(e.response.status).equal(400);
                expect(e.response.data).deep.equal({
                    code: 'field_missing',
                    message: 'Field `subject` is required.',
                    key: 'subject',
                });
                threw = true;
            }
            expect(threw).true;
        });

        const flags = ['permissions', 'versions'];
        for ( const flag of flags ) {
            await t.case('stat with ' + flag, async () => {
                result = await t.stat(TEST_FILENAME, {
                    ['return_' + flag]: true,
                });

                await verify_fsentry(t, result);
                await t.case('filename is correct', () => {
                    expect(result.name).equal(`test_stat.txt`);
                });
                await t.case(`result has ${flag} array`, () => {
                    expect(Array.isArray(result[flag])).true;
                });
            })
        }

        await t.mkdir('test_stat_subdomains', { overwrite: true });
        await t.case('stat with subdomains', async () => {
            result = await t.stat('test_stat_subdomains', {
                return_subdomains: true,
            });

            await verify_fsentry(t, result);
            await t.case('directory name is correct', () => {
                expect(result.name).equal(`test_stat_subdomains`);
            });
            await t.case(`result has subdomains array`, () => {
                expect(Array.isArray(result.subdomains)).true;
            });
            console.log('RESULT', result);
        })

        {
        const flag = 'size';
            await t.case('stat with ' + flag, async () => {
                result = await t.stat(TEST_FILENAME, {
                    ['return_' + flag]: true,
                });

                await verify_fsentry(t, result);
                await t.case('filename is correct', () => {
                    expect(result.name).equal(`test_stat.txt`);
                });
                console.log('RESULT', result);
            })
        }


        // console.log('result?', result);
    }
};
