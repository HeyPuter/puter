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
const { valid_file_size } = require('../../util/validutil.js');
const { uploadSessionStatuses } = require('../../services/uploadSession/UploadSessionService.js');

module.exports = eggspress('/upload/multipart/sign-part', {
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
    const partNumber = Number(req.body.part_number);
    const { v: contentLength, ok: contentLengthOk } =
        valid_file_size(req.body.content_length ?? 0);

    if ( ! sessionUid ) {
        throw APIError.create('field_missing', null, { key: 'session_uid' });
    }
    if ( !Number.isInteger(partNumber) || partNumber < 1 ) {
        throw APIError.create('field_invalid', null, {
            key: 'part_number',
            expected: 'positive integer',
        });
    }
    if ( ! contentLengthOk ) {
        throw APIError.create('field_invalid', null, {
            key: 'content_length',
            expected: 'non-negative integer',
        });
    }

    const uploadSession = req.services.get('upload-session');
    const session = await uploadSession.getByUidForUser({
        uid: sessionUid,
        userId: req.user.id,
    });
    if ( ! session ) {
        throw APIError.create('upload_session_not_found');
    }
    if ( session.expires_at <= Math.floor(Date.now() / 1000) ) {
        throw APIError.create('upload_session_expired');
    }
    if ( session.upload_mode !== 'multipart' ) {
        throw APIError.create('field_invalid', null, {
            key: 'session_uid',
            expected: 'multipart session',
        });
    }
    if ( ! [
        uploadSessionStatuses.STATUS_PREPARED,
        uploadSessionStatuses.STATUS_UPLOADING,
    ].includes(session.status) ) {
        throw APIError.create('upload_session_invalid_state', null, {
            state: session.status,
        });
    }
    if (
        session.multipart_part_count &&
        partNumber > session.multipart_part_count
    ) {
        throw APIError.create('field_invalid', null, {
            key: 'part_number',
            expected: `value <= ${session.multipart_part_count}`,
        });
    }

    const fs = req.services.get('filesystem');
    const parent = await fs.node({ uid: session.parent_uid });
    const storageController = parent.provider.storageController;
    if ( ! storageController ) {
        throw APIError.create('signed_uploads_not_supported', null, {
            reason: 'missing storage controller',
        });
    }

    const expiresInSeconds = signedConfig.url_expiry_seconds ?? 15 * 60;
    const signedPart = await storageController.signMultipartUploadPart({
        storage_meta: {
            bucket: session.bucket,
            bucket_region: session.bucket_region,
        },
        key: session.staging_key,
        uploadId: session.multipart_upload_id,
        partNumber: partNumber,
        contentLength: contentLength,
        expiresInSeconds,
    });

    await uploadSession.markUploading({
        uid: sessionUid,
        userId: req.user.id,
    });

    return res.send({
        session_uid: sessionUid,
        part_number: partNumber,
        upload: signedPart,
    });
});
