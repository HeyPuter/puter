import { beforeAll, describe, expect, it } from 'vitest';

const proptypes = require('./__all__');
const config = require('../../config');

describe('OM image-base64 proptype', () => {
    const validateIcon = proptypes['image-base64'].validate;
    const adaptIcon = proptypes['image-base64'].adapt;

    beforeAll(() => {
        config.origin = 'https://puter.localhost';
        config.api_base_url = 'https://api.puter.localhost';
    });

    it('accepts data URL icons', () => {
        expect(validateIcon('data:image/png;base64,abc123')).toBe(true);
    });

    it('accepts absolute app-icon endpoint URLs', () => {
        expect(validateIcon('https://api.puter.localhost/app-icon/app-uid-123/64')).toBe(true);
    });

    it('accepts relative app-icon endpoint paths', () => {
        expect(validateIcon('/app-icon/app-uid-123/64')).toBe(true);
    });

    it('migrates relative app-icon endpoint paths to absolute URLs', () => {
        expect(adaptIcon('/app-icon/app-uid-123/64')).toBe('https://api.puter.localhost/app-icon/app-uid-123/64');
    });

    it('accepts relative app-icon endpoint paths with query params', () => {
        expect(validateIcon('/app-icon/app-uid-123/64?v=123')).toBe(true);
    });

    it('rejects invalid icon values', () => {
        expect(validateIcon('not-an-icon')).toBeInstanceOf(Error);
    });

    it('rejects foreign absolute app-icon endpoint URLs', () => {
        expect(validateIcon('https://evil.example/app-icon/app-uid-123/64')).toBeInstanceOf(Error);
    });
});
