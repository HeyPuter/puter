import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    readClaimedGrantIdentifier,
    signGuestGrant,
    verifyGuestGrant,
} from './guestGrant.js';

const SECRET = 'grant-secret';
const USER_ID = 'AAAAAAAAAAAAAAAAAAAAAA';
const APP_ID = 'BBBBBBBBBBBBBBBBBBBBBB';

/**
 * Hand-build a grant so tests can put payloads through the real signature
 * (things the issuer would never emit) and confirm verification still refuses
 * them. Mirrors the wire format deliberately: if the format changes, these fail
 * and get looked at.
 */
const forgeGrant = (
    payload: unknown,
    { secret = SECRET, version = 'pg1' } = {},
): string => {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', secret)
        .update(`${version}.${encoded}`)
        .digest('base64url');
    return `${version}.${encoded}.${signature}`;
};

describe('signGuestGrant / verifyGuestGrant', () => {
    it('round-trips a user identifier and its expiry', () => {
        const now = 1_700_000_000_000;
        const { grant, expiresAt } = signGuestGrant({
            customIdentifier: USER_ID,
            ttlSeconds: 3600,
            secret: SECRET,
            now,
        });

        expect(expiresAt).toBe(Math.floor(now / 1000) + 3600);

        const verified = verifyGuestGrant({ grant, secret: SECRET, now });
        expect(verified).toEqual({
            status: 'ok',
            customIdentifier: USER_ID,
            expiresAt,
        });
    });

    it('round-trips an app-under-user identifier', () => {
        const identifier = `${USER_ID}:${APP_ID}`;
        const { grant } = signGuestGrant({
            customIdentifier: identifier,
            ttlSeconds: 60,
            secret: SECRET,
        });

        const verified = verifyGuestGrant({ grant, secret: SECRET });
        expect(verified).toMatchObject({
            status: 'ok',
            customIdentifier: identifier,
        });
    });

    it('issues distinct grants for the same identifier and second', () => {
        const args = {
            customIdentifier: USER_ID,
            ttlSeconds: 60,
            secret: SECRET,
            now: 1_700_000_000_000,
        };
        expect(signGuestGrant(args).grant).not.toBe(signGuestGrant(args).grant);
    });

    it('rejects a grant signed with a different secret', () => {
        const { grant } = signGuestGrant({
            customIdentifier: USER_ID,
            ttlSeconds: 60,
            secret: 'other-secret',
        });

        expect(verifyGuestGrant({ grant, secret: SECRET })).toEqual({
            status: 'invalid',
        });
    });

    it('rejects a tampered payload', () => {
        const { grant } = signGuestGrant({
            customIdentifier: USER_ID,
            ttlSeconds: 60,
            secret: SECRET,
        });
        const [version, , signature] = grant.split('.');
        const swapped = Buffer.from(
            JSON.stringify({ id: APP_ID, exp: 9_999_999_999, n: 'x' }),
        ).toString('base64url');

        expect(
            verifyGuestGrant({
                grant: `${version}.${swapped}.${signature}`,
                secret: SECRET,
            }),
        ).toEqual({ status: 'invalid' });
    });

    it('rejects a tampered signature', () => {
        const { grant } = signGuestGrant({
            customIdentifier: USER_ID,
            ttlSeconds: 60,
            secret: SECRET,
        });
        const [version, payload, signature] = grant.split('.');
        const flipped =
            signature![0] === 'A'
                ? `B${signature!.slice(1)}`
                : `A${signature!.slice(1)}`;

        expect(
            verifyGuestGrant({
                grant: `${version}.${payload}.${flipped}`,
                secret: SECRET,
            }),
        ).toEqual({ status: 'invalid' });
    });

    it('rejects a signature of the wrong length', () => {
        const { grant } = signGuestGrant({
            customIdentifier: USER_ID,
            ttlSeconds: 60,
            secret: SECRET,
        });
        const [version, payload] = grant.split('.');

        expect(
            verifyGuestGrant({
                grant: `${version}.${payload}.AAAA`,
                secret: SECRET,
            }),
        ).toEqual({ status: 'invalid' });
    });

    it('reports an expired grant distinctly from an invalid one', () => {
        const now = 1_700_000_000_000;
        const { grant } = signGuestGrant({
            customIdentifier: USER_ID,
            ttlSeconds: 60,
            secret: SECRET,
            now,
        });

        expect(
            verifyGuestGrant({ grant, secret: SECRET, now: now + 61_000 }),
        ).toEqual({ status: 'expired' });
    });

    it('treats the expiry second itself as expired', () => {
        const now = 1_700_000_000_000;
        const { grant, expiresAt } = signGuestGrant({
            customIdentifier: USER_ID,
            ttlSeconds: 60,
            secret: SECRET,
            now,
        });

        expect(
            verifyGuestGrant({
                grant,
                secret: SECRET,
                now: expiresAt * 1000,
            }),
        ).toEqual({ status: 'expired' });
        expect(
            verifyGuestGrant({
                grant,
                secret: SECRET,
                now: expiresAt * 1000 - 1,
            }),
        ).toMatchObject({ status: 'ok' });
    });

    it.each([
        ['a non-string', 42],
        ['undefined', undefined],
        ['an empty string', ''],
        ['too few segments', 'pg1.payload'],
        ['too many segments', 'pg1.payload.sig.extra'],
        ['an over-long string', `pg1.${'a'.repeat(600)}.sig`],
    ])('rejects %s as malformed', (_label, grant) => {
        expect(verifyGuestGrant({ grant, secret: SECRET })).toEqual({
            status: 'malformed',
        });
    });

    it('rejects an unknown version even when correctly signed', () => {
        const grant = forgeGrant(
            { id: USER_ID, exp: 9_999_999_999, n: 'x' },
            { version: 'pg2' },
        );

        expect(verifyGuestGrant({ grant, secret: SECRET })).toEqual({
            status: 'malformed',
        });
    });

    it('rejects a correctly signed payload that is not JSON', () => {
        const encoded = Buffer.from('not json').toString('base64url');
        const signature = createHmac('sha256', SECRET)
            .update(`pg1.${encoded}`)
            .digest('base64url');

        expect(
            verifyGuestGrant({
                grant: `pg1.${encoded}.${signature}`,
                secret: SECRET,
            }),
        ).toEqual({ status: 'malformed' });
    });

    it.each([
        [
            'an identifier of the wrong shape',
            { id: 'nope', exp: 9_999_999_999 },
        ],
        ['a non-string identifier', { id: 42, exp: 9_999_999_999 }],
        ['a missing identifier', { exp: 9_999_999_999 }],
        ['a non-numeric expiry', { id: USER_ID, exp: 'soon' }],
        ['a missing expiry', { id: USER_ID }],
        ['an infinite expiry', { id: USER_ID, exp: Infinity }],
    ])('rejects %s even when correctly signed', (_label, payload) => {
        expect(
            verifyGuestGrant({ grant: forgeGrant(payload), secret: SECRET }),
        ).toEqual({ status: 'malformed' });
    });

    it('rejects an identifier carrying a third segment', () => {
        const grant = forgeGrant({
            id: `${USER_ID}:${APP_ID}:${APP_ID}`,
            exp: 9_999_999_999,
        });

        expect(verifyGuestGrant({ grant, secret: SECRET })).toEqual({
            status: 'malformed',
        });
    });
});

