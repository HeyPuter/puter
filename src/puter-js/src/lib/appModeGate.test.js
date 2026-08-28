import { describe, expect, it } from 'vitest';
import { isFramedDocument } from './appModeGate.js';

describe('isFramedDocument', () => {
    it('rejects a top-level document, which is its own parent', () => {
        // The exploit shape: any page can be handed `puter.app_instance_id`
        // via a crafted link, and app mode is what makes the URL's
        // `puter.api_origin` authoritative.
        const scope = {};
        scope.parent = scope;
        expect(isFramedDocument(scope)).toBe(false);
    });

    it('accepts a framed document', () => {
        expect(isFramedDocument({ parent: {} })).toBe(true);
    });

    it('rejects a scope with no parent at all (worker, node)', () => {
        expect(isFramedDocument({})).toBe(false);
        expect(isFramedDocument(undefined)).toBe(false);
    });

    it('treats an unreadable parent as framed', () => {
        const scope = {
            get parent() {
                throw new Error('cross-origin');
            },
        };
        expect(isFramedDocument(scope)).toBe(true);
    });
});
