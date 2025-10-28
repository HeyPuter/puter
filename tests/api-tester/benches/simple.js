const log_error = require("../lib/log_error");

module.exports = registry => {
    registry.add_bench('write.tiny', {
        name: 'write 30 tiny files',
        do: async t => {
            for ( let i=0 ; i < 30 ; i++ ) {
                await t.write(`tiny_${i}.txt`, 'example\n', { overwrite: true });
            }
        }
    });

    registry.add_bench('batch.mkdir-and-write', {
        name: 'make directories and write',
        do: async t => {
            const batch = [];
            for ( let i=0 ; i < 30 ; i++ ) {
                batch.push({
                    op: 'mkdir',
                    path: t.resolve(`dir_${i}`),
                });
                batch.push({
                    op: 'write',
                    path: t.resolve(`tiny_${i}.txt`),
                });
            }
            await t.batch('batch', batch, Array(30).fill('example\n'));
        }
    });

    registry.add_bench('batch.mkdir-deps.1', {
        name: 'make directories and write',
        do: async t => {
            const batch = [];
            const blobs = [];
            for ( let j=0 ; j < 3 ; j++ ) {
                batch.push({
                    op: 'mkdir',
                    path: t.resolve('dir_root'),
                    as: 'root',
                })
                for ( let i=0 ; i < 10 ; i++ ) {
                    batch.push({
                        op: 'write',
                        path: `$root/test_${i}.txt`
                    });
                    blobs.push('example\n');
                }
            }
            await t.batch('batch', batch, blobs);
        }
    });

    // TODO: write explicit test for multiple directories with the same name
    // in a batch so that batch can eventually resolve this situation and not
    // do something incredibly silly.
    registry.add_bench('batch.mkdir-deps.2', {
        name: 'make directories and write',
        do: async t => {
            const batch = [];
            const blobs = [];
            for ( let j=0 ; j < 3 ; j++ ) {
                batch.push({
                    op: 'mkdir',
                    path: t.resolve(`dir_${j}`),
                    as: `dir_${j}`,
                })
                for ( let k=0 ; k < 3 ; k++ ) {
                    batch.push({
                        op: 'mkdir',
                        parent: `$dir_${j}`,
                        path: `subdir_${k}`,
                        as: `subdir_${j}-${k}`,
                    })

                    for ( let i=0 ; i < 5 ; i++ ) {
                        batch.push({
                            op: 'write',
                            path: `$subdir_${j}-${k}/test_${i}.txt`
                        });
                        blobs.push('example\n');
                    }
                }
            }
            try {
                const response = await t.batch('batch', batch, blobs);
                console.log('response?', response);
            } catch (e) {
                log_error(e);
            }
        }
    });

    registry.add_bench('write.batch.tiny', {
        name: 'Write 30 tiny files in a batch',
        do: async t => {
            const batch = [];
            for ( let i=0 ; i < 30 ; i++ ) {
                batch.push({
                    op: 'write',
                    path: t.resolve(`tiny_${i}.txt`),
                });
            }
            await t.batch('batch', batch, Array(30).fill('example\n'));
        }
    });

    // const fiftyMB = Array(50 * 1024 * 1024).map(() =>
    //     String.fromCharCode(
    //         Math.floor(Math.random() * 26) + 97
    //     ));

    // registry.add_bench('files.mb50', {
    //     name: 'write 10 50MB files',
    //     do: async t => {
    //         for ( let i=0 ; i < 10 ; i++ ) {
    //             await t.write(`mb50_${i}.txt`, 'example\n', { overwrite: true });
    //         }
    //     }
    // });
};