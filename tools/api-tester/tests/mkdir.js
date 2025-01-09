const { expect } = require("chai");
const { verify_fsentry } = require("./fsentry");

module.exports = {
    name: 'mkdir',
    do: async t => {
        await t.case('recursive mkdir', async () => {
            // Can create a chain of directories
            const path = 'a/b/c/d/e/f/g';
            let result;
            await t.case('no exception thrown', async () => {
                result = await t.mkdir(path, {
                    create_missing_parents: true,
                });
                console.log('result?', result)
            });
            
            // Returns the last directory in the chain
            // await verify_fsentry(t, result);
            await t.case('filename is correct', () => {
                expect(result.name).equal('g');
            });

            await t.case('can stat the directory', async () => {
                const stat = await t.stat(path);
                // await verify_fsentry(t, stat);
                await t.case('filename is correct', () => {
                    expect(stat.name).equal('g');
                });
            });

            // can stat the first directory in the chain
            await t.case('can stat the first directory in the chain', async () => {
                const stat = await t.stat('a');
                // await verify_fsentry(t, stat);
                await t.case('filename is correct', () => {
                    expect(stat.name).equal('a');
                });
            });
        });

        // NOTE: It looks like we removed this behavior and we always create missing parents
        // await t.case('fails with missing parent', async () => {
        //     let threw = false;
        //     try {
        //         const result = await t.mkdir('a/b/x/g');

        //         console.log('unexpected result', result);
        //     } catch (e) {
        //         expect(e.response.status).equal(422);
        //         console.log('response?', e.response.data)
        //         expect(e.response.data).deep.equal({
        //             code: 'dest_does_not_exist',
        //             message: 'Destination was not found.',
        //         });
        //         threw = true;
        //     }
        //     expect(threw).true;
        // });

        await t.case('mkdir dedupe name', async () => {
            for ( let i = 1; i <= 3; i++ ) {
                await t.mkdir('a', { dedupe_name: true });
                const stat = await t.stat(`a (${i})`);
                expect(stat.name).equal(`a (${i})`);
            }
        });
    }
};