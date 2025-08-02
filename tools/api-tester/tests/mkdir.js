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

        await t.case('mkdir in root directory is prohibited', async () => {
            const path = '/a';
            await t.case('throws 403', async () => {
                try {
                    // full path format: {"path":"/foo/bar", args...}
                    await t.mkdir(path);
                } catch (e) {
                    expect(e.response.status).equal(403);
                }

                try {
                    // parent + path format: {"parent": "/foo", "path":"bar", args...}
                    const parent = '/';
                    await t.mkdir(path, {
                        parent: parent,
                    });
                } catch (e) {
                    expect(e.response.status).equal(403);
                }
            });
        });

        await t.case('full path api', async () => {
            t.cd('full_path_api');

            await t.case('create_missing_parents works', async () => {
                t.cd('create_missing_parents_works');

                await t.case('parent directory does not exist', async () => {
                    try {
                        await t.stat('a');
                    } catch (e) {
                        expect(e.response.status).equal(404);
                    }
                });

                await t.case('mkdir succeeds with create_missing_parents', async () => {
                    const result = await t.mkdir('a/b/c', {
                        create_missing_parents: true,
                    });
                    expect(result.name).equal('c');
                });

                await t.case('mkdir failed without create_missing_parents', async () => {
                    try {
                        await t.mkdir('a/b/c');
                    } catch (e) {
                        expect(e.response.status).equal(409);
                    }
                });

                await t.case('can stat all directories along the path', async () => {
                    let stat = await t.stat('a');
                    expect(stat.name).equal('a');

                    stat = await t.stat('a/b');
                    expect(stat.name).equal('b');

                    stat = await t.stat('a/b/c');
                    expect(stat.name).equal('c');
                });
            });
        });

        await t.case('parent + path api', async () => {
            t.cd('parent_path_api');

            await t.case('parent directory does not exist', async () => {
                try {
                    await t.stat('a');
                } catch (e) {
                    expect(e.response.status).equal(404);
                }
            });

            await t.case('mkdir failed without create_missing_parents', async () => {
                try {
                    await t.mkdir_v2('a/b', 'c');
                } catch (e) {
                    // TODO (xiaochen): `t.mkdir('a/b/c')` throws 409, unify the
                    // behavior of these two cases.
                    expect(e.response.status).equal(422);
                }
            });

            await t.case('mkdir succeeds with create_missing_parents', async () => {
                const result = await t.mkdir_v2('a/b', 'c', {
                    create_missing_parents: true,
                });
                expect(result.name).equal('c');

                await t.case('can stat directories along the path', async () => {
                    let stat = await t.stat('a');
                    expect(stat.name).equal('a');

                    stat = await t.stat('a/b');
                    expect(stat.name).equal('b');

                    stat = await t.stat('a/b/c');
                    expect(stat.name).equal('c');
                });
            });

            await t.case('composite path', async () => {
                const result = await t.mkdir_v2('1/2', '3/4', {
                    create_missing_parents: true,
                });
                expect(result.name).equal('4');

                await t.case('can stat directories along the path', async () => {
                    let stat = await t.stat('1');
                    expect(stat.name).equal('1');

                    stat = await t.stat('1/2');
                    expect(stat.name).equal('2');

                    stat = await t.stat('1/2/3');
                    expect(stat.name).equal('3');

                    stat = await t.stat('1/2/3/4');
                    expect(stat.name).equal('4');
                });
            });
        });
    }
};