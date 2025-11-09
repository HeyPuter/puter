const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;

module.exports = {
    name: 'stat intensive 1',
    description: 'create 10 directories and 100 subdirectories in each, then stat them over and over',
    do: async t => {
        console.log('stat intensive 1');

        const dir_count = 10;
        const subdir_count = 10;

        // key: uuid
        // value: path
        const dirs = {};

        for ( let i = 0; i < dir_count; i++ ) {
            await t.mkdir(`dir_${i}`);
            for ( let j = 0; j < subdir_count; j++ ) {
                const subdir = await t.mkdir(`dir_${i}/subdir_${j}`);
                dirs[subdir.uid] = subdir.path;
            }
        }

        const start = Date.now();
        for ( let i = 0; i < 10; i++ ) {
            for ( const [uuid, path] of Object.entries(dirs) ) {
                const stat = await t.stat_uuid(uuid);
                expect(stat.is_dir).equal(true);
                expect(stat.path).equal(path);
            }
        }
        const duration = Date.now() - start;
        return { duration };
    },
};