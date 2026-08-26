import { describe, expect, it } from 'vitest';
import { share_outcome } from './shareOutcome.js';

describe('share_outcome', () => {
    it('reports a first-time share', () => {
        expect(share_outcome([{ holder: 'ann', mode: 'read', isNew: true }]))
            .toBe('shared');
    });

    it('reports an invite ahead of anything else', () => {
        expect(
            share_outcome([
                { recipientEmail: 'x@example.com', pending: true, isNew: true },
            ]),
        ).toBe('invited');
    });

    it('says nothing changed when the same access is granted twice', () => {
        // The bug: this used to read as a fresh share.
        expect(
            share_outcome(
                [{ holder: 'ann', mode: 'read', isNew: false }],
                [{ holder: 'ann', mode: 'read' }],
            ),
        ).toBe('unchanged');
    });

    it('says the level changed when the mode differs', () => {
        expect(
            share_outcome(
                [{ holder: 'ann', mode: 'write', isNew: false }],
                [{ holder: 'ann', mode: 'read' }],
            ),
        ).toBe('updated');
    });

    it('matches on the resolved username, not what was typed', () => {
        // The recipient was entered as an email; their row is keyed on the
        // username the server resolved it to.
        expect(
            share_outcome(
                [{ holder: 'ann', mode: 'write', isNew: false }],
                [{ holder: 'ann', mode: 'read' }, { holder: 'bob', mode: 'read' }],
            ),
        ).toBe('updated');
    });

    it('ignores an inherited row, which this call cannot have changed', () => {
        expect(
            share_outcome(
                [{ holder: 'ann', mode: 'read', isNew: false }],
                [{ holder: 'ann', mode: 'write', inheritedFrom: '/bob/Docs' }],
            ),
        ).toBe('unchanged');
    });

    it('falls back to `shared` when the backend does not report isNew', () => {
        // An older server, or the CDN SDK before this shipped.
        expect(share_outcome([{ holder: 'ann', mode: 'read' }])).toBe('shared');
        expect(share_outcome([])).toBe('shared');
        expect(share_outcome(undefined)).toBe('shared');
    });
});
