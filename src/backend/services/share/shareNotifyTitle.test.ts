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
    digestLines,
    digestSubject,
    mergeDigestEntry,
    mergeShareSender,
    shareNotifyTitle,
    shareSendersFromFields,
} from './shareNotifyTitle';

describe('shareNotifyTitle', () => {
    it('reads the same for one sender as it did before grouping', () => {
        expect(shareNotifyTitle([{ username: 'alice', count: 1 }])).toBe(
            'alice shared an item with you',
        );
        expect(shareNotifyTitle([{ username: 'alice', count: 3 }])).toBe(
            'alice shared 3 items with you',
        );
    });

    it('names two senders and totals what they shared', () => {
        expect(
            shareNotifyTitle([
                { username: 'alice', count: 3 },
                { username: 'bob', count: 2 },
            ]),
        ).toBe('alice and bob shared 5 items with you');
    });

    it('counts the rest once there are more names than fit', () => {
        const senders = [
            { username: 'alice', count: 1 },
            { username: 'bob', count: 1 },
            { username: 'carol', count: 1 },
        ];
        expect(shareNotifyTitle(senders)).toBe(
            'alice, bob and 1 other shared 3 items with you',
        );
        expect(
            shareNotifyTitle([...senders, { username: 'dave', count: 6 }]),
        ).toBe('alice, bob and 2 others shared 9 items with you');
    });

    it('says something sensible when a sender has no username', () => {
        expect(shareNotifyTitle([{ username: '', count: 1 }])).toBe(
            'Someone shared an item with you',
        );
        expect(shareNotifyTitle([])).toBe('Someone shared 0 items with you');
    });
});

describe('mergeShareSender', () => {
    it('adds to a sender already in the list', () => {
        expect(
            mergeShareSender([{ username: 'alice', count: 2 }], 'alice', 3),
        ).toEqual([{ username: 'alice', count: 5 }]);
    });

    it('appends a new sender in the order they arrived', () => {
        expect(
            mergeShareSender([{ username: 'alice', count: 1 }], 'bob', 2),
        ).toEqual([
            { username: 'alice', count: 1 },
            { username: 'bob', count: 2 },
        ]);
    });

    it('leaves the list it was given alone', () => {
        const senders = [{ username: 'alice', count: 1 }];
        mergeShareSender(senders, 'alice', 4);
        expect(senders).toEqual([{ username: 'alice', count: 1 }]);
    });

    it('groups every nameless sender together', () => {
        expect(mergeShareSender([], undefined, 1)).toEqual([
            { username: 'Someone', count: 1 },
        ]);
    });
});

describe('shareSendersFromFields', () => {
    it('reads back the grouped shape', () => {
        expect(
            shareSendersFromFields({
                senders: [{ username: 'alice', count: 2 }],
            }),
        ).toEqual([{ username: 'alice', count: 2 }]);
    });

    it('reads the single-sender shape written before grouping existed', () => {
        // A notification can outlive the deploy that changes its shape;
        // dropping its sender would make the next share read as the first.
        expect(
            shareSendersFromFields({ username: 'alice', count: 3 }),
        ).toEqual([{ username: 'alice', count: 3 }]);
    });

    it('has nothing to say about fields that carry no sender', () => {
        expect(shareSendersFromFields(undefined)).toEqual([]);
        expect(shareSendersFromFields({})).toEqual([]);
        expect(shareSendersFromFields({ count: 0 })).toEqual([]);
    });

    it('drops a malformed sender rather than counting it as zero items', () => {
        expect(
            shareSendersFromFields({
                senders: [
                    { username: 'alice', count: 2 },
                    { username: 'bob', count: 'nonsense' },
                ],
            }),
        ).toEqual([{ username: 'alice', count: 2 }]);
    });
});

describe('email digests', () => {
    it('names the item for a single share, counts for more', () => {
        expect(
            digestSubject([{ username: 'alice', count: 1, names: ['a.txt'] }]),
        ).toBe('alice shared a.txt with you');
        expect(
            digestSubject(
                [
                    { username: 'alice', count: 1, names: ['a.txt'] },
                    { username: 'bob', count: 2, names: ['b.txt'] },
                ],
                { suffix: 'on Puter' },
            ),
        ).toBe('alice and bob shared 3 items with you on Puter');
    });

    it('renders one line per sender, naming what it can', () => {
        expect(
            digestLines([
                { username: 'alice', count: 1, names: ['a.txt'] },
                { username: 'bob', count: 5, names: ['b.txt', 'c.txt'] },
                { username: 'carol', count: 2, names: [] },
            ]),
        ).toEqual([
            { sender: 'alice', what: 'a.txt' },
            { sender: 'bob', what: '5 items — b.txt, c.txt, +3 more' },
            { sender: 'carol', what: '2 items' },
        ]);
    });

    it('merges a sender back into their own digest entry', () => {
        const merged = mergeDigestEntry(
            [{ username: 'alice', count: 1, names: ['a.txt'] }],
            'alice',
            2,
            ['b.txt'],
        );
        expect(merged).toEqual([
            { username: 'alice', count: 3, names: ['a.txt', 'b.txt'] },
        ]);
    });
});
