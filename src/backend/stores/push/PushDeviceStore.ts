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

import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { HttpError } from '../../core/http/HttpError.js';
import { PuterStore } from '../types';

export type PushPlatform = 'web' | 'ios' | 'android';

/** A registered device as its owner sees it. Timestamps are unix seconds. */
export interface PushDevice {
    uid: string;
    userId: number;
    sessionUid: string | null;
    platform: PushPlatform;
    /** Null when Puter registered the device itself. */
    appUid: string | null;
    userAgent: string | null;
    label: string | null;
    createdAt: number;
    lastSeenAt: number;
    failureCount: number;
}

/** A device plus the provider address a push is sent to. */
export interface PushDeliveryTarget extends PushDevice {
    token: string;
}

export interface PushDeviceRegistration {
    userId: number;
    sessionUid: string;
    platform: PushPlatform;
    token: string;
    appUid?: string | null;
    userAgent?: string | null;
    label?: string | null;
}

export const PUSH_DEVICE_USER_AGENT_MAX_LENGTH = 512;
export const PUSH_DEVICE_LABEL_MAX_LENGTH = 64;
const MAX_LIMIT = 1000;

const COLUMN_NAMES = [
    'uid',
    'user_id',
    'session_uid',
    'platform',
    'app_uid',
    'user_agent',
    'label',
    'created_at',
    'last_seen_at',
    'failure_count',
];
const DEVICE_COLUMNS = COLUMN_NAMES.map((c) => `\`${c}\``).join(', ');
const PREFIXED_DEVICE_COLUMNS = COLUMN_NAMES.map((c) => `d.\`${c}\``).join(
    ', ',
);

/** Columns a repeat registration overwrites, in bind order. */
const REFRESHED_COLUMNS = [
    'user_id',
    'session_uid',
    'platform',
    'app_uid',
    'user_agent',
    'label',
    'last_seen_at',
    'failure_count',
];

/** How a provider address is looked up; the address itself is never a key. */
export const hashPushToken = (token: string): string =>
    createHash('sha256').update(token, 'utf8').digest('hex');

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const bounded = (
    value: string | null | undefined,
    max: number,
): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.slice(0, max) : null;
};

const safeLimit = (limit: number | undefined, fallback: number): number => {
    const n = Math.floor(Number(limit ?? fallback));
    return Number.isFinite(n) ? Math.min(Math.max(0, n), MAX_LIMIT) : fallback;
};

const placeholders = (values: readonly unknown[]): string =>
    values.map(() => '?').join(', ');

const unique = (values: readonly string[]): string[] => [
    ...new Set(values.filter((value) => typeof value === 'string' && !!value)),
];

const toDevice = (row: Record<string, unknown>): PushDevice => ({
    uid: String(row.uid),
    userId: Number(row.user_id),
    sessionUid: (row.session_uid as string | null) ?? null,
    platform: row.platform as PushPlatform,
    appUid: (row.app_uid as string | null) ?? null,
    userAgent: (row.user_agent as string | null) ?? null,
    label: (row.label as string | null) ?? null,
    createdAt: Number(row.created_at),
    lastSeenAt: Number(row.last_seen_at),
    failureCount: Number(row.failure_count),
});

/** `token_hash` is unique, so each provider address has exactly one owner. */
export class PushDeviceStore extends PuterStore {
    // -- Reads --------------------------------------------------------

    async getByUid(uid: string): Promise<PushDevice | null> {
        if (!uid) return null;
        const rows = await this.clients.db.read(
            `SELECT ${DEVICE_COLUMNS} FROM \`push_device\` WHERE \`uid\` = ? LIMIT 1`,
            [uid],
        );
        return rows[0] ? toDevice(rows[0]) : null;
    }

    /** A user's devices, newest first. */
    async listByUser(
        userId: number,
        { limit }: { limit?: number } = {},
    ): Promise<PushDevice[]> {
        const n = safeLimit(limit, 100);
        if (n === 0) return [];
        const rows = await this.clients.db.pread(
            `SELECT ${DEVICE_COLUMNS} FROM \`push_device\` WHERE \`user_id\` = ? ` +
                'ORDER BY `id` DESC LIMIT ?',
            [userId, n],
        );
        return rows.map(toDevice);
    }

    /** Puter's and `appUid`'s devices whose session, if any, is active. */
    async listForDelivery(
        userId: number,
        appUid: string | null,
        { limit }: { limit?: number } = {},
    ): Promise<PushDeliveryTarget[]> {
        const n = safeLimit(limit, 100);
        if (n === 0) return [];
        const appClause = appUid ? ' OR d.`app_uid` = ?' : '';
        const params: unknown[] = [userId];
        if (appUid) params.push(appUid);
        params.push(nowSeconds(), n);
        const rows = await this.clients.db.pread(
            `SELECT ${PREFIXED_DEVICE_COLUMNS}, d.\`token\` ` +
                'FROM `push_device` d LEFT JOIN `sessions` s ' +
                'ON s.`uuid` = d.`session_uid` AND s.`user_id` = d.`user_id` ' +
                `WHERE d.\`user_id\` = ? AND (d.\`app_uid\` IS NULL${appClause}) ` +
                'AND (d.`session_uid` IS NULL OR (s.`uuid` IS NOT NULL ' +
                'AND s.`revoked_at` IS NULL ' +
                'AND (s.`expires_at` IS NULL OR s.`expires_at` > ?))) ' +
                'ORDER BY d.`id` DESC LIMIT ?',
            params,
        );
        return rows.map((row) => ({
            ...toDevice(row),
            token: String(row.token),
        }));
    }

