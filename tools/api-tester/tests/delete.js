const { expect } = require("chai");
const sleep = require("../lib/sleep");

module.exports = {
    name: 'delete',
    do: async t => {
        await t.case('delete for normal file', async () => {
            await t.write('test_delete.txt', 'delete test\n', { overwrite: true });
            await t.delete('test_delete.txt');
            let threw = false;
            try {
                await t.stat('test_delete.txt');
            } catch (e) {
                expect(e.response.status).equal(404);
                threw = true;
            }
            expect(threw).true;
        });
        await t.case('error for non-existing file', async () => {
            let threw = false;
            try {
                await t.delete('test_delete.txt');
            } catch (e) {
                expect(e.response.status).equal(404);
                threw = true;
            }
            expect(threw).true;
        });
        await t.case('delete for directory', async () => {
            await t.mkdir('test_delete_dir', { overwrite: true });
            await t.delete('test_delete_dir');
            let threw = false;
            try {
                await t.stat('test_delete_dir');
            } catch (e) {
                expect(e.response.status).equal(404);
                threw = true;
            }
            expect(threw).true;
        });
        await t.case('delete for non-empty directory', async () => {
            await t.mkdir('test_delete_dir', { overwrite: true });
            await t.write('test_delete_dir/test.txt', 'delete test\n', { overwrite: true });
            let threw = false;
            try {
                await t.delete('test_delete_dir');
            } catch (e) {
                expect(e.response.status).equal(400);
                threw = true;
            }
            expect(threw).true;
        });
        await t.case('delete for non-empty directory with recursive=true', async () => {
            await t.mkdir('test_delete_dir', { overwrite: true });
            await t.write('test_delete_dir/test.txt', 'delete test\n', { overwrite: true });
            await t.delete('test_delete_dir', { recursive: true });
            let threw = false;
            await sleep(500);
            try {
                await t.stat('test_delete_dir');
            } catch (e) {
                expect(e.response.status).equal(404);
                threw = true;
            }
            expect(threw).true;
        });
        await t.case('non-empty deep recursion', async () => {
            await t.mkdir('del/a/b/c/d', {
                create_missing_parents: true,
            });
            await t.write('del/a/b/c/d/test.txt', 'delete test\n');
            await t.delete('del', {
                recursive: true,
                descendants_only: true,
            });
            let threw = false;
            t.quirk('delete too asynchronous');
            await new Promise(rslv => setTimeout(rslv, 500));
            try {
                await t.stat('del/a/b/c/d/test.txt');
            } catch (e) {
                expect(e.response.status).equal(404);
                threw = true;
            }
            expect(threw).true;
            threw = false;
            try {
                await t.stat('del/a');
            } catch (e) {
                expect(e.response.status).equal(404);
                threw = true;
            }
            expect(threw).true;
            await t.case('parent directory still exists', async () => {
                const stat = await t.stat('del');
                expect(stat.name).equal('del');
            });
        });
    }
};