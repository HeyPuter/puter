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

import { Readable } from 'node:stream';
import { makeActor } from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import { isUniqueViolation } from '../../util/dbError.js';
import { actorHasSubscription } from '../metering/enforcement.js';
import { PuterService } from '../types.js';

export const PROFILES_SUBDOMAIN = 'puter-profiles';
export const PROFILES_PATH_PREFIX = '/system/profiles';
const PROFILE_FILE_SUFFIX = '.profile';

export const PROFILE_FIELDS = ['picture', 'displayName', 'bio'] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

/** Every field present; `null` where the user has set nothing. */
export type UserProfile = Record<ProfileField, string | null>;
/** Fields to change; `null` clears one, an absent field is left alone. */
export type UserProfilePatch = Partial<UserProfile>;

/** Length of the picture data URL as sent; the file is little else. */
export const PROFILE_PICTURE_MAX_BYTES = 512 * 1024;
export const PROFILE_DISPLAY_NAME_MAX_LENGTH = 64;
export const PROFILE_BIO_MAX_LENGTH = 280;

const PICTURE_DATA_URL = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+={0,2}$/i;
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ProfileOwner = Pick<UserRow, 'id' | 'uuid' | 'username' | 'suspended'>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const profileFileName = (userUuid: string) =>
    `${userUuid}${PROFILE_FILE_SUFFIX}`;
const profilePath = (userUuid: string) =>
    `${PROFILES_PATH_PREFIX}/${profileFileName(userUuid)}`;

const emptyProfile = (): UserProfile => ({
    picture: null,
    displayName: null,
    bio: null,
});

// New surface, no legacy clients: the structured code rides in `code`.
const invalid = (field: ProfileField, message: string, code: string) =>
    new HttpError(400, message, { code, fields: { field } });

/**
 * One field's accepted value, or a thrown `HttpError` saying why not. Text is
 * trimmed, and trimming to nothing clears the field like `null` does.
 */
const validateField = (field: ProfileField, value: unknown): string | null => {
    if (value === null) return null;
    if (typeof value !== 'string') {
        throw invalid(
            field,
            `${field} must be a string or null`,
            'profile_field_invalid',
        );
    }
    if (field === 'picture') {
        if (!PICTURE_DATA_URL.test(value)) {
            throw invalid(
                field,
                'picture must be a base64 image data URL',
                'profile_picture_invalid',
            );
        }
        if (Buffer.byteLength(value) > PROFILE_PICTURE_MAX_BYTES) {
            throw new HttpError(413, 'picture is too large', {
                code: 'profile_picture_too_large',
                fields: { field, maxBytes: PROFILE_PICTURE_MAX_BYTES },
            });
        }
        return value;
    }
    const maxLength =
        field === 'displayName'
            ? PROFILE_DISPLAY_NAME_MAX_LENGTH
            : PROFILE_BIO_MAX_LENGTH;
    const trimmed = value.trim();
    if (trimmed.length > maxLength) {
        throw new HttpError(400, `${field} is too long`, {
            code: 'profile_field_too_long',
            fields: { field, maxLength },
        });
    }
    return trimmed === '' ? null : trimmed;
};

/**
 * User profiles: one JSON file per account, `<user uuid>.profile`, in an
 * admin-owned directory that a system subdomain serves. Users hold no
 * filesystem grant on that directory; this service writes on their behalf and
 * decides what a file may contain.
 *
 * A profile is public — readable by anyone through the API and the hosted file
 * — only while its owner is on a paid plan. The owner always reads and writes
 * their own. The hosted half is enforced on `site.access.check`, which the
 * hosting middleware asks before streaming any file of that site.
 */
export class ProfileService extends PuterService {
    #ownerUserId: number | null = null;
    #dirReady: Promise<void> | null = null;