    // -- Writes -------------------------------------------------------

    /** A token changing owner gets a new uid; 409 if it keeps changing. */
    async register(registration: PushDeviceRegistration): Promise<PushDevice> {
        for (let attempt = 0; attempt < 2; attempt++) {
            const device = await this.#upsert(registration);
            if (device.userId === registration.userId) return device;
        }
        throw new HttpError(409, 'This device is registered to another user', {
            legacyCode: 'push_device_conflict',
        });
    }

    async #upsert({
        userId,
        sessionUid,
        platform,
        token,
        appUid = null,
        userAgent = null,
        label = null,
    }: PushDeviceRegistration): Promise<PushDevice> {
        const db = this.clients.db;
        const tokenHash = hashPushToken(token);
        const now = nowSeconds();
        const uid = uuidv4();
        const refreshed = [
            userId,
            sessionUid,
            platform,
            appUid || null,
            bounded(userAgent, PUSH_DEVICE_USER_AGENT_MAX_LENGTH),
            bounded(label, PUSH_DEVICE_LABEL_MAX_LENGTH),
            now,
            0,
        ];
        // Before `user_id`: mysql assigns left to right.
        const sets = [
            '`uid` = CASE WHEN `push_device`.`user_id` = ? THEN `push_device`.`uid` ELSE ? END',
            '`created_at` = CASE WHEN `push_device`.`user_id` = ? ' +
                'THEN `push_device`.`created_at` ELSE ? END',
            ...REFRESHED_COLUMNS.map((c) => `\`${c}\` = ?`),
        ].join(', ');
        const conflict = db.case({
            mysql: `ON DUPLICATE KEY UPDATE ${sets}`,
            otherwise: `ON CONFLICT(\`token_hash\`) DO UPDATE SET ${sets}`,
        });
        await db.write(
            'INSERT INTO `push_device` (`uid`, `token`, `token_hash`, ' +
                `\`created_at\`, ${REFRESHED_COLUMNS.map((c) => `\`${c}\``).join(', ')}) ` +
                `VALUES (?, ?, ?, ?, ${placeholders(refreshed)}) ${conflict}`,
            [
                uid,
                token,
                tokenHash,
                now,
                ...refreshed,
                userId,
                uid,
                userId,
                now,
                ...refreshed,
            ],
        );
        const rows = await db.pread(
            `SELECT ${DEVICE_COLUMNS} FROM \`push_device\` WHERE \`token_hash\` = ? LIMIT 1`,
            [tokenHash],
        );
        if (!rows[0]) throw new Error('push device missing after register');
        return toDevice(rows[0]);
    }

    /** False when `userId` has no device `uid`. */
    async removeByUid(userId: number, uid: string): Promise<boolean> {
        const result = await this.clients.db.write(
            'DELETE FROM `push_device` WHERE `uid` = ? AND `user_id` = ?',
            [uid, userId],
        );
        return result.anyRowsAffected;
    }

    /** Remove devices by provider address, whoever owns them. */
    async removeByTokenHashes(tokenHashes: string[]): Promise<number> {
        const hashes = unique(tokenHashes);
        if (hashes.length === 0) return 0;
        const result = await this.clients.db.write(
            `DELETE FROM \`push_device\` WHERE \`token_hash\` IN (${placeholders(hashes)})`,
            hashes,
        );
        return result.affectedRows;
    }

    async removeBySessions(
        userId: number,
        sessionUids: string[],
    ): Promise<number> {
        const sessions = unique(sessionUids);
        if (sessions.length === 0) return 0;
        const result = await this.clients.db.write(
            'DELETE FROM `push_device` WHERE `user_id` = ? AND ' +
                `\`session_uid\` IN (${placeholders(sessions)})`,
            [userId, ...sessions],
        );
        return result.affectedRows;
    }

    async touch(userId: number, uids: string[]): Promise<void> {
        const list = unique(uids);
        if (list.length === 0) return;
        await this.clients.db.write(
            'UPDATE `push_device` SET `last_seen_at` = ? WHERE `user_id` = ? ' +
                `AND \`uid\` IN (${placeholders(list)})`,
            [nowSeconds(), userId, ...list],
        );
    }

    async recordFailure(userId: number, uids: string[]): Promise<void> {
        const list = unique(uids);
        if (list.length === 0) return;
        await this.clients.db.write(
            'UPDATE `push_device` SET `failure_count` = `failure_count` + 1 ' +
                `WHERE \`user_id\` = ? AND \`uid\` IN (${placeholders(list)})`,
            [userId, ...list],
        );
    }

    /** `cutoff` is unix seconds; a full batch means more may remain. */
    async removeUnseenSince(
        cutoff: number,
        { limit }: { limit?: number } = {},
    ): Promise<number> {
        const n = safeLimit(limit, 500);
        if (n === 0 || !Number.isFinite(cutoff)) return 0;
        // Only mysql takes a LIMIT on DELETE, so the others bound it by id.
        const statement = this.clients.db.case({
            mysql:
                'DELETE FROM `push_device` WHERE `last_seen_at` < ? ' +
                'ORDER BY `last_seen_at` LIMIT ?',
            otherwise:
                'DELETE FROM `push_device` WHERE `id` IN (' +
                'SELECT `id` FROM `push_device` WHERE `last_seen_at` < ? ' +
                'ORDER BY `last_seen_at` LIMIT ?)',
        });
        const result = await this.clients.db.write(statement, [
            Math.floor(cutoff),
            n,
        ]);
        return result.affectedRows;
    }
}
