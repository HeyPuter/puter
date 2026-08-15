/**
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

import { describe, expect, it, vi } from 'vitest';
import type { IConfig } from '../../types';
import { EmailClient } from './EmailClient';

const FROM = '"Puter" <no-reply@puter.test>';

/**
 * Nodemailer's JSON transport is a real transport that serializes the message
 * instead of talking SMTP — the send path stays genuine while the wire stays
 * local.
 */
const jsonTransportConfig = (overrides: Partial<IConfig> = {}): IConfig =>
    ({
        port: 0,
        extensions: [],
        env: 'prod',
        email: { jsonTransport: true, from: FROM },
        ...overrides,
    }) as unknown as IConfig;

const startClient = (overrides: Partial<IConfig> = {}): EmailClient => {
    const client = new EmailClient(jsonTransportConfig(overrides));
    client.onServerStart();
    return client;
};

/** The JSON transport reports the serialized message on `.message`. */
const sentMessage = (info: unknown) =>
    JSON.parse((info as { message: string }).message) as {
        from: { address: string; name: string };
        to: { address: string }[];
        subject: string;
        html?: string;
        headers?: Record<string, string>;
    };

describe('EmailClient — transport lifecycle', () => {
    it('reports as configured once a transport is wired up', () => {
        const client = startClient();
        expect(client.isConfigured).toBe(true);
        client.onServerShutdown();
        expect(client.isConfigured).toBe(false);
    });

    it('warns and stays unconfigured when no transport is set', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const client = new EmailClient({
            port: 0,
            extensions: [],
        } as unknown as IConfig);
        client.onServerStart();

        expect(client.isConfigured).toBe(false);
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('no email transport configured'),
        );
        warn.mockRestore();
    });

    it('drops the send and returns null when no transport exists', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const client = new EmailClient({
            port: 0,
            extensions: [],
        } as unknown as IConfig);
        client.onServerStart();

        await expect(
            client.sendRaw({ to: 'a@b.test', subject: 'hi', text: 'hi' }),
        ).resolves.toBeNull();
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('without transport'),
            expect.objectContaining({ to: 'a@b.test' }),
        );
        warn.mockRestore();
    });
});

describe('EmailClient — sending', () => {
    it('sends a rendered template through the transport', async () => {
        const client = startClient();
        const info = await client.sendRaw({
            to: 'user@example.test',
            subject: 'raw subject',
            html: '<p>hello</p>',
            headers: { 'List-Unsubscribe': '<https://puter.test/u>' },
        });

        const message = sentMessage(info);
        expect(message.subject).toBe('raw subject');
        expect(message.to[0].address).toBe('user@example.test');
        expect(message.from.address).toBe('no-reply@puter.test');
        expect(message.headers?.['List-Unsubscribe']).toBe(
            '<https://puter.test/u>',
        );
    });

    it('lets the caller override the from address', async () => {
        const client = startClient();
        const info = await client.sendRaw({
            from: 'ops@puter.test',
            to: 'user@example.test',
            subject: 's',
            text: 't',
        });
        expect(sentMessage(info).from.address).toBe('ops@puter.test');
    });

    it('falls back to the built-in sender when config has none', async () => {
        const client = startClient({
            email: { jsonTransport: true },
        } as unknown as Partial<IConfig>);
        const info = await client.sendRaw({
            to: 'user@example.test',
            subject: 's',
            text: 't',
        });
        expect(sentMessage(info).from.address).toBe('no-reply@puter.com');
    });

    it('refuses an unknown template name', async () => {
        const client = startClient();
        await expect(
            client.send('user@example.test', 'not-a-template' as never),
        ).rejects.toThrow('Unknown email template: not-a-template');
    });

    it('surfaces transport failures to the caller', async () => {
        // Port 1 on loopback is never listening, so the send really fails.
        const client = startClient({
            email: { host: '127.0.0.1', port: 1, from: FROM },
        } as unknown as Partial<IConfig>);

        await expect(
            client.sendRaw({
                to: 'user@example.test',
                subject: 's',
                text: 't',
            }),
        ).rejects.toThrow();
    });
});

