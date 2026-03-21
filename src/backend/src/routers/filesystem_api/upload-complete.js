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
const { Context } = require('../../util/context.js');
const { uploadSessionStatuses } = require('../../services/uploadSession/UploadSessionService.js');

const HEX_SHA256_RE = /^[a-f0-9]{64}$/i;
const BASE64_SHA256_RE = /^[A-Za-z0-9+/]{43}=$/;

const normalizeSha256ToBase64 = value => {
    if ( !value || typeof value !== 'string' ) return null;
    if ( BASE64_SHA256_RE.test(value) ) return value;
    if ( HEX_SHA256_RE.test(value) ) {
        return Buffer.from(value, 'hex').toString('base64');
    }
    return null;
};

const normalizeParts = (parts) => {
    if ( !Array.isArray(parts) || parts.length === 0 ) {
        throw APIError.create('upload_multipart_parts_invalid');
    }

    const normalized = [];
    let previousPartNumber = 0;
    for ( const part of parts ) {
        const partNumber = Number(part?.part_number ?? part?.partNumber);
        let etag = part?.etag;
        if ( !Number.isInteger(partNumber) || partNumber < 1 ) {
            throw APIError.create('upload_multipart_parts_invalid');
        }
        if ( partNumber <= previousPartNumber ) {
            throw APIError.create('upload_multipart_parts_invalid');
        }
        if ( !etag || typeof etag !== 'string' ) {
            throw APIError.create('upload_multipart_parts_invalid');
        }
        if ( ! etag.startsWith('"') ) {
            etag = `"${etag}"`;
        }

        normalized.push({
            partNumber,
            etag,
        });
        previousPartNumber = partNumber;
    }

    return normalized;
};

