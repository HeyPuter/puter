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
const { asyncSafeSetInterval } = require('@heyputer/putility').libs.promise;
const BaseService = require('../BaseService');

class UploadSessionCleanupService extends BaseService {
    async _init () {
        const signedConfig = this.global_config.signed_uploads ?? {};
        if ( ! signedConfig.enabled ) {
            return;
        }

        const intervalMs = (signedConfig.cleanup_interval_seconds ?? 5 * 60) * 1000;
        asyncSafeSetInterval(async () => {
            await this.cleanupExpiredSessions();
        }, intervalMs);
    }

    async cleanupExpiredSessions () {
        const signedConfig = this.global_config.signed_uploads ?? {};
        if ( ! signedConfig.enabled ) {
            return;
        }

        const uploadSession = this.services.get('upload-session');
        const fs = this.services.get('filesystem');
        const expiredSessions = await uploadSession.markExpiredPendingSessions({
            limit: signedConfig.cleanup_batch_size ?? 500,
        });

        for ( const session of expiredSessions ) {
            try {
                const parent = await fs.node({ uid: session.parent_uid });
                const storageController = parent.provider.storageController;
                if ( ! storageController ) {
                    continue;
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
                        this.log.warn('failed to abort multipart upload during cleanup', {
                            sessionUid: session.uid,
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
                    this.log.warn('failed to delete stale upload object during cleanup', {
                        sessionUid: session.uid,
                        reason: e?.message ?? String(e),
                    });
                }
            } catch (e) {
                this.log.warn('failed to cleanup expired upload session', {
                    sessionUid: session.uid,
                    reason: e?.message ?? String(e),
                });
            }
        }
    }
}

module.exports = {
    UploadSessionCleanupService,
};
