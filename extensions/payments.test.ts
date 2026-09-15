import type { Request, Response } from 'express';
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
import { runWithContext } from '../src/backend/core/context.ts';
import { PuterServer } from '../src/backend/server.ts';
import { setupTestServer } from '../src/backend/testUtil.ts';
import {
    CHARGE_EXPIRY_SECS,
    GLOW_SETUP_URL,
    LATE_SETTLEMENT_GRACE_SECS,
    RATES_CACHE_MS,
    RATES_MAX_AGE_MS,
    RATES_RETRY_AFTER_MS,
    resetRatesCache,
    handleCreateCharge,
    handleGetCharge,
    handleGetChargeQr,
    handleGetSettings,
    handleListCharges,
    handleUpdateSettings,
} from './payments.ts';

interface Captured {
    status: number;
    body: unknown;
    headers: Record<string, string>;
}

const makeReq = (
    { body, params, query }: { body?: unknown; params?: Record<string, string>; query?: Record<string, unknown> } = {},
): Request => ({ body, params: params ?? {}, query: query ?? {} }) as unknown as Request;

const makeRes = () => {
    const captured: Captured = { status: 200, body: undefined, headers: {} };
    const res = {
        status: vi.fn((code: number) => {
            captured.status = code;
            return res;
        }),
        json: vi.fn((value: unknown) => {
            captured.body = value;
            return res;
        }),
        send: vi.fn((value: unknown) => {
            captured.body = value;
            return res;
        }),
        setHeader: vi.fn((name: string, value: string) => {
            captured.headers[name] = value;
            return res;
        }),
    };
    return { res: res as unknown as Response, captured };
};

// -- Fake breez.tips ---------------------------------------------------------
// The extension's only external boundary. Each address the fake knows maps
// to an LNURL-pay callback; invoices carry a verify URL unless the address is
// listed in `noVerify`, and `settled` decides what verify reports.

const fake = {
    known: new Set<string>(['dev', 'other']),
    noVerify: new Set<string>(),
    settled: new Set<string>(),
    verifyDown: false,
    commentAllowed: 255,
    invoiceRequests: [] as URL[],
    counter: 0,
    // Fake Yadio: the BTC price table fiat charges are quoted from.
    rates: { USD: 100_000, EUR: 80_000 } as Record<string, number>,
    ratesDown: false,
    /** How old the fake table claims to be. */
    ratesAgeMs: 0,
    ratesRequests: 0,
};

const jsonResponse = (status: number, body: unknown) =>
    new globalThis.Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });

const fakeFetch = async (input: unknown): Promise<globalThis.Response> => {
    const url = new URL(String(input));
    if (url.hostname === 'api.yadio.io') {
        fake.ratesRequests++;
        if (fake.ratesDown) return new globalThis.Response('<html>503</html>', { status: 503 });
        return jsonResponse(200, {
            BTC: { BTC: 1, ...fake.rates },
            base: 'BTC',
            timestamp: Date.now() - fake.ratesAgeMs,
        });
    }
    if (url.hostname !== 'breez.tips') throw new Error(`unexpected host ${url.hostname}`);

    const wellKnown = url.pathname.match(/^\/\.well-known\/lnurlp\/([^/]+)$/);
    if (wellKnown) {
        const name = decodeURIComponent(wellKnown[1]);
        if (!fake.known.has(name)) return jsonResponse(404, { status: 'ERROR', reason: 'not found' });
        return jsonResponse(200, {
            callback: `https://breez.tips/lnurlp/${name}/invoice`,
            minSendable: 1000,
            maxSendable: 100_000_000_000,
            commentAllowed: fake.commentAllowed,
            tag: 'payRequest',
        });
    }

    const invoice = url.pathname.match(/^\/lnurlp\/([^/]+)\/invoice$/);
    if (invoice) {
        fake.invoiceRequests.push(url);
        const hash = `hash${++fake.counter}`;
        const body: Record<string, unknown> = { pr: `lnbc1fake${hash}`, routes: [] };
        if (!fake.noVerify.has(invoice[1])) body.verify = `https://breez.tips/verify/${hash}`;
        return jsonResponse(200, body);
    }

    const verify = url.pathname.match(/^\/verify\/([^/]+)$/);
    if (verify) {
        if (fake.verifyDown) return new globalThis.Response('<html>502</html>', { status: 502 });
        return jsonResponse(200, { status: 'OK', settled: fake.settled.has(verify[1]) });
    }
    return jsonResponse(404, { status: 'ERROR', reason: 'unknown route' });
};

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer();
    vi.stubGlobal('fetch', fakeFetch);
});

