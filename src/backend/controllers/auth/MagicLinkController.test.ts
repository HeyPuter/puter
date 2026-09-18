import type { Request, RequestHandler, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { runWithContext } from '../../core/context.js';
import { PuterRouter } from '../../core/http/PuterRouter.js';
import type { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';

const GUI_ORIGIN = 'http://puter.test';
const OPENER = 'https://todo.example';
const RETURN_URL = `${OPENER}/list?tab=today`;

let server: PuterServer;
let router: PuterRouter;
let sentLinks: string[] = [];

beforeAll(async () => {
    server = await setupTestServer({
        origin: GUI_ORIGIN,
        email: {
            from: '"Puter" <no-reply@puter.test>',
            host: 'smtp.test.invalid',
            port: 2525,
        },
    } as never);
    router = new PuterRouter();
    server.controllers.magicLink.registerRoutes(router);
    // The mail transport is the external boundary: capture what would be sent.
    vi.spyOn(server.clients.email, 'send').mockImplementation(
        async (_to, _template, values) => {
            sentLinks.push(String((values as { link: string }).link));
            return { messageId: 'test' } as never;
        },
    );
});

afterAll(async () => {
    await server?.shutdown();
});

afterEach(() => {
    sentLinks = [];
});

const makeReq = (init: {
    body?: unknown;
    query?: Record<string, unknown>;
    headers?: Record<string, string>;
}): Request =>
    ({
        body: init.body ?? {},
        query: init.query ?? {},
        params: {},
        headers: init.headers ?? {},
        cookies: {},
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
        method: 'GET',
    }) as unknown as Request;

interface Captured {
    statusCode: number;
    body: unknown;
    redirectUrl?: string;
    cookies: Array<{ name: string; value: string }>;
}

const makeRes = () => {
    const captured: Captured = { statusCode: 200, body: undefined, cookies: [] };
    const res = {
        json: vi.fn((value: unknown) => {
            captured.body = value;
            return res;
        }),
        status: vi.fn((code: number) => {
            captured.statusCode = code;
            return res;
        }),
        redirect: vi.fn((status: number, url: string) => {
            captured.statusCode = status;
            captured.redirectUrl = url;
            return res;
        }),
        cookie: vi.fn((name: string, value: string) => {
            captured.cookies.push({ name, value });
            return res;
        }),
        setHeader: vi.fn(() => res),
    };
    return { res: res as unknown as Response, captured };
};

const findHandler = (method: string, path: string): RequestHandler => {
    const route = router.routes.find(
        (r) => r.method === method && r.path === path,
    );
    if (!route) throw new Error(`No ${method.toUpperCase()} ${path} route`);
    return route.handler;
};

const callRoute = async (
    method: string,
    path: string,
    req: Request,
    res: Response,
) => {
    const handler = findHandler(method, path);
    await runWithContext({ req }, () =>
        handler(req, res, () => {
            throw new Error('handler called next() unexpectedly');
        }),
    );
};

const requestLink = async (
    email: string,
    overrides: Record<string, unknown> = {},
) => {
    const { res, captured } = makeRes();
    await callRoute(
        'post',
        '/auth/magic-link/request',
        makeReq({
            body: {
                email,
                return_url: RETURN_URL,
                opener_origin: OPENER,
                ...overrides,
            },
        }),
        res,
    );
    return { captured, link: sentLinks.at(-1) ?? null };
};

const tokenFromLink = (link: string): string =>
    new URL(link).searchParams.get('token')!;

const consume = async (link: string) => {
    const { res, captured } = makeRes();
    await callRoute(
        'get',
        '/auth/magic-link/consume',
        makeReq({ query: { token: tokenFromLink(link) } }),
        res,
    );
    return captured;
};

const landingWait = async (session: string, origin: string) => {
    const { res, captured } = makeRes();
    try {
        await runWithContext({}, () =>
            server.controllers.auth.loginWait(
                makeReq({ body: { session }, headers: { origin } }),
                res,
            ),
        );
    } catch (e) {
        return { statusCode: (e as { statusCode: number }).statusCode };
    }
    return captured;
};

const errorCodeOf = (redirectUrl: string | undefined) =>
    new URL(redirectUrl ?? '').searchParams.get('message');

describe('POST /auth/magic-link/request', () => {
    it('emails a consume link on the GUI origin and answers success', async () => {
        const { captured, link } = await requestLink('new-user@example.com');
        expect(captured.body).toEqual({ success: true });
        expect(link).toMatch(`${GUI_ORIGIN}/auth/magic-link/consume?token=`);
    });

    it.each([
        ['a bad email', { email: 'not-an-email' }, 'bad_request'],
        ['a malformed opener origin', { opener_origin: 'ftp://x' }, 'bad_request'],
        [
            'a return URL on another origin',
            { return_url: 'https://evil.example/steal' },
            'invalid_return_url',
        ],
        [
            'a Puter sign-in with a return URL off the GUI origin',
            { opener_origin: undefined, return_url: 'https://evil.example/' },
            'invalid_return_url',
        ],
    ])('rejects %s', async (_label, overrides, code) => {
        await expect(
            requestLink('someone@example.com', overrides),
        ).rejects.toMatchObject({ statusCode: 400, legacyCode: code });
        expect(sentLinks).toHaveLength(0);
    });

    it('without an opener, mails a link that signs in to Puter itself', async () => {
        const send = server.clients.email.send as unknown as ReturnType<
            typeof vi.fn
        >;
        const { captured, link } = await requestLink('someone@example.com', {
            opener_origin: undefined,
            return_url: undefined,
        });
        expect(captured.body).toEqual({ success: true });
        expect(link).toMatch(`${GUI_ORIGIN}/auth/magic-link/consume?token=`);
        expect(send.mock.calls.at(-1)?.[2]).toMatchObject({ app_host: null });
    });

    it('still succeeds when no mail transport is configured (link goes to the console)', async () => {
        const send = server.clients.email.send as unknown as ReturnType<
            typeof vi.fn
        >;
        send.mockImplementationOnce(async () => null);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const { captured } = await requestLink('someone@example.com');
            expect(captured.body).toEqual({ success: true });
            expect(
                warn.mock.calls.some((c) =>
                    String(c[0]).includes('no email transport configured'),
                ),
            ).toBe(true);
        } finally {
            warn.mockRestore();
        }
    });
});

describe('GET /auth/magic-link/consume', () => {
    it('creates a confirmed account, signs in, and lands on the return URL', async () => {
        const email = `fresh-${uuidv4()}@example.com`;
        const { link } = await requestLink(email);
        const captured = await consume(link!);

        expect(captured.statusCode).toBe(302);
        const landed = new URL(captured.redirectUrl!);
        expect(landed.origin + landed.pathname).toBe(`${OPENER}/list`);
        expect(landed.searchParams.get('tab')).toBe('today');
        // The landing page collects its token by a key the link carried.
        expect(landed.searchParams.get('puter.signin_session')).toMatch(
            /^[0-9a-f-]{36}$/,
        );
        const cfg = server.services.magicLink['config'] as {
            cookie_name?: string;
        };
        expect(captured.cookies.map((c) => c.name)).toContain(
            cfg.cookie_name ?? 'puter_token',
        );

        const user = await server.stores.user.getByEmail(email, {
            force: true,
        });
        expect(user).toBeTruthy();
        expect(Boolean(user!.email_confirmed)).toBe(true);
        expect(Boolean(user!.requires_email_confirmation)).toBe(false);
        expect(user!.password).toBeNull();
        expect(user!.username).toBeTruthy();
    });

    it(
        'hands the landing page its token once, bound to the opener origin',
        async () => {
            const { link } = await requestLink(
                `landing-${uuidv4()}@example.com`,
            );
            const landed = await consume(link!);
            const session = new URL(landed.redirectUrl!).searchParams.get(
                'puter.signin_session',
            )!;

            // A poll from another origin gets nothing and, after its relay
            // window lapses, leaves the parked token where it was.
            expect(
                await landingWait(session, 'https://other.example'),
            ).toMatchObject({ statusCode: 408 });
            expect(
                await server.services.magicLink.peekLandingPickup(session),
            ).toEqual(expect.any(String));

            const ok = (await landingWait(session, OPENER)) as Captured;
            expect(ok.body).toMatchObject({ auth_token: expect.any(String) });
            expect(
                await server.services.magicLink.peekLandingPickup(session),
            ).toBeNull();
        },
        20_000,
    );

    it('without an opener, signs in to Puter by cookie and lands on the desktop', async () => {
        const email = `puter-${uuidv4()}@example.com`;
        const { link } = await requestLink(email, {
            opener_origin: undefined,
            return_url: undefined,
        });
        const captured = await consume(link!);

        expect(captured.statusCode).toBe(302);
        expect(captured.redirectUrl).toBe(`${GUI_ORIGIN}/`);
        const cfg = server.services.magicLink['config'] as {
            cookie_name?: string;
        };
        expect(captured.cookies.map((c) => c.name)).toContain(
            cfg.cookie_name ?? 'puter_token',
        );
    });

    it('signs an existing confirmed account in without creating another', async () => {
        const email = `existing-${uuidv4()}@example.com`;
        const first = await consume((await requestLink(email)).link!);
        expect(first.statusCode).toBe(302);
        const before = await server.stores.user.getByEmail(email, {
            force: true,
        });

        const second = await consume((await requestLink(email)).link!);
        expect(second.statusCode).toBe(302);
        expect(second.redirectUrl).toContain('puter.signin_session=');
        const after = await server.stores.user.getByEmail(email, {
            force: true,
        });
        expect(after!.id).toBe(before!.id);
    });

    it('confirms an account that was still pending email confirmation', async () => {
        const email = `pending-${uuidv4()}@example.com`;
        const pending = await server.stores.user.create({
            username: `pending_${uuidv4().slice(0, 8)}`,
            uuid: uuidv4(),
            password: 'hash',
            email,
            clean_email: email,
            requires_email_confirmation: true,
            email_confirm_code: '123456',
        });
        const captured = await consume((await requestLink(email)).link!);
        expect(captured.statusCode).toBe(302);
        expect(captured.redirectUrl).toContain('puter.signin_session=');

        const user = await server.stores.user.getById(pending.id, {
            force: true,
        });
        expect(Boolean(user!.email_confirmed)).toBe(true);
        expect(Boolean(user!.requires_email_confirmation)).toBe(false);
    });

    it('turns a suspended account away', async () => {
        const email = `suspended-${uuidv4()}@example.com`;
        await consume((await requestLink(email)).link!);
        const user = await server.stores.user.getByEmail(email, {
            force: true,
        });
        await server.stores.user.update(user!.id, { suspended: 1 } as never);

        const captured = await consume((await requestLink(email)).link!);
        expect(captured.statusCode).toBe(302);
        expect(captured.redirectUrl).toMatch(`${GUI_ORIGIN}/?`);
        expect(errorCodeOf(captured.redirectUrl)).toBe('account_suspended');
    });

    it('works once: a second click on the same link is expired', async () => {
        const { link } = await requestLink(`once-${uuidv4()}@example.com`);
        expect((await consume(link!)).statusCode).toBe(302);
        const again = await consume(link!);
        expect(errorCodeOf(again.redirectUrl)).toBe('link_expired');
    });

    it('rejects an expired or forged token', async () => {
        const expired = server.services.token.sign(
            'magic-link',
            {
                purpose: 'magic-link',
                jti: uuidv4(),
                email: 'x@example.com',
                session: uuidv4(),
                return_url: RETURN_URL,
                opener_origin: OPENER,
            },
            { expiresIn: '-1s' },
        );
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/magic-link/consume',
            makeReq({ query: { token: expired } }),
            res,
        );
        expect(errorCodeOf(captured.redirectUrl)).toBe('link_expired');

        const forged = makeRes();
        await callRoute(
            'get',
            '/auth/magic-link/consume',
            makeReq({ query: { token: 'garbage' } }),
            forged.res,
        );
        expect(errorCodeOf(forged.captured.redirectUrl)).toBe('link_expired');
    });
});
