
const { verify_fsentry } = require("./fsentry");
const { expect } = require("chai");

module.exports = {
    name: 'readdir',
    do: async t => {
        // let result;

        await t.mkdir('test_readdir', { overwrite: true });
        t.cd('test_readdir');

        const files = ['a.txt', 'b.txt', 'c.txt'];
        const dirs = ['q', 'w', 'e'];

        for ( const file of files ) {
            await t.write(file, 'readdir test\n', { overwrite: true });
        }
        for ( const dir of dirs ) {
            await t.mkdir(dir, { overwrite: true });
        }

        for ( const file of files ) {
            const result = await t.stat(file);
            await verify_fsentry(t, result);
        }
        for ( const dir of dirs ) {
            const result = await t.stat(dir);
            await verify_fsentry(t, result);
        }

        await t.case('readdir of root shouldn\'t return everything', async () => {
            const result = await t.readdir('/', { recursive: true });
            console.log('result?', result)
        })

        // t.cd('..');
    }
};
