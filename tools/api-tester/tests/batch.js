const { expect } = require("chai");
const { verify_fsentry } = require("./fsentry");

module.exports = {
    name: 'batch',
    do: async t => {
        let results;
        /*
        await t.case('batch write', async () => {
            results = null;
            results = await t.batch('/batch/write', [
                {
                    path: t.resolve('test_1.txt'),
                    overwrite: true,
                },
                {
                    path: t.resolve('test_3.txt'),
                }
            ], [
                'first file',
                'second file',
            ])
            console.log('results?', results)
            expect(results.length).equal(2);
            for ( const result of results ) {
                await verify_fsentry(t, result)
            }
        });
        t.case('batch mkdir', async () => {
            results = null;
            results = await t.batch_json('batch/mkdir', [
                {
                    path: t.resolve('test_1_dir'),
                    overwrite: true,
                },
                {
                    path: t.resolve('test_3_dir'),
                }
            ])
            expect(results.length).equal(2);
            for ( const result of results ) {
                await verify_fsentry(t, result)
            }
        });
        */
        await t.case('3-3 nested directores', async () => {
            results = null;
            results = await t.batch('batch', [
                {
                    op: 'mktree',
                    parent: t.cwd,
                    tree: [
                        'a/b/c',
                        [
                            'a/b/c',
                            ['a/b/c'],
                            ['d/e/f'],
                            ['g/h/i'],
                            ['j/k/l'],
                        ],
                        [
                            'd/e/f',
                            ['a/b/c'],
                            ['d/e/f'],
                            ['g/h/i'],
                            ['j/k/l'],
                        ],
                        [
                            'g/h/i',
                            ['a/b/c'],
                            ['d/e/f'],
                            ['g/h/i'],
                            ['j/k/l'],
                        ],
                        [
                            'j/k/l',
                            ['a/b/c'],
                            ['d/e/f'],
                            ['g/h/i'],
                            ['j/k/l'],
                        ],
                    ]
                }
            ], []);
        });
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
                    op: 'mkdir',
                    as: 'dest_2',
                    path: t.resolve('q/w'), // "q/w (1)"
                    dedupe_name: true,
                    create_missing_parents: true,
                },
                {
                    op: 'write',
                    path: t.resolve('$dest_1/file_1.txt'),
                },
                {
                    op: 'write',
                    path: t.resolve('$dest_2/file_2.txt'),
                },
            ], [
                'file 1 contents',
                'file 2 contents',
            ]);
            console.log('res?', results)
            expect(results.length).equal(4);
            expect(results[0].name).equal('w');
            expect(results[1].name).equal('w (1)');
            expect(results[2].path).equal(t.resolve('q/w/file_1.txt'));
            expect(results[3].path).equal(t.resolve('q/w (1)/file_2.txt'));
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

        await t.case('path reference resolution (without dedupe)', async () => {
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
            console.log('res?', results)
            expect(results.length).equal(2);
            expect(results[0].name).equal('w');
            expect(results[1].path).equal(t.resolve('q/w/file_1.txt'));
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
                    op: 'mkdir',
                    as: 'dest_2',
                    path: t.resolve('q/w'), // "q/w (1)"
                    dedupe_name: true,
                    create_missing_parents: true,
                },
                {
                    op: 'write',
                    path: t.resolve('$dest_1/file_1.txt'),
                },
                {
                    op: 'write',
                    path: t.resolve('$dest_2/file_2.txt'),
                },
            ], [
                'file 1 contents',
                'file 2 contents',
            ]);
            console.log('res?', results)
            expect(results.length).equal(4);
            expect(results[0].name).equal('w');
            expect(results[1].name).equal('w (1)');
            expect(results[2].path).equal(t.resolve('q/w/file_1.txt'));
            expect(results[3].path).equal(t.resolve('q/w (1)/file_2.txt'));
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
