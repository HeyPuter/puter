import { describe, expect, test } from 'vitest';
import type { IConfig } from '../types';
import {
    SmtpConfigError,
    isLocalServerEnabled,
    resolveSmtpConfig,
} from './config.js';

const config = (userEmail: Record<string, unknown> | undefined): IConfig =>
    ({
        api_base_url: 'https://api.example.com',
        userEmail,
    }) as unknown as IConfig;

const valid = {
    secret: 'ingress-secret',
    localServer: true,
    localDomains: ['example.com'],
};

describe('deciding whether the receiver runs', () => {
    test('runs only when localServer is exactly true', () => {
        expect(isLocalServerEnabled(config({ ...valid }))).toBe(true);
    });

    test.each([
        ['absent userEmail', undefined],
        ['no localServer', { secret: 's' }],
        ['localServer false', { secret: 's', localServer: false }],
        ['a truthy non-boolean', { secret: 's', localServer: 'yes' }],
    ])('does not run with %s', (_label, userEmail) => {
        expect(
            isLocalServerEnabled(config(userEmail as Record<string, unknown>)),
        ).toBe(false);
    });
});

describe('resolving receiver config', () => {
    test('derives the ingress url from api_base_url', () => {
        expect(resolveSmtpConfig(config(valid)).ingressUrl).toBe(
            'https://api.example.com/email/ingress',
        );
    });

    test('an explicit ingress url wins', () => {
        const cfg = resolveSmtpConfig(
            config({ ...valid, localIngressUrl: 'http://ingress.test/x' }),
        );
        expect(cfg.ingressUrl).toBe('http://ingress.test/x');
    });

    test('addresses the api virtual host by default', () => {
        // The ingress route is served on the api subdomain, so a request has
        // to name that host even when it connects somewhere else.
        expect(resolveSmtpConfig(config(valid)).ingressHost).toBe(
            'api.example.com',
        );
    });

    test('keeps the api host when the url points at an internal address', () => {
        const cfg = resolveSmtpConfig(
            config({
                ...valid,
                localIngressUrl: 'http://puter:4100/email/ingress',
            }),
        );
        expect(cfg.ingressUrl).toBe('http://puter:4100/email/ingress');
        expect(cfg.ingressHost).toBe('api.example.com');
    });

    test('an explicit ingress host wins', () => {
        const cfg = resolveSmtpConfig(
            config({ ...valid, localIngressHost: 'api.internal' }),
        );
        expect(cfg.ingressHost).toBe('api.internal');
    });

    test('defaults the port to 2525 so no privileged bind is needed', () => {
        expect(resolveSmtpConfig(config(valid)).port).toBe(2525);
    });

    test('port 25 can be opted into', () => {
        expect(
            resolveSmtpConfig(config({ ...valid, localPort: 25 })).port,
        ).toBe(25);
    });

    test('lowercases accepted domains', () => {
        const cfg = resolveSmtpConfig(
            config({ ...valid, localDomains: ['Example.COM'] }),
        );
        expect(cfg.domains).toEqual(['example.com']);
    });

    test('names the first domain as the greeting hostname', () => {
        expect(resolveSmtpConfig(config(valid)).hostname).toBe('example.com');
    });

    test('applies the documented defaults', () => {
        expect(resolveSmtpConfig(config(valid))).toMatchObject({
            host: '0.0.0.0',
            maxRecipients: 50,
            maxClients: 20,
        });
    });

    test('takes the message cap from the mailbox module, not config', () => {
        // Sharing the constant is what stops the receiver accepting a message
        // the ingress endpoint would then refuse.
        const cfg = resolveSmtpConfig(
            config({ ...valid, maxMessageBytes: 999 }),
        );
        expect(cfg.maxMessageBytes).toBe(25 * 1024 * 1024);
    });
});

describe('refusing an unusable config', () => {
    test('requires a secret', () => {
        expect(() =>
            resolveSmtpConfig(
                config({ localServer: true, localDomains: ['e.test'] }),
            ),
        ).toThrow(SmtpConfigError);
    });

    test('requires at least one domain, so it cannot become an open relay', () => {
        expect(() =>
            resolveSmtpConfig(config({ secret: 's', localServer: true })),
        ).toThrow(/localDomains/);
    });

    test('rejects a non-absolute ingress url', () => {
        expect(() =>
            resolveSmtpConfig(
                config({ ...valid, localIngressUrl: '/email/ingress' }),
            ),
        ).toThrow(/absolute URL/);
    });

    test('rejects an impossible port', () => {
        expect(() =>
            resolveSmtpConfig(config({ ...valid, localPort: 70000 })),
        ).toThrow(/localPort/);
    });

    test('names every problem at once', () => {
        try {
            resolveSmtpConfig(config({ localServer: true }));
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(SmtpConfigError);
            expect((err as SmtpConfigError).problems.length).toBeGreaterThan(1);
        }
    });
});
