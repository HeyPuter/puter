/* global require, module, Buffer */
const axios = require('axios');
const { expect } = require('chai');

module.exports = {
    name: 'signed upload api',
    do: async t => {
        const parentPath = t.default_cwd;
        const capabilities = await t.uploadCapabilities(parentPath);

        await t.case('upload capabilities response shape', async () => {
            expect(capabilities).to.be.an('object');
            expect(capabilities).to.have.property('supported');
            expect(capabilities).to.have.property('signedUploads');
            expect(capabilities).to.have.property('multipart');
        });

        if ( ! capabilities.supported ) {
            await t.case('prepare rejects when signed uploads are unsupported', async () => {
                let threw = false;
                try {
                    await t.uploadPrepare({
                        parent_path: parentPath,
                        name: 'signed-unsupported.txt',
                        content_type: 'text/plain',
                        size: 5,
                    });
                } catch (e) {
                    threw = true;
                    expect(e.response?.status).to.equal(422);
                    expect(e.response?.data?.code).to.equal('signed_uploads_not_supported');
                }
                expect(threw).to.equal(true);
            });
            return;
        }

        await t.case('single-part signed upload prepare/upload/complete succeeds', async () => {
            const fileName = `signed-upload-${Date.now()}.txt`;
            const content = `signed upload api test ${Date.now()}\n`;

            const prepared = await t.uploadPrepare({
                parent_path: parentPath,
                name: fileName,
                content_type: 'text/plain',
                size: Buffer.byteLength(content),
            });

            expect(prepared.upload_mode).to.equal('single');
            expect(prepared).to.have.property('session_uid');
            expect(prepared.upload?.url).to.be.a('string');

            await axios.request({
                method: prepared.upload.method ?? 'PUT',
                url: prepared.upload.url,
                data: content,
                headers: {
                    ...(prepared.upload.headers ?? {}),
                },
                validateStatus: status => status >= 200 && status < 300,
            });

            const completed = await t.uploadComplete({
                session_uid: prepared.session_uid,
            });

            expect(completed.path).to.equal(t.resolve(fileName));
            const readBack = await t.read(fileName);
            expect(readBack).to.equal(content);
        });

        await t.case('complete cannot be replayed for consumed session', async () => {
            const fileName = `signed-replay-${Date.now()}.txt`;
            const content = 'replay-test-content\n';
            const prepared = await t.uploadPrepare({
                parent_path: parentPath,
                name: fileName,
                content_type: 'text/plain',
                size: Buffer.byteLength(content),
            });

            await axios.request({
                method: prepared.upload.method ?? 'PUT',
                url: prepared.upload.url,
                data: content,
                headers: {
                    ...(prepared.upload.headers ?? {}),
                },
                validateStatus: status => status >= 200 && status < 300,
            });

            await t.uploadComplete({
                session_uid: prepared.session_uid,
            });

            let threw = false;
            try {
                await t.uploadComplete({
                    session_uid: prepared.session_uid,
                });
            } catch (e) {
                threw = true;
                expect(e.response?.status).to.equal(409);
                expect(e.response?.data?.code).to.equal('upload_session_consumed');
            }
            expect(threw).to.equal(true);
        });

        await t.case('abort transitions session away from completable state', async () => {
            const prepared = await t.uploadPrepare({
                parent_path: parentPath,
                name: `signed-abort-${Date.now()}.txt`,
                content_type: 'text/plain',
                size: 6,
            });

            const aborted = await t.uploadAbort(prepared.session_uid, 'api_test_abort');
            expect(aborted.ok).to.equal(true);

            let threw = false;
            try {
                await t.uploadComplete({
                    session_uid: prepared.session_uid,
                });
            } catch (e) {
                threw = true;
                expect(e.response?.status).to.equal(409);
                expect(e.response?.data?.code).to.equal('upload_session_invalid_state');
            }
            expect(threw).to.equal(true);
        });
    },
};