describe('readClaimedGrantIdentifier', () => {
    it('reads the identifier from a valid grant', () => {
        const { grant } = signGuestGrant({
            customIdentifier: USER_ID,
            ttlSeconds: 60,
            secret: SECRET,
        });

        expect(readClaimedGrantIdentifier(grant)).toBe(USER_ID);
    });

    it('reads the claimed identifier without checking the signature', () => {
        // Bucketing runs before verification, so this is expected: a forged
        // grant still names a bucket, and the handler still rejects it.
        const grant = forgeGrant(
            { id: USER_ID, exp: 9_999_999_999, n: 'x' },
            { secret: 'wrong-secret' },
        );

        expect(readClaimedGrantIdentifier(grant)).toBe(USER_ID);
    });

    it('reads an expired grant, which the handler then rejects', () => {
        const { grant } = signGuestGrant({
            customIdentifier: USER_ID,
            ttlSeconds: 60,
            secret: SECRET,
            now: 1_000_000_000_000,
        });

        expect(readClaimedGrantIdentifier(grant)).toBe(USER_ID);
        expect(verifyGuestGrant({ grant, secret: SECRET })).toEqual({
            status: 'expired',
        });
    });

    it.each([
        ['a non-string', 42],
        ['undefined', undefined],
        ['a wrong-shaped string', 'not-a-grant'],
        ['an unknown version', 'pg2.abc.def'],
        ['an over-long string', `pg1.${'a'.repeat(600)}.sig`],
        [
            'a non-JSON payload',
            `pg1.${Buffer.from('x').toString('base64url')}.sig`,
        ],
    ])('returns null for %s', (_label, grant) => {
        expect(readClaimedGrantIdentifier(grant)).toBeNull();
    });

    it('returns null for an identifier of the wrong shape', () => {
        const grant = forgeGrant({ id: 'nope', exp: 9_999_999_999 });
        expect(readClaimedGrantIdentifier(grant)).toBeNull();
    });
});
