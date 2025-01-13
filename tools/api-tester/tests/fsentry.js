const { expect } = require("chai");

const _bitBooleans = [
    'immutable',
    'is_shortcut',
    'is_symlink',
    'is_dir',
];

const _integers = [
    'created',
    'accessed',
    'modified',
];

const _strings = [
    'id', 'uid', 'parent_id', 'name',
]

const verify_fsentry = async (t, o) => {
    await t.case('fsentry is valid', async () => {
        for ( const k of _strings ) {
            await t.case(`${k} is a string`, () => {
                expect(typeof o[k]).equal('string');
            });
        }
        if ( o.is_dir ) {
            await t.case(`type is null for directories`, () => {
                expect(o.type).equal(null);
            });
        }
        if ( ! o.is_dir ) {
            await t.case(`type is a string for files`, () => {
                expect(typeof o.type).equal('string');
            });
        }
        await t.case('id === uid', () => {
            expect(o.id).equal(o.uid);
        });
        await t.case('uid is string', () => {
            expect(typeof o.uid).equal('string');
        });
        for ( const k of _bitBooleans ) {
            if ( k === 'is_dir' ) {
                await t.case(`is_dir is true or false`, () => {
                    expect(o[k]).oneOf([true, false], `${k} should be true or false`);
                });
                continue;
            }
            await t.case(`${k} is 0 or 1`, () => {
                expect(o[k]).oneOf([0, 1], `${k} should be 0 or 1`);
            });
        }
        t.quirk('is_shared is not populated currently');
        // expect(o.is_shared).oneOf([true, false]);
        for ( const k of _integers ) {
            if ( o.is_dir && k === 'accessed' ) {
                t.quirk('accessed is null for new directories');
                continue;
            }

            await t.case(`${k} is numeric type`, () => {
                expect(typeof o[k]).equal('number');
            });
            await t.case(`${k} has no fractional component`, () => {
                expect(Number.isInteger(o[k])).true;
            });
        }
        await t.case('symlink_path is null or string', () => {
            expect(
                o.symlink_path === null ||
                typeof o.symlink_path === 'string'
            ).true;
        });
        await t.case('owner object has expected properties', () => {
            expect(o.owner).to.haveOwnProperty('username');
            expect(o.owner).to.haveOwnProperty('email');
        });
    })
}

module.exports = {
    verify_fsentry,
};