describe('EmailClient — template rendering', () => {
    it('renders the code into both subject and body', async () => {
        const client = startClient();
        const captured: { subject?: string; html?: string } = {};
        const original = client.sendRaw.bind(client);
        vi.spyOn(client, 'sendRaw').mockImplementation(async (options) => {
            captured.subject = options.subject;
            captured.html = options.html;
            return original(options);
        });

        await client.send('user@example.test', 'email_verification_code', {
            code: '424242',
        });

        expect(captured.subject).toBe('424242 is your confirmation code');
        expect(captured.html).toContain('<strong>424242</strong>');
    });

    it('does not HTML-escape values in the plain-text subject header', async () => {
        const client = startClient();
        const captured: { subject?: string } = {};
        vi.spyOn(client, 'sendRaw').mockImplementation(async (options) => {
            captured.subject = options.subject;
            return null;
        });

        await client.send('dev@example.test', 'app-user-feedback', {
            owner_username: 'dev',
            sender_username: 'user',
            sender_email: null,
            app_title: "Bob's App & Games",
            app_name: 'bobs-app',
            app_link: 'https://puter.example/app/bobs-app',
            message: 'hi',
        });

        // A subject is not HTML — entities would render literally in the
        // recipient's mail client.
        expect(captured.subject).toBe("New user feedback for Bob's App & Games");
    });

    it('escapes html and converts newlines in nl2br values', async () => {
        const client = startClient();
        let html = '';
        vi.spyOn(client, 'sendRaw').mockImplementation(async (options) => {
            html = options.html ?? '';
            return null;
        });

        await client.send('dev@example.test', 'listing-rejected', {
            app_name: 'demo',
            app_title: 'Demo',
            reason: 'first & "only"\n<b>line</b>',
        });

        expect(html).toContain(
            'first &amp; &quot;only&quot;<br />&lt;b&gt;line&lt;/b&gt;',
        );
    });

    it('renders an empty string for a missing nl2br value', async () => {
        const client = startClient();
        let html = '';
        vi.spyOn(client, 'sendRaw').mockImplementation(async (options) => {
            html = options.html ?? '';
            return null;
        });

        await client.send('dev@example.test', 'listing-rejected', {
            app_name: 'demo',
            app_title: 'Demo',
        });

        expect(html).toContain('<blockquote></blockquote>');
    });
});

describe('EmailClient.clean', () => {
    const clean = (email: string) => startClient().clean(email);

    it('strips subaddressing on ordinary domains', () => {
        expect(clean('person+tag@example.test')).toBe('person@example.test');
    });

    it('ignores dots and subaddressing for gmail', () => {
        expect(clean('first.last+news@gmail.com')).toBe('firstlast@gmail.com');
    });

    it('canonicalizes googlemail onto gmail', () => {
        expect(clean('first.last@googlemail.com')).toBe('firstlast@gmail.com');
    });

    it('keeps yahoo subaddressing, which yahoo treats as distinct', () => {
        expect(clean('person-tag+x@yahoo.com')).toBe('person-tag+x@yahoo.com');
    });

    it('ignores dots for icloud aliases', () => {
        expect(clean('first.last+tag@me.com')).toBe('firstlast@me.com');
    });

    it('returns anything that is not an address unchanged', () => {
        expect(clean('not-an-email')).toBe('not-an-email');
        expect(clean('@nolocal.test')).toBe('@nolocal.test');
    });
});

describe('EmailClient.validate', () => {
    it('waves everything through in a dev environment', async () => {
        const client = startClient({ env: 'dev' } as Partial<IConfig>);
        await expect(client.validate('anything@blocked.test')).resolves.toBe(
            true,
        );
    });

    it('rejects a blocked domain suffix', async () => {
        const client = startClient({
            blockedEmailDomains: ['blocked.test'],
        } as unknown as Partial<IConfig>);

        await expect(client.validate('person@blocked.test')).resolves.toBe(
            false,
        );
        await expect(client.validate('person@allowed.test')).resolves.toBe(
            true,
        );
    });

    it('matches the blocklist against the cleaned address', async () => {
        const client = startClient({
            blockedEmailDomains: ['@gmail.com'],
        } as unknown as Partial<IConfig>);
        await expect(
            client.validate('first.last+tag@googlemail.com'),
        ).resolves.toBe(false);
    });

    it('lets a registered validator veto an address', async () => {
        const client = startClient();
        const seen: string[] = [];
        client.addValidator((email) => {
            seen.push(email);
            return !email.startsWith('spam');
        });

        await expect(client.validate('spam+x@example.test')).resolves.toBe(
            false,
        );
        await expect(client.validate('fine@example.test')).resolves.toBe(true);
        // Validators always see the canonical form.
        expect(seen).toEqual(['spam@example.test', 'fine@example.test']);
    });

    it('supports asynchronous validators', async () => {
        const client = startClient();
        client.addValidator(async (email) => email !== 'no@example.test');
        await expect(client.validate('no@example.test')).resolves.toBe(false);
        await expect(client.validate('yes@example.test')).resolves.toBe(true);
    });
});
