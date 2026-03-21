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
const { v4: uuidv4 } = require('uuid');
const BaseService = require('../BaseService');
const { DB_WRITE } = require('../database/consts');

const STATUS_PREPARED = 'prepared';
const STATUS_UPLOADING = 'uploading';
const STATUS_COMPLETING = 'completing';
const STATUS_COMPLETED = 'completed';
const STATUS_ABORTED = 'aborted';
const STATUS_EXPIRED = 'expired';
const STATUS_FAILED = 'failed';

class UploadSessionService extends BaseService {
    static STATUS_PREPARED = STATUS_PREPARED;
    static STATUS_UPLOADING = STATUS_UPLOADING;
    static STATUS_COMPLETING = STATUS_COMPLETING;
    static STATUS_COMPLETED = STATUS_COMPLETED;
    static STATUS_ABORTED = STATUS_ABORTED;
    static STATUS_EXPIRED = STATUS_EXPIRED;
    static STATUS_FAILED = STATUS_FAILED;

    async _init () {
        this.db = await this.services.get('database').get(DB_WRITE, 'upload-session');
    }

    #nowSeconds () {
        return Math.floor(Date.now() / 1000);
    }

    #ttlSeconds () {
        return this.global_config.signed_uploads?.session_ttl_seconds ?? 60 * 60;
    }

    #normalizeSessionRow (row) {
        if ( ! row ) return null;
        let metadata = {};
        try {
            metadata = row.metadata_json ? JSON.parse(row.metadata_json) : {};
        } catch (e) {
            metadata = {};
        }

        return {
            ...row,
            metadata,
        };
    }

    async getByUid (uid) {
        const [row] = await this.db.read(
            'SELECT * FROM `upload_sessions` WHERE `uid` = ? LIMIT 1',
            [uid],
        );
        return this.#normalizeSessionRow(row);
    }

    async getByUidForUser ({ uid, userId }) {
        const [row] = await this.db.read(
            'SELECT * FROM `upload_sessions` WHERE `uid` = ? AND `user_id` = ? LIMIT 1',
            [uid, userId],
        );
        return this.#normalizeSessionRow(row);
    }

    async createSession (sessionInput) {
        const now = this.#nowSeconds();
        const uid = sessionInput.uid ?? uuidv4();
        const expiresAt =
            sessionInput.expiresAt ??
            (now + (sessionInput.ttlSeconds ?? this.#ttlSeconds()));

        await this.db.write(
            'INSERT INTO `upload_sessions` ' +
            '(`uid`, `user_id`, `app_id`, `parent_uid`, `parent_path`, ' +
            '`target_name`, `target_path`, `overwrite_target_uid`, ' +
            '`content_type`, `size`, `checksum_sha256`, `upload_mode`, ' +
            '`multipart_upload_id`, `multipart_part_size`, `multipart_part_count`, ' +
            '`storage_provider`, `bucket`, `bucket_region`, `staging_key`, ' +
            '`status`, `failure_reason`, `metadata_json`, `created_at`, ' +
            '`updated_at`, `expires_at`, `consumed_at`, `completed_at`) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                uid,
                sessionInput.userId,
                sessionInput.appId ?? null,
                sessionInput.parentUid,
                sessionInput.parentPath,
                sessionInput.targetName,
                sessionInput.targetPath,
                sessionInput.overwriteTargetUid ?? null,
                sessionInput.contentType,
                sessionInput.size,
                sessionInput.checksumSha256 ?? null,
                sessionInput.uploadMode,
                sessionInput.multipartUploadId ?? null,
                sessionInput.multipartPartSize ?? null,
                sessionInput.multipartPartCount ?? null,
                sessionInput.storageProvider,
                sessionInput.bucket ?? null,
                sessionInput.bucketRegion ?? null,
                sessionInput.stagingKey,
                sessionInput.status ?? STATUS_PREPARED,
                null,
                JSON.stringify(sessionInput.metadata ?? {}),
                now,
                now,
                expiresAt,
                null,
                null,
            ],
        );

        return await this.getByUid(uid);
    }

    async updateMetadata ({ uid, userId, metadata }) {
        const now = this.#nowSeconds();
        const result = await this.db.write(
            'UPDATE `upload_sessions` SET `metadata_json` = ?, `updated_at` = ? ' +
            'WHERE `uid` = ? AND `user_id` = ?',
            [JSON.stringify(metadata ?? {}), now, uid, userId],
        );
        return Boolean(result?.anyRowsAffected);
    }

    async markUploading ({ uid, userId }) {
        const now = this.#nowSeconds();
        const result = await this.db.write(
            'UPDATE `upload_sessions` SET `status` = ?, `updated_at` = ? ' +
            'WHERE `uid` = ? AND `user_id` = ? AND `status` IN (?, ?)',
            [STATUS_UPLOADING, now, uid, userId, STATUS_PREPARED, STATUS_UPLOADING],
        );
        return Boolean(result?.anyRowsAffected);
    }

    async consumeForComplete ({ uid, userId }) {
        const now = this.#nowSeconds();
        const result = await this.db.write(
            'UPDATE `upload_sessions` ' +
            'SET `status` = ?, `consumed_at` = ?, `updated_at` = ? ' +
            'WHERE `uid` = ? AND `user_id` = ? ' +
            'AND `status` IN (?, ?) ' +
            'AND `expires_at` > ?',
            [
                STATUS_COMPLETING,
                now,
                now,
                uid,
                userId,
                STATUS_PREPARED,
                STATUS_UPLOADING,
                now,
            ],
        );
        return Boolean(result?.anyRowsAffected);
    }

    async markCompleted ({ uid, userId, metadata }) {
        const now = this.#nowSeconds();
        const result = await this.db.write(
            'UPDATE `upload_sessions` ' +
            'SET `status` = ?, `metadata_json` = ?, `completed_at` = ?, `updated_at` = ? ' +
            'WHERE `uid` = ? AND `user_id` = ? AND `status` = ?',
            [
                STATUS_COMPLETED,
                JSON.stringify(metadata ?? {}),
                now,
                now,
                uid,
                userId,
                STATUS_COMPLETING,
            ],
        );
        return Boolean(result?.anyRowsAffected);
    }

    async markFailed ({ uid, userId, reason }) {
        const now = this.#nowSeconds();
        const result = await this.db.write(
            'UPDATE `upload_sessions` ' +
            'SET `status` = ?, `failure_reason` = ?, `updated_at` = ? ' +
            'WHERE `uid` = ? AND `user_id` = ? AND `status` != ?',
            [STATUS_FAILED, reason ?? null, now, uid, userId, STATUS_COMPLETED],
        );
        return Boolean(result?.anyRowsAffected);
    }

    async markAborted ({ uid, userId, reason }) {
        const now = this.#nowSeconds();
        const result = await this.db.write(
            'UPDATE `upload_sessions` ' +
            'SET `status` = ?, `failure_reason` = ?, `updated_at` = ? ' +
            'WHERE `uid` = ? AND `user_id` = ? AND `status` IN (?, ?, ?)',
            [
                STATUS_ABORTED,
                reason ?? null,
                now,
                uid,
                userId,
                STATUS_PREPARED,
                STATUS_UPLOADING,
                STATUS_COMPLETING,
            ],
        );
        return Boolean(result?.anyRowsAffected);
    }

    async markExpiredPendingSessions ({ limit = 500 } = {}) {
        const now = this.#nowSeconds();
        const rows = await this.db.read(
            'SELECT * FROM `upload_sessions` ' +
            'WHERE `status` IN (?, ?, ?) AND `expires_at` <= ? ' +
            'ORDER BY `expires_at` ASC LIMIT ?',
            [
                STATUS_PREPARED,
                STATUS_UPLOADING,
                STATUS_COMPLETING,
                now,
                limit,
            ],
        );

        if ( rows.length === 0 ) {
            return [];
        }
        const candidates = rows.map(row => this.#normalizeSessionRow(row));

        for ( const candidate of candidates ) {
            await this.db.write(
                'UPDATE `upload_sessions` SET `status` = ?, `updated_at` = ? ' +
                'WHERE `uid` = ? AND `status` IN (?, ?, ?) AND `expires_at` <= ?',
                [
                    STATUS_EXPIRED,
                    now,
                    candidate.uid,
                    STATUS_PREPARED,
                    STATUS_UPLOADING,
                    STATUS_COMPLETING,
                    now,
                ],
            );
        }

        return candidates;
    }
}

module.exports = {
    UploadSessionService,
    uploadSessionStatuses: {
        STATUS_PREPARED,
        STATUS_UPLOADING,
        STATUS_COMPLETING,
        STATUS_COMPLETED,
        STATUS_ABORTED,
        STATUS_EXPIRED,
        STATUS_FAILED,
    },
};