afterAll(async () => {
    vi.unstubAllGlobals();
    await server?.shutdown();
});

afterEach(() => {
    fake.noVerify.clear();
    fake.settled.clear();
    fake.verifyDown = false;
    fake.commentAllowed = 255;
    fake.invoiceRequests = [];
    fake.rates = { USD: 100_000, EUR: 80_000 };
    fake.ratesDown = false;
    fake.ratesAgeMs = 0;
    fake.ratesRequests = 0;
    resetRatesCache();
    vi.useRealTimers();
});

/** Rewrites the stored record so its expiry lies `secondsAgo` in the past. */
const ageCharge = async (id: string, secondsAgo: number) => {
    const key = `payments:charge:${id}`;
    const stored = (await server.stores.kv.get({ key })).res as Record<string, unknown>;
    await server.stores.kv.set({
        key,
        value: { ...stored, expiresAt: new Date(Date.now() - secondsAgo * 1000).toISOString() },
    });
};

const seedUser = async () => {
    const slug = Math.random().toString(36).slice(2, 8);
    return server.stores.user.create({
        username: `payuser_${slug}`,
        uuid: uuidv4(),
        password: 'x',
        email: null,
    });
};

const seedApp = async (ownerUserId: number) => {
    const slug = Math.random().toString(36).slice(2, 8);
    return server.stores.app.create(
        {
            name: `payapp_${slug}`,
            title: `Pay App ${slug}`,
            index_url: `https://example.com/${slug}`,
        },
        { ownerUserId },
    );
};

type Row = { uuid: string; id: number };
const asUser = (user: Row, effectiveApp?: { uid: string }) => ({
    actor: {
        user: { uuid: user.uuid, id: user.id },
        effectiveApp: effectiveApp ?? null,
    },
});

const call = async (
    handler: (req: Request, res: Response) => Promise<void>,
    ctx: ReturnType<typeof asUser>,
    req: Request,
) => {
    const { res, captured } = makeRes();
    await runWithContext(ctx, () => handler(req, res));
    return captured;
};

const configure = (user: Row, address = 'dev@breez.tips') =>
    call(handleUpdateSettings, asUser(user), makeReq({ body: { lightningAddress: address } }));

const settledHashOf = (charge: { invoice: string }) => charge.invoice.replace('lnbc1fake', '');

