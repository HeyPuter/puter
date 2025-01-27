const { expect } = require("chai");
const fs = require('fs');

module.exports = {
    name: 'move',
    do: async t => {
        // setup conditions for tests
        await t.mkdir('dir_with_contents');
        await t.write('dir_with_contents/a.txt', 'move test\n');
        await t.write('dir_with_contents/b.txt', 'move test\n');
        await t.write('dir_with_contents/c.txt', 'move test\n');
        await t.mkdir('dir_with_contents/q');
        await t.mkdir('dir_with_contents/w');
        await t.mkdir('dir_with_contents/e');
        await t.mkdir('dir_no_contents');
        await t.write('just_a_file.txt', 'move test\n');

        await t.case('move file', async () => {
            await t.move('just_a_file.txt', 'just_a_file_moved.txt');
            const moved = await t.stat('just_a_file_moved.txt');
            let threw = false;
            try {
                await t.stat('just_a_file.txt');
            } catch (e) {
                expect(e.response.status).equal(404);
                threw = true;
            }
            expect(threw).true;
            expect(moved.name).equal('just_a_file_moved.txt');
        });

        await t.case('move file to existing file', async () => {
            await t.write('just_a_file.txt', 'move test\n');
            let threw = false;
            try {
                await t.move('just_a_file.txt', 'dir_with_contents/a.txt');
            } catch (e) {
                expect(e.response.status).equal(409);
                threw = true;
            }
            expect(threw).true;
        });

        /*
        await t.case('move file to existing directory', async () => {
            await t.move('just_a_file.txt', 'dir_with_contents');
            const moved = await t.stat('dir_with_contents/just_a_file.txt');
            let threw = false;
            try {
                await t.stat('just_a_file.txt');
            } catch (e) {
                expect(e.response.status).equal(404);
                threw = true;
            }
            expect(threw).true;
            expect(moved.name).equal('just_a_file.txt');
        });
        */

        await t.case('move directory', async () => {
            await t.move('dir_no_contents', 'dir_no_contents_moved');
            const moved = await t.stat('dir_no_contents_moved');
            let threw = false;
            try {
                await t.stat('dir_no_contents');
            } catch (e) {
                expect(e.response.status).equal(404);
                threw = true;
            }
            expect(threw).true;
            expect(moved.name).equal('dir_no_contents_moved');
        });

        await t.case('move file and create parents', async () => {
            await t.write('just_a_file.txt', 'move test\n', { overwrite: true });
            const res = await t.move(
                'just_a_file.txt',
                'dir_with_contents/q/w/e/just_a_file.txt',
                { create_missing_parents: true }
            );
            expect(res.parent_dirs_created).length(2);
            const moved = await t.stat('dir_with_contents/q/w/e/just_a_file.txt');
            let threw = false;
            try {
                await t.stat('just_a_file.txt');
            } catch (e) {
                expect(e.response.status).equal(404);
                threw = true;
            }
            expect(threw).true;
            expect(moved.name).equal('just_a_file.txt');
        });
    }
};
