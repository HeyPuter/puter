import { describe, expect, it } from 'vitest';
import parse_shared_path from './parseSharedPath.js';

const UID = '11111111-2222-4333-8444-555555555555';

describe('parse_shared_path', () => {
    it('reads the owner, uuid and name a share link carries', () => {
        expect(parse_shared_path(`/alice/${UID}/report.txt`)).toEqual({
            owner: 'alice',
            uid: UID,
            name: 'report.txt',
        });
    });

    // A shared folder stays navigable, so the name can go deeper than one
    // segment once the recipient has opened into it.
    it('keeps a path below the shared root', () => {
        expect(parse_shared_path(`/alice/${UID}/dir/inner/file.txt`)).toEqual({
            owner: 'alice',
            uid: UID,
            name: 'dir/inner/file.txt',
        });
    });

    it('refuses anything that is not that shape', () => {
        // Not a path at all.
        expect(parse_shared_path('')).toBeNull();
        expect(parse_shared_path(undefined)).toBeNull();
        expect(parse_shared_path(42)).toBeNull();
        expect(parse_shared_path('alice/uuid/a.txt')).toBeNull();
        // A real path that merely looks similar.
        expect(parse_shared_path('/alice/Documents/a.txt')).toBeNull();
        // Truncated: the uuid addresses the parent, so there is nothing to open.
        expect(parse_shared_path(`/alice/${UID}`)).toBeNull();
        expect(parse_shared_path(`/alice/${UID}/`)).toBeNull();
        // Owner missing.
        expect(parse_shared_path(`//${UID}/a.txt`)).toBeNull();
        // Not a uuid.
        expect(parse_shared_path('/alice/not-a-uuid/a.txt')).toBeNull();
        expect(
            parse_shared_path(`/alice/${UID.replace('1', 'z')}/a.txt`),
        ).toBeNull();
    });
});