describe('payments extension', () => {
    describe('settings', () => {
        it('defaults to no address and points at the Glow setup page', async () => {
            const user = (await seedUser()) as Row;
            const out = await call(handleGetSettings, asUser(user), makeReq());
            expect(out.body).toEqual({ lightningAddress: null, glowSetupUrl: GLOW_SETUP_URL });
        });

        it('rejects addresses outside breez.tips', async () => {
            const user = (await seedUser()) as Row;
            await expect(
                call(handleUpdateSettings, asUser(user), makeReq({ body: { lightningAddress: 'dev@walletofsatoshi.com' } })),
            ).rejects.toMatchObject({ statusCode: 400, code: 'invalid_lightning_address' });
        });

        it('rejects a breez.tips address that does not exist', async () => {
            const user = (await seedUser()) as Row;
            await expect(
                call(handleUpdateSettings, asUser(user), makeReq({ body: { lightningAddress: 'nobody@breez.tips' } })),
            ).rejects.toMatchObject({ statusCode: 404, code: 'lightning_address_not_found' });
        });

        it('stores a valid address lowercased and reads it back', async () => {
            const user = (await seedUser()) as Row;
            const saved = await configure(user, '  Dev@Breez.tips ');
            expect(saved.body).toMatchObject({ lightningAddress: 'dev@breez.tips' });
            const out = await call(handleGetSettings, asUser(user), makeReq());
            expect(out.body).toMatchObject({ lightningAddress: 'dev@breez.tips' });
        });

        it('clears the address with null', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            const out = await call(handleUpdateSettings, asUser(user), makeReq({ body: { lightningAddress: null } }));
            expect(out.body).toMatchObject({ lightningAddress: null });
        });
    });

    describe('createCharge', () => {
        it('requires a configured address when none is given', async () => {
            const user = (await seedUser()) as Row;
            await expect(
                call(handleCreateCharge, asUser(user), makeReq({ body: { amountSats: 100 } })),
            ).rejects.toMatchObject({
                statusCode: 400,
                code: 'lightning_address_not_configured',
                fields: { glowSetupUrl: GLOW_SETUP_URL },
            });
        });

        it('validates the amount', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            for (const amountSats of [0, -1, 1.5, '100', undefined]) {
                await expect(
                    call(handleCreateCharge, asUser(user), makeReq({ body: { amountSats } })),
                ).rejects.toMatchObject({ statusCode: 400, code: 'invalid_amount' });
            }
        });

        it('creates a pending charge with an invoice from the configured address', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            const out = await call(
                handleCreateCharge,
                asUser(user),
                makeReq({ body: { amountSats: 250, description: 'Coffee', metadata: { order: 7 } } }),
            );
            expect(out.status).toBe(201);
            expect(out.body).toMatchObject({
                status: 'pending',
                amountSats: 250,
                description: 'Coffee',
                metadata: { order: 7 },
                lightningAddress: 'dev@breez.tips',
                appUid: null,
                paidAt: null,
            });
            const charge = out.body as { invoice: string; cashAppUrl: string; id: string; verifyUrl?: string };
            expect(charge.invoice.startsWith('lnbc1fake')).toBe(true);
            expect(charge.cashAppUrl).toBe(`https://cash.app/launch/lightning/${charge.invoice}`);
            // The verify URL is an internal detail; it never reaches callers.
            expect(charge.verifyUrl).toBeUndefined();

            const request = fake.invoiceRequests[0];
            expect(request.searchParams.get('amount')).toBe('250000');
            expect(request.searchParams.get('expiry')).toBe(String(CHARGE_EXPIRY_SECS));
            expect(request.searchParams.get('comment')).toBe('Coffee');
        });

        it('prices a charge in fiat at the current rate, rounded up, and records the quote', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            // An exact price stays exact; a fraction of a satoshi rounds up.
            const out = await call(
                handleCreateCharge,
                asUser(user),
                makeReq({ body: { amount: 4.99, currency: 'usd', description: 'Plan' } }),
            );
            expect(out.status).toBe(201);
            expect(out.body).toMatchObject({
                amountSats: 4990,
                fiat: { amount: 4.99, currency: 'USD', rate: 100_000 },
            });
            expect(fake.invoiceRequests[0].searchParams.get('amount')).toBe('4990000');

            const eur = await call(handleCreateCharge, asUser(user), makeReq({ body: { amount: 1.2, currency: 'EUR' } }));
            expect(eur.body).toMatchObject({ amountSats: 1500, fiat: { currency: 'EUR', rate: 80_000 } });

            // 1.23 EUR at 80,000 is 1537.5 sats.
            const rounded = await call(handleCreateCharge, asUser(user), makeReq({ body: { amount: 1.23, currency: 'EUR' } }));
            expect((rounded.body as { amountSats: number }).amountSats).toBe(1538);
        });

        it('treats null price fields as absent, like every other optional field', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            const out = await call(
                handleCreateCharge,
                asUser(user),
                makeReq({ body: { amountSats: 10, amount: null, currency: null } }),
            );
            expect(out.status).toBe(201);
            expect(out.body).toMatchObject({ amountSats: 10, fiat: null });
        });

        it('rejects a fiat amount finer than the currency’s minor unit, so the shown price is the charged price', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            fake.rates.JPY = 15_000_000;
            for (const body of [
                { amount: 1.234, currency: 'USD' },
                { amount: 4.99, currency: 'JPY' },
            ]) {
                await expect(
                    call(handleCreateCharge, asUser(user), makeReq({ body })),
                ).rejects.toMatchObject({ statusCode: 400, code: 'invalid_amount' });
            }
            const yen = await call(handleCreateCharge, asUser(user), makeReq({ body: { amount: 500, currency: 'JPY' } }));
            expect(yen.body).toMatchObject({ amountSats: 3334, fiat: { amount: 500, currency: 'JPY' } });
        });

        it('names the fiat amount and its conversion when the address will not accept it', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            fake.rates.USD = 1;
            await expect(
                call(handleCreateCharge, asUser(user), makeReq({ body: { amount: 2, currency: 'USD' } })),
            ).rejects.toMatchObject({
                statusCode: 400,
                code: 'amount_out_of_range',
                message: expect.stringContaining('2 USD converts to 200000000 sats'),
            });
        });

        it('leaves fiat null on a sats-priced charge', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            const out = await call(handleCreateCharge, asUser(user), makeReq({ body: { amountSats: 10 } }));
            expect((out.body as { fiat: unknown }).fiat).toBeNull();
            expect(fake.ratesRequests).toBe(0);
        });

        it('rejects a fiat price that is malformed, mixed with sats, or in an unknown currency', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            for (const body of [
                { amount: 0, currency: 'USD' },
                { amount: -1, currency: 'USD' },
                { amount: '4.99', currency: 'USD' },
                { amount: Number.NaN, currency: 'USD' },
                { amountSats: 10, amount: 1, currency: 'USD' },
                { currency: 'USD' },
            ]) {
                await expect(
                    call(handleCreateCharge, asUser(user), makeReq({ body })),
                ).rejects.toMatchObject({ statusCode: 400, code: 'invalid_amount' });
            }
            for (const body of [
                { amount: 1 },
                { amount: 1, currency: 'dollars' },
                { amount: 1, currency: 'XXX' },
            ]) {
                await expect(
                    call(handleCreateCharge, asUser(user), makeReq({ body })),
                ).rejects.toMatchObject({ statusCode: 400, code: 'invalid_currency' });
            }
            // Nothing reached breez.tips for any of these.
            expect(fake.invoiceRequests).toHaveLength(0);
        });

        it('fails a fiat charge loudly when the rate source is down, never at a stale price', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            fake.ratesDown = true;
            await expect(
                call(handleCreateCharge, asUser(user), makeReq({ body: { amount: 1, currency: 'USD' } })),
            ).rejects.toMatchObject({ statusCode: 502, code: 'exchange_rate_unavailable' });
            // Sats-priced charges do not depend on the rate source.
            const out = await call(handleCreateCharge, asUser(user), makeReq({ body: { amountSats: 10 } }));
            expect(out.status).toBe(201);
        });

        it('rejects a rate table the source itself stamped as old', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            fake.ratesAgeMs = RATES_MAX_AGE_MS + 1000;
            await expect(
                call(handleCreateCharge, asUser(user), makeReq({ body: { amount: 1, currency: 'USD' } })),
            ).rejects.toMatchObject({ statusCode: 502, code: 'exchange_rate_unavailable' });
        });

        it('does not hammer a failing rate source: fails fast for a few seconds, then retries', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            vi.useFakeTimers({ toFake: ['Date'] });
            const create = () =>
                call(handleCreateCharge, asUser(user), makeReq({ body: { amount: 1, currency: 'USD' } }));
            fake.ratesDown = true;
            await expect(create()).rejects.toMatchObject({ code: 'exchange_rate_unavailable' });
            await expect(create()).rejects.toMatchObject({ code: 'exchange_rate_unavailable' });
            expect(fake.ratesRequests).toBe(1);

            fake.ratesDown = false;
            vi.advanceTimersByTime(RATES_RETRY_AFTER_MS + 1);
            const out = await create();
            expect(out.status).toBe(201);
            expect(fake.ratesRequests).toBe(2);
        });

        it('caches the rate table for a minute and refreshes it afterwards', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            vi.useFakeTimers({ toFake: ['Date'] });
            const create = () =>
                call(handleCreateCharge, asUser(user), makeReq({ body: { amount: 1, currency: 'USD' } }));
            await create();
            await create();
            expect(fake.ratesRequests).toBe(1);

            fake.rates = { USD: 200_000 };
            vi.advanceTimersByTime(RATES_CACHE_MS + 1);
            const out = await create();
            expect(fake.ratesRequests).toBe(2);
            expect(out.body).toMatchObject({ amountSats: 500, fiat: { rate: 200_000 } });
        });

        it('accepts a per-charge breez.tips address and refuses other domains', async () => {
            const user = (await seedUser()) as Row;
            const out = await call(
                handleCreateCharge,
                asUser(user),
                makeReq({ body: { amountSats: 10, lightningAddress: 'other@breez.tips' } }),
            );
            expect(out.body).toMatchObject({ lightningAddress: 'other@breez.tips' });
            await expect(
                call(handleCreateCharge, asUser(user), makeReq({ body: { amountSats: 10, lightningAddress: 'x@strike.me' } })),
            ).rejects.toMatchObject({ statusCode: 400, code: 'invalid_lightning_address' });
        });

        it('caps the LNURL comment at what the address allows and keeps the full description', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            fake.commentAllowed = 5;
            const out = await call(
                handleCreateCharge,
                asUser(user),
                makeReq({ body: { amountSats: 10, description: 'Coffee and cake' } }),
            );
            expect(out.body).toMatchObject({ description: 'Coffee and cake' });
            expect(fake.invoiceRequests[0].searchParams.get('comment')).toBe('Coffe');

            fake.invoiceRequests = [];
            fake.commentAllowed = 0;
            await call(handleCreateCharge, asUser(user), makeReq({ body: { amountSats: 10, description: 'Coffee' } }));
            expect(fake.invoiceRequests[0].searchParams.has('comment')).toBe(false);
        });

        it('rejects oversized metadata and overlong descriptions', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            await expect(
                call(handleCreateCharge, asUser(user), makeReq({ body: { amountSats: 10, metadata: { blob: 'x'.repeat(5000) } } })),
            ).rejects.toMatchObject({ statusCode: 400, code: 'invalid_metadata' });
            await expect(
                call(handleCreateCharge, asUser(user), makeReq({ body: { amountSats: 10, description: 'x'.repeat(256) } })),
            ).rejects.toMatchObject({ statusCode: 400, code: 'invalid_description' });
        });

        it('refuses an address whose invoices cannot be verified', async () => {
            const user = (await seedUser()) as Row;
            fake.noVerify.add('dev');
            await expect(
                call(handleCreateCharge, asUser(user), makeReq({ body: { amountSats: 10, lightningAddress: 'dev@breez.tips' } })),
            ).rejects.toMatchObject({ statusCode: 502, code: 'lightning_verify_unsupported' });
        });

        it('pays the app owner when an app creates the charge for a user', async () => {
            const developer = (await seedUser()) as Row;
            const payer = (await seedUser()) as Row;
            await configure(developer);
            const app = (await seedApp(developer.id)) as { uid: string };

            const created = await call(
                handleCreateCharge,
                asUser(payer, { uid: app.uid }),
                makeReq({ body: { amountSats: 42 } }),
            );
            expect(created.body).toMatchObject({ lightningAddress: 'dev@breez.tips', appUid: app.uid });
            const id = (created.body as { id: string }).id;

            // A payer holding the app token must not be able to redirect the payee.
            await expect(
                call(
                    handleCreateCharge,
                    asUser(payer, { uid: app.uid }),
                    makeReq({ body: { amountSats: 42, lightningAddress: 'other@breez.tips' } }),
                ),
            ).rejects.toMatchObject({ statusCode: 403, code: 'lightning_address_override_forbidden' });

            // The developer sees it in their list; the payer can read it; a stranger cannot.
            const listed = await call(handleListCharges, asUser(developer), makeReq());
            expect((listed.body as { items: { id: string }[] }).items.map((c) => c.id)).toContain(id);
            const read = await call(handleGetCharge, asUser(payer), makeReq({ params: { id } }));
            expect(read.body).toMatchObject({ id });
            const stranger = (await seedUser()) as Row;
            await expect(
                call(handleGetCharge, asUser(stranger), makeReq({ params: { id } })),
            ).rejects.toMatchObject({ statusCode: 404, code: 'charge_not_found' });
        });
    });

    describe('getCharge', () => {
        it('completes the charge once LNURL-verify reports it settled', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            const created = await call(handleCreateCharge, asUser(user), makeReq({ body: { amountSats: 10 } }));
            const charge = created.body as { id: string; invoice: string };

            const pending = await call(handleGetCharge, asUser(user), makeReq({ params: { id: charge.id } }));
            expect(pending.body).toMatchObject({ status: 'pending' });

            fake.settled.add(settledHashOf(charge));
            const paid = await call(handleGetCharge, asUser(user), makeReq({ params: { id: charge.id } }));
            expect(paid.body).toMatchObject({ status: 'completed' });
            expect((paid.body as { paidAt: string }).paidAt).toBeTruthy();

            // Settled is sticky even if verify stops answering.
            fake.settled.clear();
            const again = await call(handleGetCharge, asUser(user), makeReq({ params: { id: charge.id } }));
            expect(again.body).toMatchObject({ status: 'completed' });
        });

        it('expires an unpaid charge after its invoice expiry', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            const created = await call(handleCreateCharge, asUser(user), makeReq({ body: { amountSats: 10 } }));
            const charge = created.body as { id: string };
            await ageCharge(charge.id, 1);
            const out = await call(handleGetCharge, asUser(user), makeReq({ params: { id: charge.id } }));
            expect(out.body).toMatchObject({ status: 'expired' });
        });

        it('keeps an expired charge verifiable through the late-settlement grace', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            const created = await call(handleCreateCharge, asUser(user), makeReq({ body: { amountSats: 10 } }));
            const charge = created.body as { id: string; invoice: string };
            await ageCharge(charge.id, 1);
            const expired = await call(handleGetCharge, asUser(user), makeReq({ params: { id: charge.id } }));
            expect(expired.body).toMatchObject({ status: 'expired' });

            // The payment lands a moment later: still inside the grace, so it counts.
            fake.settled.add(settledHashOf(charge));
            const paid = await call(handleGetCharge, asUser(user), makeReq({ params: { id: charge.id } }));
            expect(paid.body).toMatchObject({ status: 'completed' });
        });

        it('stops verifying an expired charge once the grace has passed', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            const created = await call(handleCreateCharge, asUser(user), makeReq({ body: { amountSats: 10 } }));
            const charge = created.body as { id: string; invoice: string };
            await ageCharge(charge.id, LATE_SETTLEMENT_GRACE_SECS + 5);
            await call(handleGetCharge, asUser(user), makeReq({ params: { id: charge.id } }));
            fake.settled.add(settledHashOf(charge));
            const out = await call(handleGetCharge, asUser(user), makeReq({ params: { id: charge.id } }));
            expect(out.body).toMatchObject({ status: 'expired' });
        });

        it('leaves a charge pending when verify is unavailable', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            const created = await call(handleCreateCharge, asUser(user), makeReq({ body: { amountSats: 10 } }));
            const charge = created.body as { id: string; invoice: string };
            fake.settled.add(settledHashOf(charge));
            fake.verifyDown = true;
            await ageCharge(charge.id, 1);
            const out = await call(handleGetCharge, asUser(user), makeReq({ params: { id: charge.id } }));
            expect(out.body).toMatchObject({ status: 'pending' });
        });

        it('reads a charge stored before fiat pricing existed as fiat null, on read and in the list', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            const created = await call(handleCreateCharge, asUser(user), makeReq({ body: { amountSats: 10 } }));
            const id = (created.body as { id: string }).id;
            const key = `payments:charge:${id}`;
            const stored = (await server.stores.kv.get({ key })).res as Record<string, unknown>;
            delete stored.fiat;
            await server.stores.kv.set({ key, value: stored });

            const read = await call(handleGetCharge, asUser(user), makeReq({ params: { id } }));
            expect((read.body as { fiat: unknown }).fiat).toBeNull();
            const list = await call(handleListCharges, asUser(user), makeReq());
            const item = (list.body as { items: { id: string; fiat: unknown }[] }).items.find((c) => c.id === id);
            expect(item?.fiat).toBeNull();
        });

        it('does not serve the QR code to a stranger', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            const created = await call(handleCreateCharge, asUser(user), makeReq({ body: { amountSats: 10 } }));
            const charge = created.body as { id: string };
            const stranger = (await seedUser()) as Row;
            await expect(
                call(handleGetChargeQr, asUser(stranger), makeReq({ params: { id: charge.id } })),
            ).rejects.toMatchObject({ statusCode: 404, code: 'charge_not_found' });
        });

        it('serves the invoice as an SVG QR code', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            const created = await call(handleCreateCharge, asUser(user), makeReq({ body: { amountSats: 10 } }));
            const charge = created.body as { id: string };
            const out = await call(handleGetChargeQr, asUser(user), makeReq({ params: { id: charge.id } }));
            expect(out.headers['Content-Type']).toBe('image/svg+xml');
            expect(String(out.body)).toContain('<svg');
        });
    });

    describe('listCharges', () => {
        it('lists the developer’s charges newest first as a page', async () => {
            const user = (await seedUser()) as Row;
            await configure(user);
            const ids: string[] = [];
            for (const amountSats of [1, 2, 3]) {
                const out = await call(handleCreateCharge, asUser(user), makeReq({ body: { amountSats } }));
                ids.push((out.body as { id: string }).id);
                await new Promise((r) => setTimeout(r, 2));
            }
            const page = (await call(handleListCharges, asUser(user), makeReq({ query: { limit: '2', includeTotal: 'true' } })))
                .body as { items: { id: string; amountSats: number }[]; cursor?: string; total?: number };
            expect(page.items.map((c) => c.id)).toEqual([ids[2], ids[1]]);
            expect(page.total).toBe(3);
            expect(page.cursor).toBeTruthy();

            const rest = (await call(handleListCharges, asUser(user), makeReq({ query: { limit: '2', cursor: page.cursor } })))
                .body as { items: { id: string }[]; cursor?: string };
            expect(rest.items.map((c) => c.id)).toEqual([ids[0]]);
            expect(rest.cursor).toBeUndefined();
        });

        it('rejects an out-of-range limit', async () => {
            const user = (await seedUser()) as Row;
            await expect(
                call(handleListCharges, asUser(user), makeReq({ query: { limit: '0' } })),
            ).rejects.toMatchObject({ statusCode: 400, code: 'invalid_limit' });
        });
    });
});
