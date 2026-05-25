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

import { describe, expect, it } from 'vitest';
import type { Actor } from '../../core/actor.js';
import type { AuthResult } from '../auth/AuthService.js';
import {
    buildSocketReauthError,
    decideSocketAuth,
    type SocketReauthError,
} from './SocketService.js';

// ── buildSocketReauthError ──────────────────────────────────────────

describe('buildSocketReauthError', () => {
    it('packs reason + auth_id into error.data matching the HTTP shape', () => {
        const err = buildSocketReauthError({
            reason: 'token_v1',
            auth_id: 'u-1',
        });
        expect(err.message).toBe('reauth_required');
        expect(err.data).toEqual({
            code: 'reauth_required',
            reason: 'token_v1',
            auth_id: 'u-1',
        });
    });

    it('omits auth_id when none was supplied', () => {
        const err = buildSocketReauthError({ reason: 'session_expired' });
        expect(err.data).toEqual({
            code: 'reauth_required',
            reason: 'session_expired',
        });
        expect(err.data.auth_id).toBeUndefined();
    });
});

// ── decideSocketAuth ────────────────────────────────────────────────

describe('decideSocketAuth', () => {
    const userActor: Actor = {
        user: { id: 1, uuid: 'u-1', username: 'u' },
    };
    const appActor: Actor = {
        user: { id: 1, uuid: 'u-1', username: 'u' },
        app: { uid: 'app-1', id: 2 },
    };
    const accessTokenActor: Actor = {
        user: { id: 1, uuid: 'u-1', username: 'u' },
        accessToken: {
            uid: 'tok-1',
            issuer: { user: { id: 1, uuid: 'u-1', username: 'u' } },
            authorized: null,
        },
    };

    it('accepts a plain user actor', () => {
        const decision = decideSocketAuth({ actor: userActor } as AuthResult);
        expect(decision).toEqual({ accept: userActor });
    });

    it('rejects with a structured reauth error when result carries reauth', () => {
        const decision = decideSocketAuth({
            reauth: { reason: 'session_revoked', auth_id: 'u-1' },
        } as AuthResult);
        if (!('reject' in decision)) throw new Error('expected reject');
        expect(decision.reject.message).toBe('reauth_required');
        expect((decision.reject as SocketReauthError).data).toEqual({
            code: 'reauth_required',
            reason: 'session_revoked',
            auth_id: 'u-1',
        });
    });

    it('rejects an app-under-user actor with a specific message', () => {
        const decision = decideSocketAuth({ actor: appActor } as AuthResult);
        if (!('reject' in decision)) throw new Error('expected reject');
        expect(decision.reject.message).toMatch(/only user tokens/);
        // Plain Error — no structured `data` payload.
        expect(
            (decision.reject as { data?: unknown }).data,
        ).toBeUndefined();
    });

    it('rejects an access-token actor with a specific message', () => {
        const decision = decideSocketAuth({
            actor: accessTokenActor,
        } as AuthResult);
        if (!('reject' in decision)) throw new Error('expected reject');
        expect(decision.reject.message).toMatch(/only user tokens/);
    });

    it('rejects when AuthService returned no actor at all', () => {
        const decision = decideSocketAuth({ invalid: true } as AuthResult);
        if (!('reject' in decision)) throw new Error('expected reject');
        expect(decision.reject.message).toBe('socket auth failed');
    });

    it('reauth wins over a usable actor (legacy v1 path)', () => {
        // Legacy v1 tokens may lazy-backfill a valid actor AND emit a
        // reauth signal — the socket must still reject so the client
        // migrates. Mirrors the HTTP gate's priority.
        const decision = decideSocketAuth({
            actor: userActor,
            reauth: { reason: 'token_v1', auth_id: 'u-1' },
        } as AuthResult);
        if (!('reject' in decision)) throw new Error('expected reject');
        expect((decision.reject as SocketReauthError).data.reason).toBe(
            'token_v1',
        );
    });
});
