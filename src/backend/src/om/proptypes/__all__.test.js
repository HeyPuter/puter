import { describe, expect, it } from 'vitest';

const proptypes = require('./__all__');

describe('OM image-base64 proptype', () => {
    const validateIcon = proptypes['image-base64'].validate;

    it('accepts data URL icons', () => {
        expect(validateIcon('data:image/png;base64,abc123')).toBe(true);
    });

    it('accepts absolute URL icons', () => {
        expect(validateIcon('https://example.com/icon.png')).toBe(true);
    });

    it('accepts relative app-icon endpoint paths', () => {
        expect(validateIcon('/app-icon/app-uid-123/64')).toBe(true);
    });

    it('accepts relative app-icon endpoint paths with query params', () => {
        expect(validateIcon('/app-icon/app-uid-123/64?v=123')).toBe(true);
    });

    it('rejects invalid icon values', () => {
        expect(validateIcon('not-an-icon')).toBeInstanceOf(Error);
    });
});