module.exports = eggspress('/upload/complete', {
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
    let session = await uploadSession.getByUidForUser({
        uid: sessionUid,
        userId: req.user.id,
    });
    if ( ! session ) {
        throw APIError.create('upload_session_not_found');
    }
    if ( session.expires_at <= Math.floor(Date.now() / 1000) ) {
        throw APIError.create('upload_session_expired');
    }

    const consumed = await uploadSession.consumeForComplete({
        uid: sessionUid,
        userId: req.user.id,
    });
    if ( ! consumed ) {
        session = await uploadSession.getByUidForUser({
            uid: sessionUid,
            userId: req.user.id,
        });
        if ( ! session ) {
            throw APIError.create('upload_session_not_found');
        }
        if ( session.expires_at <= Math.floor(Date.now() / 1000) ) {
            throw APIError.create('upload_session_expired');
        }
        if ( [
            uploadSessionStatuses.STATUS_COMPLETED,
            uploadSessionStatuses.STATUS_COMPLETING,
        ].includes(session.status) ) {
            throw APIError.create('upload_session_consumed');
        }
        throw APIError.create('upload_session_invalid_state', null, {
            state: session.status,
        });
    }

    const fs = req.services.get('filesystem');
    const parent = await fs.node({ uid: session.parent_uid });
    const storageController = parent.provider.storageController;
    if ( ! storageController ) {
        await uploadSession.markFailed({
            uid: sessionUid,
            userId: req.user.id,
            reason: 'missing storage controller',
        });
        throw APIError.create('signed_uploads_not_supported', null, {
            reason: 'missing storage controller',
        });
    }
    if ( typeof parent.provider.finalizeSignedUpload !== 'function' ) {
        await uploadSession.markFailed({
            uid: sessionUid,
            userId: req.user.id,
            reason: 'provider cannot finalize signed uploads',
        });
        throw APIError.create('signed_uploads_not_supported', null, {
            reason: 'filesystem provider cannot finalize signed uploads',
        });
    }

    let frame;
    {
        const x = Context.get();
        const operationTraceSvc = x.get('services').get('operationTrace');
        frame = (await operationTraceSvc.add_frame('api:/upload/complete'))
            .attr('gui_metadata', {
                original_client_socket_id: req.body.original_client_socket_id,
                operation_id: req.body.operation_id,
                user_id: req.user.id,
            });
        x.set(operationTraceSvc.ckey('frame'), frame);
    }

    let multipartCompleted = false;
    try {
        if ( session.upload_mode === 'multipart' ) {
            const normalizedParts = normalizeParts(req.body.parts);
            await storageController.completeMultipartUpload({
                storage_meta: {
                    bucket: session.bucket,
                    bucket_region: session.bucket_region,
                },
                key: session.staging_key,
                uploadId: session.multipart_upload_id,
                parts: normalizedParts,
            });
            multipartCompleted = true;
        }

        const head = await storageController.headObject({
            storage_meta: {
                bucket: session.bucket,
                bucket_region: session.bucket_region,
            },
            key: session.staging_key,
        });

        if ( Number(head.size) !== Number(session.size) ) {
            throw APIError.create('upload_metadata_mismatch', null, {
                reason: `size expected ${session.size} but got ${head.size}`,
            });
        }
        if (
            head.contentType &&
            session.content_type &&
            head.contentType !== session.content_type
        ) {
            throw APIError.create('upload_metadata_mismatch', null, {
                reason: `content type expected ${session.content_type} but got ${head.contentType}`,
            });
        }
        if ( session.checksum_sha256 ) {
            const expectedChecksum = normalizeSha256ToBase64(session.checksum_sha256);
            if ( expectedChecksum && head.checksumSha256 !== expectedChecksum ) {
                throw APIError.create('upload_metadata_mismatch', null, {
                    reason: head.checksumSha256
                        ? 'sha256 checksum mismatch'
                        : 'sha256 checksum missing on uploaded object',
                });
            }
        }

        let overwriteNode = null;
        if ( session.overwrite_target_uid ) {
            overwriteNode = await fs.node({ uid: session.overwrite_target_uid });
            if ( ! await overwriteNode.exists() ) {
                throw APIError.create('upload_session_invalid_state', null, {
                    state: 'overwrite_target_missing',
                });
            }
        }

        const finalizedNode = await parent.provider.finalizeSignedUpload({
            context: Context.get(),
            parent,
            name: session.target_name,
            overwriteNode: overwriteNode,
            storageMeta: {
                bucket: session.bucket,
                bucketRegion: session.bucket_region,
                stagingKey: session.staging_key,
            },
            fileMeta: {
                size: Number(session.size),
                contentType: session.content_type,
            },
            appId: session.app_id,
            message: req.body.message ?? null,
            actor: req.actor,
            fsentryMetadata: {
                ...(session.metadata?.thumbnail !== undefined
                    ? { thumbnail: session.metadata.thumbnail }
                    : {}),
            },
        });

        const response = await finalizedNode.getSafeEntry({ thumbnail: true });
        await uploadSession.markCompleted({
            uid: sessionUid,
            userId: req.user.id,
            metadata: {
                ...session.metadata,
                finalUid: response.uid,
                finalPath: response.path,
            },
        });

        return res.send(response);
    } catch (e) {
        await uploadSession.markFailed({
            uid: sessionUid,
            userId: req.user.id,
            reason: e?.message ?? 'upload complete failed',
        });

        if ( session.upload_mode === 'multipart' && !multipartCompleted ) {
            try {
                await storageController.abortMultipartUpload({
                    storage_meta: {
                        bucket: session.bucket,
                        bucket_region: session.bucket_region,
                    },
                    key: session.staging_key,
                    uploadId: session.multipart_upload_id,
                });
            } catch ( abortErr ) {
                req.services.get('log-service').create('upload-complete')
                    .warn('failed to abort multipart upload after completion failure', {
                        sessionUid,
                        reason: abortErr?.message ?? String(abortErr),
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
        } catch ( deleteErr ) {
            req.services.get('log-service').create('upload-complete')
                .warn('failed to remove staging object after completion failure', {
                    sessionUid,
                    reason: deleteErr?.message ?? String(deleteErr),
                });
        }

        throw e instanceof APIError
            ? e
            : APIError.create('upload_failed');
    } finally {
        frame?.done?.();
    }
});
