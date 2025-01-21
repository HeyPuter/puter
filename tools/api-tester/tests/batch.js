const { expect } = require("chai");
const { verify_fsentry } = require("./fsentry");

module.exports = {
    name: 'batch',
    do: async t => {
        let results;

        await t.case('path reference resolution', async () => {
            results = null;
            results = await t.batch('batch', [
                {
                    op: 'mkdir',
                    as: 'dest_1',
                    path: t.resolve('q/w'),
                    create_missing_parents: true,
                },
                {
                    op: 'write',
                    path: t.resolve('$dest_1/file_1.txt'),
                },
            ], [
                'file 1 contents',
            ]);
            expect(results.length).equal(2);
            expect(results[0].name).equal('w');
            expect(results[1].path).equal(t.resolve('q/w/file_1.txt'));
        });

        await t.case('batch mkdir and write', async () => {
            results = null;
            results = await t.batch('batch', [
                {
                    op: 'mkdir',
                    path: t.resolve('test_x_1_dir'),
                    overwrite: true,
                },
                {
                    op: 'write',
                    path: t.resolve('test_x_1.txt'),
                },
                {
                    op: 'mkdir',
                    path: t.resolve('test_x_2_dir'),
                },
                {
                    op: 'write',
                    path: t.resolve('test_x_2.txt'),
                }
            ], [
                'first file',
                'second file',
            ]);
            console.log('res?', results)
            expect(results.length).equal(4);
            for ( const result of results ) {
                // await verify_fsentry(t, result)
            }
        });

        // Test for path reference resolution
        await t.case('path reference resolution', async () => {
            results = null;
            results = await t.batch('batch', [
                {
                    op: 'mkdir',
                    as: 'dest_1',
                    path: t.resolve('q/w'),
                    create_missing_parents: true,
                },
                {
                    op: 'write',
                    overwrite: true,
                    path: t.resolve('$dest_1/file_1.txt'),
                },
            ], [
                'file 1 contents',
            ]);
            console.log('res?', results)
            expect(results.length).equal(2);
            expect(results[0].name).equal('w');
            expect(results[1].path).equal(t.resolve('q/w/file_1.txt'));
        });

        // Test for a single write
        await t.case('single write', async () => {
            results = null;
            results = await t.batch('batch', [
                {
                    op: 'write',
                    path: t.resolve('just_one_file.txt'),
                },
            ], [
                'file 1 contents',
            ]);
            console.log('res?', results)
        });
    }
};
