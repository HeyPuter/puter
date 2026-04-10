import { describe, expect, it } from 'vitest';
import * as jwt from 'jsonwebtoken';
import { createTestKernel } from '../../../tools/test.mjs';
import { TokenService } from './TokenService.js';

// Helper function to match the uuid_compression logic from TokenService
const uuid_compression = (prefix?: string) => ({
    encode: (v: string) => {
        if ( prefix ) {
            if ( ! v.startsWith(prefix) ) {
                throw new Error(`Expected ${prefix} prefix`);
            }
            v = v.slice(prefix.length);
        }

        const undecorated = v.replace(/-/g, '');
        const base64 = Buffer
            .from(undecorated, 'hex')
            .toString('base64');
        return base64;
    },
    decode: (v: string) => {
        // if already a uuid, return that
        if ( v.includes('-') ) return v;

        const undecorated = Buffer
            .from(v, 'base64')
            .toString('hex');
        return (prefix ?? '') + [
            undecorated.slice(0, 8),
            undecorated.slice(8, 12),
            undecorated.slice(12, 16),
            undecorated.slice(16, 20),
            undecorated.slice(20),
        ].join('-');
    },
});

describe('TokenService', () => {
    it('signs auth tokens using uncompressed claim names', async () => {
        const testKernel = await createTestKernel({
            serviceMap: {
                'token': TokenService,
            },
        });

        const tokenService = testKernel.services!.get('token') as TokenService;
        tokenService.secret = 'test-token-service-secret';
        const payload = {
            type: 'session',
            version: '0.0.0',
            uuid: '843f1d83-3c30-48c7-8964-62aff1a912d0',
            user_uid: '42e9c36b-8a53-4c3e-8e18-fe549b10a44d',
            app_uid: 'app-c22ef816-edb6-47c5-8c41-31c6520fa9e6',
        };

        const token = tokenService.sign('auth', payload);
        const decoded = jwt.verify(token, tokenService.secret as string) as jwt.JwtPayload & Record<string, unknown>;

        expect(decoded.type).toBe(payload.type);
        expect(decoded.version).toBe(payload.version);
        expect(decoded.uuid).toBe(payload.uuid);
        expect(decoded.user_uid).toBe(payload.user_uid);
        expect(decoded.app_uid).toBe(payload.app_uid);
        expect(decoded.t).toBeUndefined();
        expect(decoded.u).toBeUndefined();
        expect(decoded.uu).toBeUndefined();
        expect(decoded.au).toBeUndefined();
    });

    it('verifies legacy compressed auth tokens', async () => {
        const testKernel = await createTestKernel({
            serviceMap: {
                'token': TokenService,
            },
        });

        const tokenService = testKernel.services!.get('token') as TokenService;
        tokenService.secret = 'test-token-service-secret';
        const payload = {
            uuid: '843f1d83-3c30-48c7-8964-62aff1a912d0',
            type: 'session',
            user_uid: '42e9c36b-8a53-4c3e-8e18-fe549b10a44d',
            app_uid: 'app-c22ef816-edb6-47c5-8c41-31c6520fa9e6',
        };

        const compressedPayload = tokenService._compress_payload(tokenService.compression!.auth, payload);
        const token = jwt.sign(compressedPayload, tokenService.secret as string);
        const decoded = tokenService.verify('auth', token);

        expect(decoded.uuid).toBe(payload.uuid);
        expect(decoded.type).toBe(payload.type);
        expect(decoded.user_uid).toBe(payload.user_uid);
        expect(decoded.app_uid).toBe(payload.app_uid);
    });

    it('should compress and decompress payloads correctly', async () => {
        const testKernel = await createTestKernel({
            serviceMap: {
                'token': TokenService,
            },
        });

        const tokenService = testKernel.services!.get('token') as TokenService;
        tokenService.secret = 'test-token-service-secret';

        const U1 = '843f1d83-3c30-48c7-8964-62aff1a912d0';
        const U2 = '42e9c36b-8a53-4c3e-8e18-fe549b10a44d';
        const U3 = 'app-c22ef816-edb6-47c5-8c41-31c6520fa9e6';

        // Test compression
        {
            const context = tokenService.compression!.auth;
            const payload = {
                uuid: U1,
                type: 'session',
                user_uid: U2,
                app_uid: U3,
            };

            const compressed = tokenService._compress_payload(context, payload);
            expect(compressed.u).toBe(uuid_compression().encode(U1));
            expect(compressed.t).toBe('s');
            expect(compressed.uu).toBe(uuid_compression().encode(U2));
            expect(compressed.au).toBe(uuid_compression('app-').encode(U3));
        }

        // Test decompression
        {
            const context = tokenService.compression!.auth;
            const payload = {
                u: uuid_compression().encode(U1),
                t: 's',
                uu: uuid_compression().encode(U2),
                au: uuid_compression('app-').encode(U3),
            };

            const decompressed = tokenService._decompress_payload(context, payload);
            expect(decompressed.uuid).toBe(U1);
            expect(decompressed.type).toBe('session');
            expect(decompressed.user_uid).toBe(U2);
            expect(decompressed.app_uid).toBe(U3);
        }

        // Test UUID preservation
        {
            const payload = { uuid: U1 };
            const compressed = tokenService._compress_payload(tokenService.compression!.auth, payload);
            const decompressed = tokenService._decompress_payload(tokenService.compression!.auth, compressed);
            expect(decompressed.uuid).toBe(U1);
        }
    });
});
