import { suite } from '../harness/types.ts';

const home = (t: { env: { users: { user: { username: string } } } }) =>
    `/${t.env.users.user.username}`;

export default suite('fs', {
    'write creates a file and read returns its content': async (t) => {
        const path = `${home(t)}/fs-suite-roundtrip.txt`;
        await t.puter.fs.write(path, 'hello from the suite');
        const blob = await t.puter.fs.read(path);
        t.assert.equal(await blob.text(), 'hello from the suite');
    },

    'stat reports name and type': async (t) => {
        const path = `${home(t)}/fs-suite-stat.txt`;
        await t.puter.fs.write(path, 'stat me');
        const info = await t.puter.fs.stat(path);
        t.assert.equal(info.name, 'fs-suite-stat.txt');
        t.assert.equal(Boolean(info.is_dir), false);
    },

    'mkdir creates a directory listable via readdir': async (t) => {
        const dir = `${home(t)}/fs-suite-dir`;
        await t.puter.fs.mkdir(dir);
        await t.puter.fs.write(`${dir}/inside.txt`, 'x');
        const entries = await t.puter.fs.readdir(dir);
        t.assert.equal(entries.length, 1);
        t.assert.equal(entries[0].name, 'inside.txt');
    },

    'delete removes a file': async (t) => {
        const path = `${home(t)}/fs-suite-delete.txt`;
        await t.puter.fs.write(path, 'ephemeral');
        await t.puter.fs.delete(path);
        await t.assert.rejects(
            () => t.puter.fs.stat(path),
            'stat of a deleted file should reject',
        );
    },

    'users cannot read files outside their home': async (t) => {
        await t.assert.rejects(
            () => t.puter.fs.readdir(`/${t.env.users.admin.username}`),
            "reading another user's home should reject",
        );
    },
});
