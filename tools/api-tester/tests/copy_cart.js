const { default: axios } = require("axios");
const { expect } = require("chai");
const copy = require("../coverage_models/copy");
const TestFactory = require("../lib/TestFactory");

/*
    CARTESIAN TEST FOR /copy

    NOTE: This test is very similar to the test for /move,
          but DRYing it would add too much complexity.

          It is best to have both tests open side-by-side
          when making changes to either one.
*/

const PREFIX = 'copy_cart_';

module.exports = TestFactory.cartesian('Cartesian Test for /copy', copy, {
    each: async (t, state, i) => {
        // 1. Common setup for all states
        await t.mkdir(`${PREFIX}${i}`);
        const dir = `/${t.cwd}/${PREFIX}${i}`;

        await t.mkdir(`${PREFIX}${i}/a`);

        let pathOfThingToCopy = '';
        
        if ( state.subject === 'file' ) {
            await t.write(`${PREFIX}${i}/a/a_file.txt`, 'file a contents\n');
            pathOfThingToCopy = `/a/a_file.txt`;
        } else {
            await t.mkdir(`${PREFIX}${i}/a/a_directory`);
            pathOfThingToCopy = `/a/a_directory`;

            // for test purposes, a "full" directory has each of three classes:
            // - a file
            // - an empty directory
            // - a directory with a file in it
            if ( state.subject === 'directory-full' ) {
                // add a file
                await t.write(`${PREFIX}${i}/a/a_directory/a_file.txt`, 'file a contents\n');

                // add a directory with a file inside of it
                await t.mkdir(`${PREFIX}${i}/a/a_directory/b_directory`);
                await t.write(`${PREFIX}${i}/a/a_directory/b_directory/b_file.txt`, 'file a contents\n');

                // add an empty directory
                await t.mkdir(`${PREFIX}${i}/a/a_directory/c_directory`);
            }
        }

        // 2. Situation setup for this state

        if ( state['conditions.destinationIsFile'] ) {
            await t.write(`${PREFIX}${i}/b`, 'placeholder\n');
        } else {
            await t.mkdir(`${PREFIX}${i}/b`);
            await t.write(`${PREFIX}${i}/b/b_file.txt`, 'file b contents\n');
        }

        const srcUID = (await t.stat(`${PREFIX}${i}${pathOfThingToCopy}`)).uid;
        const dstUID = (await t.stat(`${PREFIX}${i}/b`)).uid;

        // 3. Parameter setup for this state
        const data = {};
        data.source = state['source.format'] === 'uid'
            ? srcUID : `${dir}${pathOfThingToCopy}` ;
        data.destination = state['destination.format'] === 'uid'
            ? dstUID : `${dir}/b` ;

        if ( state.name === 'specified' ) {
            data.new_name = 'x_renamed';
        }

        if ( state.overwrite ) {
            data[state.overwrite] = true;
        }

        // 4. Request
        let e = null;
        let resp;
        try {
            resp = await axios.request({
                method: 'post',
                httpsAgent: t.httpsAgent,
                url: t.getURL('copy'),
                data,
                headers: {
                    ...t.headers_,
                    'Content-Type': 'application/json'
                }
            });
        } catch (e_) {
            e = e_;
        }

        // 5. Check Response
        let error_expected = null;

        if (
            state['conditions.destinationIsFile'] &&
            state.name === 'specified'
        ) {
            error_expected = {
                code: 'dest_is_not_a_directory',
                message: `Destination must be a directory.`,
            };
        }

        else if (
            state['conditions.destinationIsFile'] &&
            ! state.overwrite &&
            ! state.dedupe_name
        ) {
            console.log('AN ERROR IS EXPECTED');
            error_expected = {
                code: 'item_with_same_name_exists',
                message: 'An item with name `b` already exists.',
                entry_name: 'b',
            }
        }

        if ( error_expected ) {
            expect(e).to.exist;
            const data = e.response.data;
            expect(data).deep.equal(error_expected);
        } else {
            if ( e ) throw e;
        }
    }
})
