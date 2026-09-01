/*
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
import {
    maskedSharePath,
    ownerFromSharePath,
    SHARE_DEEP_LINK_ITEMS_LIMIT,
    SHARE_DEEP_LINK_MAX_LENGTH,
    shareDeepLink,
    sharedViewLink,
    shareTargetLink,
} from './shareDeepLink.js';

const UID = '11111111-2222-4333-8444-555555555555';

describe('ownerFromSharePath', () => {
    // Both forms name the owner first, which is the point: the masked path is
    // what a recipient holds, the real one is what the issuer's request built.
    it('reads the owner from either form of path', () => {
        expect(ownerFromSharePath(`/alice/${UID}/report.txt`)).toBe('alice');
        expect(ownerFromSharePath('/alice/Documents/Q3/report.txt')).toBe(
            'alice',
        );
    });

    it('has no owner to give for a path that names none', () => {
        expect(ownerFromSharePath('/')).toBeNull();
        expect(ownerFromSharePath('')).toBeNull();
        expect(ownerFromSharePath(undefined as unknown as string)).toBeNull();
    });
});

describe('maskedSharePath', () => {
    it('builds the form a recipient is given', () => {
        expect(
            maskedSharePath({
                name: 'report.txt',
                uid: UID,
                ownerUsername: 'alice',
            }),
        ).toBe(`/alice/${UID}/report.txt`);
    });

    it('refuses to build one with a piece missing', () => {
        const target = { name: 'report.txt', uid: UID, ownerUsername: 'alice' };
        expect(maskedSharePath({ ...target, name: '' })).toBeNull();
        expect(maskedSharePath({ ...target, uid: '' })).toBeNull();
        expect(maskedSharePath({ ...target, ownerUsername: '' })).toBeNull();
    });
});

describe('shareDeepLink', () => {
    it('puts the whole path in one encoded parameter', () => {
        expect(shareDeepLink('https://puter.com', `/alice/${UID}/a.txt`)).toBe(
            `https://puter.com/?shared=%2Falice%2F${UID}%2Fa.txt`,
        );
    });

    // A self-hoster's origin may carry a port, and may or may not end in a
    // slash; neither should produce `//?shared=`.
    it('tolerates a trailing slash on the origin', () => {
        expect(shareDeepLink('http://localhost:4100/', '/a/b/c')).toBe(
            'http://localhost:4100/?shared=%2Fa%2Fb%2Fc',
        );
    });

    // A name is the owner's text: `&` would start a second parameter and `#`
    // would truncate the path, so the encoding is what keeps the link whole.
    it('encodes a name that would otherwise break the query string', () => {
        const link = shareDeepLink(
            'https://puter.com',
            `/alice/${UID}/a&b#c d.txt`,
        );
        expect(link).toContain('%26b%23c%20d.txt');
        expect(link.split('?')).toHaveLength(2);
        expect(link).not.toContain('#');
        // Round-trips: what the GUI reads back is the path we meant.
        const shared = new URL(link).searchParams.get('shared');
        expect(shared).toBe(`/alice/${UID}/a&b#c d.txt`);
    });
});

describe('sharedViewLink', () => {
    it('repeats the parameter once per item, in order', () => {
        const link = sharedViewLink('https://puter.com', [
            `/alice/${UID}/a.txt`,
            `/bob/${UID}/b.txt`,
        ]);
        expect(link).toBe(
            `https://puter.com/?shared=%2Falice%2F${UID}%2Fa.txt&shared=%2Fbob%2F${UID}%2Fb.txt`,
        );
        // Round-trips: the GUI reads back every path, as it was.
        expect(new URL(link).searchParams.getAll('shared')).toEqual([
            `/alice/${UID}/a.txt`,
            `/bob/${UID}/b.txt`,
        ]);
    });

    // Nothing addressable still deserves a way in: the parameter alone opens
    // Shared, the same place a link with items lands.
    it('still opens Shared when there is nothing to pick out', () => {
        expect(sharedViewLink('https://puter.com', [])).toBe(
            'https://puter.com/?shared=',
        );
    });

    // A name can run to hundreds of characters, and encoding multiplies
    // non-ASCII ones; the link exists to name the item, so it always does,
    // however long — the length cap only limits how many more join it.
    it('keeps the first item even when it alone outgrows the length cap', () => {
        const long = `/alice/${UID}/${'\u5831\u544a'.repeat(120)}.pdf`;
        const short = `/alice/${UID}/a.txt`;
        expect(shareDeepLink('https://puter.com', long).length).toBeGreaterThan(
            SHARE_DEEP_LINK_MAX_LENGTH,
        );
        expect(
            new URL(
                shareDeepLink('https://puter.com', long),
            ).searchParams.getAll('shared'),
        ).toEqual([long]);
        // Nothing fits after it, and nothing later is taken instead.
        expect(
            new URL(
                sharedViewLink('https://puter.com', [long, short]),
            ).searchParams.getAll('shared'),
        ).toEqual([long]);
    });

    it('names an item once however often it was queued', () => {
        const path = `/alice/${UID}/a.txt`;
        expect(sharedViewLink('https://puter.com', [path, path])).toBe(
            shareDeepLink('https://puter.com', path),
        );
    });

    it('stops adding items where mail clients stop tolerating the length', () => {
        const paths = Array.from(
            { length: SHARE_DEEP_LINK_ITEMS_LIMIT + 5 },
            (_, i) => `/alice/${UID}/file-${i}.txt`,
        );
        const shared = new URL(
            sharedViewLink('https://puter.com', paths),
        ).searchParams.getAll('shared');
        expect(shared).toEqual(paths.slice(0, SHARE_DEEP_LINK_ITEMS_LIMIT));
    });

    // Twenty ordinary names already run to several kilobytes once encoded, so
    // the count alone is no guard; the link itself has to stay short enough.
    it('stops adding items before the link outgrows what mail clients tolerate', () => {
        const paths = Array.from(
            { length: SHARE_DEEP_LINK_ITEMS_LIMIT },
            (_, i) => `/alice/${UID}/${'quarterly report '.repeat(8)}${i}.pdf`,
        );
        const link = sharedViewLink('https://puter.com', paths);
        expect(link.length).toBeLessThanOrEqual(SHARE_DEEP_LINK_MAX_LENGTH);
        const shared = new URL(link).searchParams.getAll('shared');
        // Only a leading run made it — the first items, none skipped.
        expect(shared.length).toBeGreaterThan(1);
        expect(shared.length).toBeLessThan(paths.length);
        expect(shared).toEqual(paths.slice(0, shared.length));
        // The next item would not have fit.
        expect(
            link.length + `&shared=${encodeURIComponent(paths[shared.length])}`.length,
        ).toBeGreaterThan(SHARE_DEEP_LINK_MAX_LENGTH);
    });
});

describe('shareTargetLink', () => {
    it('links an addressable target and nothing else', () => {
        expect(
            shareTargetLink('https://puter.com', {
                name: 'a.txt',
                uid: UID,
                ownerUsername: 'alice',
            }),
        ).toBe(`https://puter.com/?shared=%2Falice%2F${UID}%2Fa.txt`);
        expect(
            shareTargetLink('https://puter.com', {
                name: 'a.txt',
                uid: '',
                ownerUsername: 'alice',
            }),
        ).toBeNull();
    });
});
