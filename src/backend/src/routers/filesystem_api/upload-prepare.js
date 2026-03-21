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

const path_ = require('path');
const { v4: uuidv4 } = require('uuid');
const eggspress = require('../../api/eggspress.js');
const APIError = require('../../api/APIError.js');
const config = require('../../config.js');
const { get_app, validate_fsentry_name } = require('../../helpers.js');
const { is_valid_node_name } = require('../../filesystem/validation.js');
const { boolify } = require('../../util/hl_types.js');
const { valid_file_size } = require('../../util/validutil.js');
const { TYPE_DIRECTORY } = require('../../filesystem/FSNodeContext.js');

const CONTENT_TYPE_MAX_LENGTH = 255;
const MAX_THUMBNAIL_SIZE = 2 * 1024 * 1024;
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

const getBucketForRequest = ({ existingNode }) => {
    if ( existingNode?.entry?.bucket && existingNode?.entry?.bucket_region ) {
        return {
            bucket: existingNode.entry.bucket,
            bucketRegion: existingNode.entry.bucket_region,
        };
    }

    return {
        bucket: config.s3_bucket,
        bucketRegion: config.s3_region ?? config.region,
    };
};

module.exports = eggspress('/upload/prepare', {
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

    const parentPath = req.body.parent_path;
    const requestedName = req.body.name;
    const contentType = req.body.content_type;
    const checksumSha256 = req.body.checksum_sha256;
    const thumbnail = req.body.thumbnail;

    if ( ! parentPath ) {
        throw APIError.create('field_missing', null, { key: 'parent_path' });
    }
    if ( ! requestedName ) {
        throw APIError.create('field_missing', null, { key: 'name' });
    }
    if ( !contentType || typeof contentType !== 'string' ) {
        throw APIError.create('field_invalid', null, {
            key: 'content_type',
            expected: 'non-empty string',
        });
    }
    if ( contentType.length > CONTENT_TYPE_MAX_LENGTH ) {
        throw APIError.create('field_too_long', null, {
            key: 'content_type',
            max_length: CONTENT_TYPE_MAX_LENGTH,
        });
    }
    const normalizedChecksumSha256 = normalizeSha256ToBase64(checksumSha256);
    if ( checksumSha256 && !normalizedChecksumSha256 ) {
        throw APIError.create('field_invalid', null, {
            key: 'checksum_sha256',
            expected: '64-char hex or base64 sha256 digest',
        });
    }
    if ( thumbnail !== undefined ) {
        if ( typeof thumbnail !== 'string' ) {
            throw APIError.create('field_invalid', null, {
                key: 'thumbnail',
                expected: 'base64 data-url string',
            });
        }
        const commaIndex = thumbnail.indexOf(',');
        const base64 = commaIndex === -1 ? thumbnail : thumbnail.slice(commaIndex + 1);
        const estimatedSize = Math.ceil(base64.length * 3 / 4);
        if ( estimatedSize > MAX_THUMBNAIL_SIZE ) {
            throw APIError.create('thumbnail_too_large', null, {
                max_size: MAX_THUMBNAIL_SIZE,
            });
        }
    }

    const { v: size, ok: sizeOk } = valid_file_size(req.body.size);
    if ( ! sizeOk ) {
        throw APIError.create('invalid_file_metadata');
    }

    const fs = req.services.get('filesystem');
    const acl = req.services.get('acl');
    const sizeService = req.services.get('sizeService');
    const uploadSession = req.services.get('upload-session');
    let appId = null;
    if ( req.body.app_uid ) {
        const app = await get_app({ uid: req.body.app_uid });
        appId = app?.id ?? null;
    }

    const parent = await fs.node(parentPath);
    if ( ! await parent.exists() ) {
        throw APIError.create('dest_does_not_exist', null, {
            what_dest: parentPath,
        });
    }
    if ( await parent.get('type') !== TYPE_DIRECTORY ) {
        throw APIError.create('dest_is_not_a_directory');
    }
    if ( parent.isRoot ) {
        throw APIError.create('cannot_write_to_root');
    }

    if ( ! await acl.check(req.actor, parent, 'write') ) {
        throw await acl.get_safe_acl_error(req.actor, parent, 'write');
    }

    try {
        validate_fsentry_name(requestedName);
        if ( ! is_valid_node_name(requestedName) ) {
            throw new Error('invalid node name');
        }
    } catch (e) {
        throw APIError.create('invalid_file_name', null, {
            name: requestedName,
            reason: e.message,
        });
    }

    const usage = await sizeService.get_usage(req.user.id);
    const capacity = await sizeService.get_storage_capacity(req.user.id);
    if ( capacity - usage - size < 0 ) {
        throw APIError.create('storage_limit_reached');
    }

    const overwrite = await boolify(req.body.overwrite);
    const dedupeName = await boolify(req.body.dedupe_name ?? req.body.dedupeName);
    const requestedMode = req.body.upload_mode;
    if ( requestedMode && !['single', 'multipart'].includes(requestedMode) ) {
        throw APIError.create('disallowed_value', null, {
            key: 'upload_mode',
            allowed: ['single', 'multipart'],
        });
    }

    let targetName = requestedName;
    let overwriteTargetUid = null;
    let overwriteNode = null;
    const destination = await parent.getChild(targetName);
    if ( await destination.exists() ) {
        if ( dedupeName ) {
            const ext = path_.extname(targetName);
            const nameWithoutExt = path_.basename(targetName, ext);
            for ( let i = 1; ; i++ ) {
                const tryName = `${nameWithoutExt} (${i})${ext}`;
                if ( ! await parent.hasChild(tryName) ) {
                    targetName = tryName;
                    break;
                }
            }
        } else if ( overwrite ) {
            if ( await destination.get('immutable') ) {
                throw APIError.create('immutable');
            }
            if ( await destination.get('type') === TYPE_DIRECTORY ) {
                throw APIError.create('cannot_overwrite_a_directory');
            }
            overwriteTargetUid = await destination.get('uid');
            overwriteNode = destination;
        } else {
            throw APIError.create('item_with_same_name_exists', null, {
                entry_name: targetName,
            });
        }
    }

    const provider = parent.provider;
    const storageController = provider.storageController;
    if ( typeof provider.finalizeSignedUpload !== 'function' ) {
        throw APIError.create('signed_uploads_not_supported', null, {
            reason: 'filesystem provider cannot finalize signed uploads',
        });
    }
    const capabilities = provider.getSignedUploadCapabilities?.() ??
        storageController?.getUploadCapabilities?.() ?? {
        signedUploads: false,
        multipart: false,
        reason: 'unsupported',
    };

    if ( !capabilities.signedUploads || !storageController ) {
        throw APIError.create('signed_uploads_not_supported', null, {
            reason: capabilities.reason ?? 'unsupported storage backend',
        });
    }

    const multipartThreshold =
        signedConfig.multipart_threshold_bytes ?? 64 * 1024 * 1024;
    const uploadMode = requestedMode ??
        ((size >= multipartThreshold && capabilities.multipart)
            ? 'multipart'
            : 'single');
    if ( uploadMode === 'multipart' && !capabilities.multipart ) {
        throw APIError.create('signed_uploads_not_supported', null, {
            reason: 'multipart unsupported',
        });
    }

    const { bucket, bucketRegion } = getBucketForRequest({ existingNode: overwriteNode });
    if ( !bucket || !bucketRegion ) {
        throw APIError.create('signed_uploads_not_supported', null, {
            reason: 'missing bucket configuration',
        });
    }

    const partSize =
        signedConfig.multipart_part_size_bytes ?? 8 * 1024 * 1024;
    const partCount = uploadMode === 'multipart'
        ? Math.max(1, Math.ceil(size / partSize))
        : null;
    if ( partCount && partCount > (capabilities.maxMultipartParts ?? 10000) ) {
        throw APIError.create('field_invalid', null, {
            key: 'size',
            expected: 'file small enough for multipart policy',
        });
    }

    const sessionUid = uuidv4();
    const stagingKey = `upload-session/${req.user.id}/${sessionUid}`;
    const targetPath = path_.join(await parent.get('path'), targetName);
    const expiresInSeconds = signedConfig.url_expiry_seconds ?? 15 * 60;

    let multipartUploadId = null;
    let uploadInstructions = null;

    try {
        if ( uploadMode === 'multipart' ) {
            const multipartState = await storageController.createMultipartUpload({
                storage_meta: {
                    bucket: bucket,
                    bucket_region: bucketRegion,
                },
                key: stagingKey,
                contentType,
            });
            multipartUploadId = multipartState.uploadId;
        }

        await uploadSession.createSession({
            uid: sessionUid,
            userId: req.user.id,
            appId,
            parentUid: await parent.get('uid'),
            parentPath: await parent.get('path'),
            targetName: targetName,
            targetPath: targetPath,
            overwriteTargetUid: overwriteTargetUid,
            contentType: contentType,
            size: size,
            checksumSha256: normalizedChecksumSha256 ?? null,
            uploadMode: uploadMode,
            multipartUploadId: multipartUploadId,
            multipartPartSize: uploadMode === 'multipart' ? partSize : null,
            multipartPartCount: partCount,
            storageProvider: storageController.constructor?.name ?? 'unknown',
            bucket: bucket,
            bucketRegion: bucketRegion,
            stagingKey: stagingKey,
            metadata: {
                originalClientSocketId: req.body.original_client_socket_id ?? null,
                operationId: req.body.operation_id ?? null,
                appUid: req.body.app_uid ?? null,
                ...(thumbnail !== undefined ? { thumbnail } : {}),
            },
        });

        if ( uploadMode === 'single' ) {
            uploadInstructions = await storageController.createSignedUpload({
                storage_meta: {
                    bucket: bucket,
                    bucket_region: bucketRegion,
                },
                key: stagingKey,
                contentType,
                size,
                checksumSha256: normalizedChecksumSha256 ?? undefined,
                expiresInSeconds,
            });
        }
    } catch (e) {
        if ( multipartUploadId ) {
            try {
                await storageController.abortMultipartUpload({
                    storage_meta: {
                        bucket: bucket,
                        bucket_region: bucketRegion,
                    },
                    key: stagingKey,
                    uploadId: multipartUploadId,
                });
            } catch ( abortErr ) {
                req.services.get('log-service').create('upload-prepare')
                    .warn('failed to abort multipart upload after prepare failure', {
                        sessionUid,
                        reason: abortErr?.message ?? String(abortErr),
                    });
            }
        }
        throw e;
    }

    return res.send({
        session_uid: sessionUid,
        upload_mode: uploadMode,
        expires_in_seconds: expiresInSeconds,
        target: {
            name: targetName,
            path: targetPath,
            overwrite: Boolean(overwriteTargetUid),
        },
        upload: uploadMode === 'single'
            ? uploadInstructions
            : {
                upload_id: multipartUploadId,
                part_size: partSize,
                part_count: partCount,
            },
    });
});
