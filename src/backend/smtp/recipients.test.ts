import { describe, expect, test } from 'vitest';
import { acceptedRecipients } from './recipients.js';

const DOMAINS = ['example.com', 'Mail.Example.Net'];
const accept = (...addresses: string[]) =>
    acceptedRecipients(addresses, DOMAINS);

describe('choosing which recipients to accept', () => {
    test('accepts a configured domain regardless of case', () => {
        expect(accept('dan@example.com', 'sam@MAIL.EXAMPLE.NET')).toEqual([
            'dan@example.com',
            'sam@MAIL.EXAMPLE.NET',
        ]);
    });

    test('refuses every other domain, which is what stops open relaying', () => {
        expect(
            accept(
                'someone@elsewhere.test',
                'sub@sub.example.com',
                'spoof@example.com.evil.test',
            ),
        ).toEqual([]);
    });

    test('accepts nothing when no domains are configured', () => {
        expect(acceptedRecipients(['dan@example.com'], [])).toEqual([]);
    });

    test('keeps the local part verbatim', () => {
        // What a local part names is the ingress endpoint's decision, so it is
        // handed over exactly as the sender wrote it.
        expect(accept('Dan.Smith+tag@Example.COM')).toEqual([
            'Dan.Smith+tag@Example.COM',
        ]);
    });

    test('splits on the last @, which a quoted local part may contain', () => {
        expect(accept('"odd@name"@example.com')).toEqual([
            '"odd@name"@example.com',
        ]);
    });

    test.each([
        ['no at sign', 'not-an-address'],
        ['empty local part', '@example.com'],
        ['empty domain', 'dan@'],
        ['whitespace', 'dan smith@example.com'],
        ['empty string', ''],
    ])('skips a malformed address (%s)', (_label, address) => {
        expect(accept(address)).toEqual([]);
    });

    test('preserves order and drops repeats', () => {
        expect(
            accept('a@example.com', 'b@example.com', 'a@example.com'),
        ).toEqual(['a@example.com', 'b@example.com']);
    });

    test('treats a domain-case variant as the same recipient', () => {
        expect(accept('a@example.com', 'a@EXAMPLE.COM')).toEqual([
            'a@example.com',
        ]);
    });
});
