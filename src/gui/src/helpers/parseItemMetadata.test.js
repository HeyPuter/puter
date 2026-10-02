import { describe, expect, it } from 'vitest';
import parse_item_metadata from './parseItemMetadata.js';

describe('parse_item_metadata', () => {
    it('parses the JSON string the wire carries', () => {
        expect(parse_item_metadata('{"original_name":"a.txt","trashed_ts":1}'))
            .toEqual({ original_name: 'a.txt', trashed_ts: 1 });
    });

    it('reads an absent or unparseable value as empty', () => {
        for ( const value of [undefined, null, '', 'null', '{oops', 7] ) {
            expect(parse_item_metadata(value)).toEqual({});
        }
    });

    it('passes an already-parsed object through', () => {
        const parsed = { original_name: 'a.txt' };
        expect(parse_item_metadata(parsed)).toBe(parsed);
    });
});
