/**
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

import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../core/actor.js';
import { ACLService, type ResourceDescriptor } from './ACLService.js';

// -- Test scaffolding -------------------------------------------------

const ISSUER_USER = { uuid: 'u-issuer', id: 1, username: 'issuer' };

/** Plain user actor — the entity that mints (and bounds) access tokens. */
const issuerActor: Actor = { user: ISSUER_USER };

/** A user-issued full-access ("personal access token") actor. */
function fullAccessTokenActor(): Actor {
    return {
        user: ISSUER_USER,
        accessToken: {
            uid: 'tok-full',
            issuer: issuerActor,
            authorized: null,
            fullAccess: true,
        },
    };
}

/** A scoped (non-full-access) access-token actor issued by the same user. */
function scopedTokenActor(): Actor {
    return {
        user: ISSUER_USER,
        accessToken: {
            uid: 'tok-scoped',
            issuer: issuerActor,
            authorized: null,
            fullAccess: false,
        },
    };
}

/**
 * Build a ResourceDescriptor whose ancestor chain is derived from the path
 * (resource first, down to the direct child of root) with deterministic uids.
 */
function resource(path: string): ResourceDescriptor {
    const parts = path.slice(1).split('/');
    const ancestors = parts.map((_, i) => {
        const p = '/' + parts.slice(0, parts.length - i).join('/');
        return { uid: `uid:${p}`, path: p };
    });
    return { path, resolveAncestors: async () => ancestors };
}

function makeService() {
    const stores = {
        permission: {
            // Default: token carries no explicit fs grant rows.
            hasAccessTokenPerm: vi.fn().mockResolvedValue(false),
        },
        user: {
            getByUsername: vi.fn().mockResolvedValue(null),
        },
    };
    const services = {
        permission: {
            // Default: issuer holds no scanned (shared/granted) permission.
            scan: vi.fn().mockResolvedValue([]),
        },
    };
    const config = { enable_public_folders: false };
    const args = [config, {}, stores, services] as unknown as
        ConstructorParameters<typeof ACLService>;
    const service = new ACLService(...args);
    return { service, stores, services };
}

// -- Full-access tokens ----------------------------------------------

describe('ACLService.check — full-access tokens', () => {
    it('grants write to the issuing user\'s own home dir', async () => {
        const { service, stores, services } = makeService();

        const allowed = await service.check(
            fullAccessTokenActor(),
            resource('/issuer/projects'),
            'write',
        );

        expect(allowed).toBe(true);
        // The grant comes from the fullAccess short-circuit (bounded by the
        // issuer check), NOT from per-token permission rows or a scan.
        expect(stores.permission.hasAccessTokenPerm).not.toHaveBeenCalled();
        expect(services.permission.scan).not.toHaveBeenCalled();
    });

    it('denies a path the issuing user cannot reach (no leak)', async () => {
        const { service } = makeService();

        // Another user's home: issuer has no home short-circuit and no
        // scanned permission (scan defaults to []), so the issuer check at
        // the top of the access-token branch fails and the token is denied.
        const allowed = await service.check(
            fullAccessTokenActor(),
            resource('/victim/secrets'),
            'write',
        );

        expect(allowed).toBe(false);
    });

    it('inherits a path explicitly shared with the issuing user', async () => {
        const { service, services } = makeService();
        // Issuer holds a scanned grant on the shared resource.
        services.permission.scan.mockResolvedValue([{ $: 'option', key: 'k' }]);

        const allowed = await service.check(
            fullAccessTokenActor(),
            resource('/other/Shared'),
            'write',
        );

        expect(allowed).toBe(true);
    });

    it('cannot exceed the issuer: denied even with a token perm row when the issuer lacks access', async () => {
        const { service, stores } = makeService();
        // Even if the token row claims the grant, the issuer gate runs first.
        stores.permission.hasAccessTokenPerm.mockResolvedValue(true);

        const allowed = await service.check(
            fullAccessTokenActor(),
            resource('/victim/secrets'),
            'write',
        );

        expect(allowed).toBe(false);
    });
});

// -- Scoped tokens are unaffected by the full-access change ------------

describe('ACLService.check — scoped tokens (regression)', () => {
    it('denies the issuer\'s own home without an explicit token grant', async () => {
        const { service, stores } = makeService();

        // Issuer passes its own home short-circuit, but a scoped token must
        // still carry an explicit fs permission row — it does not inherit
        // the owner short-circuit the way a full-access token does.
        const allowed = await service.check(
            scopedTokenActor(),
            resource('/issuer/projects'),
            'write',
        );

        expect(allowed).toBe(false);
        expect(stores.permission.hasAccessTokenPerm).toHaveBeenCalled();
    });

    it('grants when the token carries an explicit fs permission row', async () => {
        const { service, stores } = makeService();
        stores.permission.hasAccessTokenPerm.mockResolvedValue(true);

        const allowed = await service.check(
            scopedTokenActor(),
            resource('/issuer/projects'),
            'write',
        );

        expect(allowed).toBe(true);
    });
});
