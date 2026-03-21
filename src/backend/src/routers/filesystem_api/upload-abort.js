/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
'use strict';

const eggspress = require('../../api/eggspress.js');
const APIError = require('../../api/APIError.js');
const config = require('../../config.js');
const { uploadSessionStatuses } = require('../../services/uploadSession/UploadSessionService.js');

module.exports = eggspress('/upload/abort', {
    subdomain: 'api',
    verified: true,
    auth2: true,
    fs: true,
    json: true,
    allowedMethods: ['POST'],
}, async (req, res) => {
    const signedConfig = config.signed_uploads ?? {};
    if ( ! signedConfig.enabled ) {
        throw APIError.create('signed_uploads_not_supported', null, {
            reason: 'disabled',
        });
    }

    const sessionUid = req.body.session_uid;
    if ( ! sessionUid ) {
        throw APIError.create('field_missing', null, { key: 'session_uid' });
    }

    const uploadSession = req.services.get('upload-session');
    const session = await uploadSession.getByUidForUser({
        uid: sessionUid,
        userId: req.user.id,
    });
    if ( ! session ) {
        throw APIError.create('upload_session_not_found');
    }

    if ( session.status === uploadSessionStatuses.STATUS_COMPLETED ) {
        return res.send({
            ok: true,
            alreadyCompleted: true,
        });
    }

    const fs = req.services.get('filesystem');
    const parent = await fs.node({ uid: session.parent_uid });
    const storageController = parent.provider.storageController;
    if ( ! storageController ) {
        await uploadSession.markAborted({
            uid: sessionUid,
            userId: req.user.id,
            reason: req.body.reason ?? 'aborted_by_client',
        });
        return res.send({ ok: true });
    }

    if ( session.upload_mode === 'multipart' && session.multipart_upload_id ) {
        try {
            await storageController.abortMultipartUpload({
                storage_meta: {
                    bucket: session.bucket,
                    bucket_region: session.bucket_region,
                },
                key: session.staging_key,
                uploadId: session.multipart_upload_id,
            });
        } catch (e) {
            req.services.get('log-service').create('upload-abort')
                .warn('failed to abort multipart upload', {
                    sessionUid,
                    reason: e?.message ?? String(e),
                });
        }
    }

    try {
        await storageController.deleteObject({
            storage_meta: {
                bucket: session.bucket,
                bucket_region: session.bucket_region,
            },
            key: session.staging_key,
        });
    } catch (e) {
        req.services.get('log-service').create('upload-abort')
            .warn('failed to delete staging object', {
                sessionUid,
                reason: e?.message ?? String(e),
            });
    }

    await uploadSession.markAborted({
        uid: sessionUid,
        userId: req.user.id,
        reason: req.body.reason ?? 'aborted_by_client',
    });

    return res.send({ ok: true });
});
