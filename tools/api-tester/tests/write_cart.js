const { default: axios } = require("axios");
const write = require("../coverage_models/write");
const TestFactory = require("../lib/TestFactory");

const chai = require('chai');
chai.use(require('chai-as-promised'))
const expect = chai.expect;

module.exports = TestFactory.cartesian('Cartesian Test for /write', write, {
    each: async (t, state, i) => {
        if ( state['conditions.destinationIsFile'] ) {
            await t.write('write_cart_' + i, 'placeholder\n');
        } else {
            await t.mkdir('write_cart_' + i);
        }

        const dir = `/${t.cwd}/write_cart_` + i;
        const dirUID = (await t.stat('write_cart_' + i)).uid;

        const contents = new Blob(
            [`case ${i}\n`],
            { type: 'text/plain' },
        );

        console.log('DIR UID', dirUID)

        const fd = new FormData();

        if ( state.name === 'specified' ) {
            fd.append('name', 'specified_name.txt');
        }
        if ( state.overwrite ) {
            fd.append(state.overwrite, true);
        }

        fd.append('path', state.format === 'path' ? dir : dirUID);
        fd.append('size', contents.size),
        fd.append('file', contents, 'uploaded_name.txt');

        let e = null;

        let resp;
        try {
            resp = await axios.request({
                method: 'post',
                httpsAgent: t.httpsAgent,
                url: t.getURL('write'),
                data: fd,
                headers: {
                    ...t.headers_,
                    'Content-Type': 'multipart/form-data'
                }
            })
        } catch (e_) {
            e = e_;
        }

        let error_expected = null;

        // Error conditions
        if (
            state['conditions.destinationIsFile'] &&
            state.name === 'specified'
        ) {
            error_expected = {
                code: 'dest_is_not_a_directory',
                message: `Destination must be a directory.`,
            };
        }

        if (
            state['conditions.destinationIsFile'] &&
            state.name === 'default' &&
            ! state.overwrite
        ) {
            error_expected = {
                code: 'item_with_same_name_exists',
                message: 'An item with name `write_cart_'+i+'` already exists.',
                entry_name: 'write_cart_' + i,
            };
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