    override async onServerStart(): Promise<void> {
        // Retried from `#ownerId` on the first write if this fails at boot.
        this.#dirReady = this.ensureProfilesDirectory().catch((e) => {
            console.warn('[profile] profiles directory setup failed', e);
        });

        this.clients.event.on('site.access.check', async (_key, data) => {
            if (data.subdomain !== PROFILES_SUBDOMAIN) return;
            data.result.allowed = await this.#hostedFileIsPublic(
                data.entry.name,
            );
        });
    }

    /** Where a profile is served from, or null with no hosting domain. */
    getPublicUrl(user: Pick<UserRow, 'uuid'>): string | null {
        const host =
            this.config.static_hosting_domain ??
            this.config.static_hosting_domain_alt;
        if (!host) return null;
        const protocol = this.config.protocol ?? 'https';
        const port = this.config.pub_port;
        const portSuffix =
            port && port !== 80 && port !== 443 ? `:${port}` : '';
        return `${protocol}://${PROFILES_SUBDOMAIN}.${host}${portSuffix}/${profileFileName(user.uuid)}`;
    }

    /** The profile as stored, with every field present. */
    async getProfile(user: Pick<UserRow, 'uuid'>): Promise<UserProfile> {
        return this.#normalize(await this.#readStored(user.uuid));
    }

    /**
     * Apply `patch` to the user's profile and return the result. Rejects a
     * patch with an unknown field or an invalid value before writing anything.
     */
    async updateProfile(
        user: Pick<UserRow, 'id' | 'uuid'>,
        patch: unknown,
    ): Promise<UserProfile> {
        const changes = this.validatePatch(patch);
        const current = (await this.#readStored(user.uuid)) ?? {};
        const next: Record<string, string> = {};
        for (const field of PROFILE_FIELDS) {
            const value =
                field in changes ? changes[field] : (current[field] ?? null);
            if (typeof value === 'string') next[field] = value;
        }
        await this.#writeStored(user.uuid, next);
        return this.#normalize(next);
    }

    /** Validate a patch without applying it. */
    validatePatch(patch: unknown): UserProfilePatch {
        if (!isPlainObject(patch)) {
            throw new HttpError(400, 'Expected an object of profile fields', {
                code: 'profile_patch_invalid',
            });
        }
        const changes: UserProfilePatch = {};
        for (const [key, value] of Object.entries(patch)) {
            if (!(PROFILE_FIELDS as readonly string[]).includes(key)) {
                throw new HttpError(400, `Unknown profile field: ${key}`, {
                    code: 'profile_field_not_allowed',
                    fields: { field: key },
                });
            }
            const field = key as ProfileField;
            changes[field] = validateField(field, value);
        }
        return changes;
    }

    /**
     * The accepted part of a profile written by something other than this
     * service (the old per-user `.profile` file): fields that validate are
     * kept, everything else is named in `dropped`.
     */
    normalizeLegacyProfile(data: unknown): {
        patch: UserProfilePatch;
        dropped: string[];
    } {
        const patch: UserProfilePatch = {};
        const dropped: string[] = [];
        if (!isPlainObject(data)) return { patch, dropped };
        for (const [key, value] of Object.entries(data)) {
            if (!(PROFILE_FIELDS as readonly string[]).includes(key)) {
                dropped.push(key);
                continue;
            }
            const field = key as ProfileField;
            try {
                const accepted = validateField(field, value);
                if (accepted !== null) patch[field] = accepted;
            } catch {
                dropped.push(key);
            }
        }
        return { patch, dropped };
    }

    /**
     * Whether anyone other than the owner may read this profile: the owner is
     * on a paid plan, or the deployment doesn't gate on plans. A suspended
     * account's profile is never public.
     */
    async isPubliclyVisible(user: ProfileOwner): Promise<boolean> {
        if (user.suspended) return false;
        if (this.config.profileGate?.enabled === false) return true;
        return actorHasSubscription(
            this.services.metering,
            makeActor({
                user: { id: user.id, uuid: user.uuid, username: user.username },
            }),
            true,
            this.config,
        );
    }

    // -- Bootstrap ---------------------------------------------------

    /**
     * Ensure the admin-owned directory and the subdomain serving it exist.
     * Public so `DefaultUserService` can call it right after creating the admin
     * on first boot — this service is registered before it, so its own
     * `onServerStart` finds no admin yet. Idempotent.
     */
    async ensureProfilesDirectory(): Promise<void> {
        const adminUser = await this.stores.user.getByUsername('admin');
        if (!adminUser) {
            console.warn(
                '[profile] admin user not found; deferring profiles directory setup',
            );
            return;
        }
        this.#ownerUserId = adminUser.id;

        const dirEntry =
            (await this.stores.fsEntry.getEntryByPath(PROFILES_PATH_PREFIX)) ??
            (await this.stores.fsEntry.resolveParentDirectory(
                adminUser.id,
                PROFILES_PATH_PREFIX,
                true,
            ));
        if (!dirEntry) {
            console.warn('[profile] failed to ensure profiles directory');
            return;
        }

        // Same first-boot race as the app-icons site: the existence check can
        // pass twice, so the unique constraint is the arbiter.
        if (await this.stores.subdomain.existsBySubdomain(PROFILES_SUBDOMAIN)) {
            return;
        }
        try {
            await this.stores.subdomain.create({
                userId: adminUser.id,
                subdomain: PROFILES_SUBDOMAIN,
                rootDirId: dirEntry.id ?? null,
                isProtected: true,
            });
        } catch (e) {
            if (!isUniqueViolation(e)) throw e;
        }
    }

    // -- Storage -----------------------------------------------------

    async #ownerId(): Promise<number> {
        if (this.#dirReady) await this.#dirReady;
        if (this.#ownerUserId === null) {
            await this.ensureProfilesDirectory();
        }
        if (this.#ownerUserId === null) {
            throw new HttpError(503, 'Profiles are not available yet', {
                legacyCode: 'internal_error',
            });
        }
        return this.#ownerUserId;
    }

    async #readStored(
        userUuid: string,
    ): Promise<Record<string, unknown> | null> {
        const entry = await this.stores.fsEntry.getEntryByPath(
            profilePath(userUuid),
        );
        if (!entry || entry.isDir) return null;
        const { body } = await this.services.fs.readContent(entry);
        const chunks: Buffer[] = [];
        for await (const chunk of body) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        try {
            const parsed: unknown = JSON.parse(
                Buffer.concat(chunks).toString('utf8'),
            );
            return isPlainObject(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }

    async #writeStored(
        userUuid: string,
        profile: Record<string, string>,
    ): Promise<void> {
        const ownerId = await this.#ownerId();
        const buffer = Buffer.from(JSON.stringify(profile), 'utf8');
        await this.services.fs.write(ownerId, {
            fileMetadata: {
                path: profilePath(userUuid),
                size: buffer.length,
                contentType: 'application/json',
                overwrite: true,
                createMissingParents: true,
            },
            fileContent: Readable.from(buffer),
        });
    }

    #normalize(stored: Record<string, unknown> | null): UserProfile {
        const profile = emptyProfile();
        if (!stored) return profile;
        for (const field of PROFILE_FIELDS) {
            const value = stored[field];
            if (typeof value === 'string' && value !== '') {
                profile[field] = value;
            }
        }
        return profile;
    }

    /** Whether the hosted file `name` under the profiles site may be served. */
    async #hostedFileIsPublic(name: string): Promise<boolean> {
        if (!name.endsWith(PROFILE_FILE_SUFFIX)) return false;
        const userUuid = name.slice(0, -PROFILE_FILE_SUFFIX.length);
        if (!UUID_PATTERN.test(userUuid)) return false;
        const user = await this.stores.user.getByUuid(userUuid);
        if (!user) return false;
        return this.isPubliclyVisible(user);
    }
}
