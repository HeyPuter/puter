import { describe, expect, it } from 'vitest';
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
    it('should compress and decompress payloads correctly', async () => {
        const testKernel = await createTestKernel({
            serviceMap: {
                'token': TokenService,
            },
        });

        const tokenService = testKernel.services!.get('token') as TokenService;

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
