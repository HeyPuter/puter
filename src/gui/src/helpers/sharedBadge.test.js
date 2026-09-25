import { describe, expect, it } from 'vitest';
import { has_direct_share } from './sharedBadge.js';

describe('has_direct_share', () => {
    it('is true for a share on the item itself', () => {
        expect(has_direct_share([{ holder: 'alice', inheritedFrom: null }]))
            .toBe(true);
    });

    it('is false when every share is inherited from a folder above', () => {
        // The share belongs to the folder, so badging the file would repeat it
        // on everything inside.
        expect(
            has_direct_share([
                { holder: 'alice', inheritedFrom: '/bob/Docs' },
                { holder: 'carol', inheritedFrom: '/bob/Docs' },
            ]),
        ).toBe(false);
    });

    it('is true when a direct share sits alongside an inherited one', () => {
        expect(
            has_direct_share([
                { holder: 'alice', inheritedFrom: '/bob/Docs' },
                { holder: 'carol', inheritedFrom: null },
            ]),
        ).toBe(true);
    });

    it('counts an unclaimed invite — the owner did share it', () => {
        expect(
            has_direct_share([
                { recipientEmail: 'x@example.com', pending: true, inheritedFrom: null },
            ]),
        ).toBe(true);
    });

    it('is false for nothing at all', () => {
        expect(has_direct_share([])).toBe(false);
        expect(has_direct_share(undefined)).toBe(false);
        expect(has_direct_share(null)).toBe(false);
    });
});
