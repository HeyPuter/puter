const chai = require('chai');
chai.use(require('chai-as-promised'))
const expect = chai.expect;

module.exports = {
    name: 'write intensive 1',
    description: 'create 100 new directories and write 10 files in each, then check integrity by stat/readdir/read api',
    do: async t => {
        console.log('write intensive 1');

        const dir_count = 100;
        const file_count = 10;

        for ( let i=0 ; i < dir_count ; i++ ) {
            await t.mkdir(`dir_${i}`);
            for ( let j=0 ; j < file_count ; j++ ) {
                const content = `example ${i} ${j}`;
                await t.write(`dir_${i}/file_${j}.txt`, content, { overwrite: true });
            }
        }

        for ( let i=0 ; i < dir_count ; i++ ) {
            const dir = await t.stat(`dir_${i}`);
            const files = await t.readdir(dir.path);
            expect(files.length).equal(file_count);
            for ( let j=0 ; j < file_count ; j++ ) {
                const content = await t.read(`dir_${i}/file_${j}.txt`);
                expect(content).equal(`example ${i} ${j}`);
            }
        }
    }
};