import { Context } from '@heyputer/backend/src/core';
import type { Actor } from '@heyputer/backend/src/core/actor';
import { HttpError } from '@heyputer/backend/src/core/http';
import { extension } from '@heyputer/backend/src/extensions';
import type { Request, Response } from 'express';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';

// Lightning payments for apps: a developer links a Glow wallet (a Lightning
// address on breez.tips), apps create charges, payers settle them with any
// Lightning wallet, and the developer's wallet receives directly. Puter never
// holds funds or keys: the invoice comes from the address's LNURL-pay
// endpoint, and settlement is observed through LNURL-verify.

const stores = extension.import('store');

/** The only Lightning address domain accepted; it is what Glow issues. */
export const LNURL_DOMAIN = 'breez.tips';
export const GLOW_SETUP_URL = 'https://breez.technology/glow/';
const CASHAPP_LIGHTNING_URL = 'https://cash.app/launch/lightning/';
/**
 * Where fiat amounts are converted. Yadio publishes the BTC price in every ISO
 * 4217 currency; the same source Glow Pay prices in.
 */
export const RATES_URL = 'https://api.yadio.io/exrates/BTC';
const RATES_HOST = 'api.yadio.io';
/** A fiat-priced charge is quoted at a rate at most this old. */
export const RATES_CACHE_MS = 60_000;
const SATS_PER_BTC = 100_000_000;

/** How long an invoice stays payable. Mirrors the LNURL `expiry` parameter. */
export const CHARGE_EXPIRY_SECS = 300;
/**
 * A payment in flight at expiry can still settle a little later, so an expired
 * charge keeps being verified for this long after `expiresAt`.
 */
export const LATE_SETTLEMENT_GRACE_SECS = 600;
/** Expired charges and their index entries are dropped after this. */
const EXPIRED_RETENTION_SECS = 90 * 24 * 3600;
const MAX_DESCRIPTION_CHARS = 255;
const MAX_METADATA_BYTES = 4096;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const LIST_REFRESH_CONCURRENCY = 5;
const UPSTREAM_TIMEOUT_MS = 10_000;

const settingsKey = (userUuid: string) => `payments:settings:${userUuid}`;
const chargeKey = (id: string) => `payments:charge:${id}`;
const indexPrefix = (developerUuid: string) =>
    `payments:index:${developerUuid}:`;
/** Newest first under an ascending key scan. */
const indexKey = (developerUuid: string, createdMs: number, id: string) =>
    `${indexPrefix(developerUuid)}${String(9_999_999_999_999 - createdMs).padStart(13, '0')}:${id}`;

export type ChargeStatus = 'pending' | 'completed' | 'expired';

/** How a charge was priced when it was created in a fiat currency. */
export interface FiatAmount {
    /** The amount in `currency`, as the app passed it. */
    amount: number;
    /** ISO 4217 code, uppercase. */
    currency: string;
    /** The price of 1 BTC in `currency` used to compute `amountSats`. */
    rate: number;
}

export interface ChargeRecord {
    id: string;
    developerUuid: string;
    appUid: string | null;
    payerUuid: string;
    lightningAddress: string;
    amountSats: number;
    /** Absent on charges created before fiat pricing existed. */
    fiat?: FiatAmount | null;
    description: string | null;
    metadata: Record<string, unknown> | null;
    invoice: string;
    verifyUrl: string;
    status: ChargeStatus;
    createdAt: string;
    expiresAt: string;
    paidAt: string | null;
}

interface PaymentSettings {
    lightningAddress: string | null;
}

interface LnurlPayInfo {
    callback: string;
    minSendable: number;
    maxSendable: number;
    commentAllowed: number;
}

interface LnurlInvoice {
    pr: string;
    verify: string;
}

// -- Upstream (breez.tips) ----------------------------------------------------

const upstreamUnavailable = (message: string, cause?: unknown) =>
    new HttpError(502, message, {
        code: 'lightning_service_unavailable',
        cause,
        noAlarm: true,
    });

const upstreamJson = async (url: string): Promise<Record<string, unknown>> => {
    // Callback and verify URLs come from the upstream response; never follow
    // them anywhere but back to the same host over TLS.
    let target: URL | null = null;
    try {
        target = new URL(url);
    } catch {
        target = null;
    }
    if (
        !target ||
        target.protocol !== 'https:' ||
        target.hostname !== LNURL_DOMAIN
    ) {
        throw upstreamUnavailable('Invalid Lightning service URL');
    }
    let resp: globalThis.Response;
    try {
        resp = await fetch(url, {
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
    } catch (cause) {
        throw upstreamUnavailable('Lightning service unreachable', cause);
    }
    if (resp.status === 404) {
        throw new HttpError(404, 'Lightning address not found', {
            code: 'lightning_address_not_found',
        });
    }
    if (!resp.ok) {
        throw upstreamUnavailable('Lightning service error');
    }
    let body: Record<string, unknown>;
    try {
        body = (await resp.json()) as Record<string, unknown>;
    } catch (cause) {
        throw upstreamUnavailable('Invalid Lightning service response', cause);
    }
    if (!body || typeof body !== 'object') {
        throw upstreamUnavailable('Invalid Lightning service response');
    }
    if (body.status === 'ERROR') {
        throw upstreamUnavailable(
            String(body.reason || 'Lightning service error'),
        );
    }
    return body;
};

export const fetchLnurlPayInfo = async (
    lightningAddress: string,
): Promise<LnurlPayInfo> => {
    const [username, domain] = lightningAddress.split('@');
    const info = await upstreamJson(
        `https://${domain}/.well-known/lnurlp/${encodeURIComponent(username)}`,
    );
    if (
        typeof info.callback !== 'string' ||
        typeof info.minSendable !== 'number' ||
        typeof info.maxSendable !== 'number'
    ) {
        throw upstreamUnavailable('Invalid LNURL-pay response');
    }
    return {
        callback: info.callback,
        minSendable: info.minSendable,
        maxSendable: info.maxSendable,
        commentAllowed:
            typeof info.commentAllowed === 'number' ? info.commentAllowed : 0,
    };
};

const requestInvoice = async (
    info: LnurlPayInfo,
    amountMsats: number,
    comment: string | null,
): Promise<LnurlInvoice> => {
    const url = new URL(info.callback);
    url.searchParams.set('amount', String(amountMsats));
    url.searchParams.set('expiry', String(CHARGE_EXPIRY_SECS));
    // The comment is a courtesy for the payer's wallet; the charge keeps the
    // full description regardless of what the LNURL server accepts.
    if (comment && info.commentAllowed > 0) {
        url.searchParams.set('comment', comment.slice(0, info.commentAllowed));
    }
    const body = await upstreamJson(url.toString());
    if (typeof body.pr !== 'string') {
        throw upstreamUnavailable('Invalid invoice response');
    }
    // Without LNURL-verify there is no way to observe settlement, so a
    // charge could never complete. Refuse rather than create a dead charge.
    if (typeof body.verify !== 'string') {
        throw new HttpError(
            502,
            'Lightning address does not support payment verification',
            { code: 'lightning_verify_unsupported', noAlarm: true },
        );
    }
    return { pr: body.pr, verify: body.verify };
};

const checkSettled = async (verifyUrl: string): Promise<boolean> => {
    const body = await upstreamJson(verifyUrl);
    return body.settled === true;
};

// -- Exchange rates (Yadio) ---------------------------------------------------

interface RatesSnapshot {
    /** BTC price per currency code. */
    rates: Record<string, number>;
    fetchedAt: number;
}

let ratesCache: RatesSnapshot | null = null;
let ratesInFlight: Promise<RatesSnapshot> | null = null;

const ratesUnavailable = (message: string, cause?: unknown) =>
    new HttpError(502, message, {
        code: 'exchange_rate_unavailable',
        cause,
        noAlarm: true,
    });

const fetchRates = async (): Promise<RatesSnapshot> => {
    const target = new URL(RATES_URL);
    if (target.protocol !== 'https:' || target.hostname !== RATES_HOST) {
        throw ratesUnavailable('Invalid exchange rate service URL');
    }
    let resp: globalThis.Response;
    try {
        resp = await fetch(RATES_URL, {
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
    } catch (cause) {
        throw ratesUnavailable('Exchange rate service unreachable', cause);
    }
    if (!resp.ok) {
        throw ratesUnavailable('Exchange rate service error');
    }
    let body: { BTC?: Record<string, unknown> };
    try {
        body = (await resp.json()) as { BTC?: Record<string, unknown> };
    } catch (cause) {
        throw ratesUnavailable('Invalid exchange rate response', cause);
    }
    const table = body?.BTC;
    if (!table || typeof table !== 'object') {
        throw ratesUnavailable('Invalid exchange rate response');
    }
    const rates: Record<string, number> = {};
    for (const [code, price] of Object.entries(table)) {
        if (code === 'BTC') continue;
        if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
            rates[code.toUpperCase()] = price;
        }
    }
    if (Object.keys(rates).length === 0) {
        throw ratesUnavailable('Invalid exchange rate response');
    }
    return { rates, fetchedAt: Date.now() };
};

/**
 * The current BTC price table, refreshed at most once a minute. Concurrent
 * callers share one upstream request. A stale table is never served past the
 * cache window: with the rate source down, fiat pricing fails rather than
 * quoting an old price.
 */
export const getRates = async (): Promise<RatesSnapshot> => {
    if (ratesCache && Date.now() - ratesCache.fetchedAt < RATES_CACHE_MS) {
        return ratesCache;
    }
    if (!ratesInFlight) {
        ratesInFlight = fetchRates()
            .then((snapshot) => {
                ratesCache = snapshot;
                return snapshot;
            })
            .finally(() => {
                ratesInFlight = null;
            });
    }
    return ratesInFlight;
};

/** Test hook: forgets the cached price table. */
export const resetRatesCache = () => {
    ratesCache = null;
    ratesInFlight = null;
};

/**
 * Converts a fiat amount to satoshis at the current rate, rounded up so the
 * developer never receives less than the price they set.
 */
const quoteFiat = async (
    amount: number,
    currency: string,
): Promise<{ amountSats: number; fiat: FiatAmount }> => {
    const { rates } = await getRates();
    const rate = rates[currency];
    if (rate === undefined) {
        throw new HttpError(400, `currency ${currency} is not supported`, {
            code: 'invalid_currency',
        });
    }
    // Binary floating point makes 4.99 * 1e8 / 100000 come out a hair above
    // 4990; shave that noise off before rounding up so an exact price stays
    // exact and only a real fraction of a satoshi rounds up.
    const exact = (amount * SATS_PER_BTC) / rate;
    const amountSats = Math.ceil(exact - 1e-6);
    if (amountSats < 1 || amountSats > 100_000_000_000) {
        throw new HttpError(
            400,
            'amount converts to an unsupported number of satoshis',
            { code: 'invalid_amount' },
        );
    }
    return { amountSats, fiat: { amount, currency, rate } };
};

// -- Validation ---------------------------------------------------------------

const ADDRESS_RE = /^[a-z0-9][a-z0-9._-]{0,63}@breez\.tips$/;

/** Lowercases and validates; only `breez.tips` addresses are accepted. */
export const normalizeLightningAddress = (value: unknown): string => {
    if (typeof value !== 'string') {
        throw new HttpError(400, 'lightningAddress must be a string', {
            code: 'invalid_lightning_address',
        });
    }
    const address = value.trim().toLowerCase();
    if (!ADDRESS_RE.test(address)) {
        throw new HttpError(
            400,
            `lightningAddress must be a ${LNURL_DOMAIN} address (name@${LNURL_DOMAIN})`,
            {
                code: 'invalid_lightning_address',
                fields: { glowSetupUrl: GLOW_SETUP_URL },
            },
        );
    }
    return address;
};

const parseAmountSats = (value: unknown): number => {
    if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 100_000_000_000
    ) {
        throw new HttpError(400, 'amountSats must be a positive integer', {
            code: 'invalid_amount',
        });
    }
    return value;
};

const CURRENCY_RE = /^[A-Za-z]{3}$/;

/**
 * A charge is priced either in satoshis (`amountSats`) or in a fiat currency
 * (`amount` + `currency`), never both.
 */
type PriceInput =
    | { kind: 'sats'; amountSats: number }
    | { kind: 'fiat'; amount: number; currency: string };

const parsePrice = (body: Record<string, unknown>): PriceInput => {
    const hasSats = body.amountSats !== undefined;
    const hasFiat = body.amount !== undefined || body.currency !== undefined;
    if (hasSats && hasFiat) {
        throw new HttpError(
            400,
            'pass either amountSats or amount with currency, not both',
            { code: 'invalid_amount' },
        );
    }
    if (!hasFiat) {
        return { kind: 'sats', amountSats: parseAmountSats(body.amountSats) };
    }
    const amount = body.amount;
    if (
        typeof amount !== 'number' ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        amount > 1_000_000_000_000
    ) {
        throw new HttpError(400, 'amount must be a positive number', {
            code: 'invalid_amount',
        });
    }
    if (typeof body.currency !== 'string' || !CURRENCY_RE.test(body.currency)) {
        throw new HttpError(
            400,
            'currency must be a three-letter ISO 4217 code, like USD',
            { code: 'invalid_currency' },
        );
    }
    return { kind: 'fiat', amount, currency: body.currency.toUpperCase() };
};

const parseDescription = (value: unknown): string | null => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > MAX_DESCRIPTION_CHARS) {
        throw new HttpError(
            400,
            `description must be a string of at most ${MAX_DESCRIPTION_CHARS} characters`,
            { code: 'invalid_description' },
        );
    }
    return value;
};

const parseMetadata = (value: unknown): Record<string, unknown> | null => {
    if (value === undefined || value === null) return null;
    if (
        typeof value !== 'object' ||
        Array.isArray(value) ||
        JSON.stringify(value).length > MAX_METADATA_BYTES
    ) {
        throw new HttpError(
            400,
            `metadata must be an object of at most ${MAX_METADATA_BYTES} bytes`,
            { code: 'invalid_metadata' },
        );
    }
    return value as Record<string, unknown>;
};

const parseLimit = (value: unknown): number => {
    if (value === undefined) return DEFAULT_LIST_LIMIT;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIST_LIMIT) {
        throw new HttpError(
            400,
            `limit must be an integer between 1 and ${MAX_LIST_LIMIT}`,
            { code: 'invalid_limit' },
        );
    }
    return n;
};

// -- Actors -------------------------------------------------------------------

const requireActor = (): Actor => {
    const actor = Context.get('actor') as Actor | undefined;
    if (!actor?.user?.uuid) {
        throw new HttpError(401, 'Authentication required', {
            code: 'unauthorized',
        });
    }
    return actor;
};

/**
 * The account whose wallet a charge pays into: the owner of the app the caller
 * acts as, or the caller when there is no app (a developer testing from their
 * own session).
 */
const resolveDeveloperUuid = async (actor: Actor): Promise<string> => {
    const appUid = actor.effectiveApp?.uid;
    if (!appUid) return actor.user.uuid as string;
    const app = (await stores.app.getByUid(appUid)) as {
        owner_user_id?: number;
    } | null;
    const ownerId = app?.owner_user_id;
    const owner = ownerId ? await stores.user.getById(ownerId) : null;
    if (!owner?.uuid) {
        throw new HttpError(404, 'App owner not found', {
            code: 'app_owner_not_found',
        });
    }
    return owner.uuid;
};

// -- Storage ------------------------------------------------------------------

const kvGet = async <T>(key: string): Promise<T | null> =>
    ((await stores.kv.get({ key })).res as T | null) ?? null;

const kvSet = async (
    key: string,
    value: unknown,
    expireAt?: number,
): Promise<void> => {
    await stores.kv.set({ key, value, expireAt });
};

export const getSettings = async (userUuid: string): Promise<PaymentSettings> =>
    (await kvGet<PaymentSettings>(settingsKey(userUuid))) ?? {
        lightningAddress: null,
    };

const saveCharge = async (
    charge: ChargeRecord,
    expireAt?: number,
): Promise<void> => {
    await kvSet(chargeKey(charge.id), charge, expireAt);
};

const loadCharge = async (id: string): Promise<ChargeRecord | null> => {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) return null;
    return kvGet<ChargeRecord>(chargeKey(id));
};

// -- Charge lifecycle ---------------------------------------------------------

const expiresAtMs = (charge: ChargeRecord) =>
    new Date(charge.expiresAt).getTime();

const withinGrace = (charge: ChargeRecord, now = Date.now()) =>
    now < expiresAtMs(charge) + LATE_SETTLEMENT_GRACE_SECS * 1000;

/**
 * Brings a charge up to date against LNURL-verify. A pending charge that is
 * past its expiry is marked expired, but stays verified through the grace
 * window since a payment in flight at expiry can still land. Transitions are
 * idempotent, so concurrent refreshes need no lock. A verify outage leaves the
 * charge as it was rather than failing the read.
 */
export const refreshCharge = async (
    charge: ChargeRecord,
): Promise<ChargeRecord> => {
    if (charge.status === 'completed') return charge;
    const now = Date.now();
    if (charge.status === 'expired' && !withinGrace(charge, now)) return charge;

    let settled = false;
    try {
        settled = await checkSettled(charge.verifyUrl);
    } catch {
        return charge;
    }
    if (settled) {
        charge.status = 'completed';
        charge.paidAt = new Date().toISOString();
        await saveCharge(charge);
        return charge;
    }
    if (charge.status === 'pending' && now >= expiresAtMs(charge)) {
        charge.status = 'expired';
        const dropAt = Math.floor(now / 1000) + EXPIRED_RETENTION_SECS;
        await saveCharge(charge, dropAt);
        await kvSet(
            indexKey(
                charge.developerUuid,
                new Date(charge.createdAt).getTime(),
                charge.id,
            ),
            charge.id,
            dropAt,
        );
    }
    return charge;
};

const toWire = (charge: ChargeRecord) => ({
    id: charge.id,
    status: charge.status,
    amountSats: charge.amountSats,
    fiat: charge.fiat ?? null,
    description: charge.description,
    metadata: charge.metadata,
    lightningAddress: charge.lightningAddress,
    invoice: charge.invoice,
    cashAppUrl: `${CASHAPP_LIGHTNING_URL}${charge.invoice}`,
    appUid: charge.appUid,
    createdAt: charge.createdAt,
    expiresAt: charge.expiresAt,
    paidAt: charge.paidAt,
});

const canReadCharge = (actor: Actor, charge: ChargeRecord): boolean =>
    actor.user.uuid === charge.developerUuid ||
    actor.user.uuid === charge.payerUuid;

const loadReadableCharge = async (
    actor: Actor,
    id: string,
): Promise<ChargeRecord> => {
    const charge = await loadCharge(id);
    if (!charge || !canReadCharge(actor, charge)) {
        throw new HttpError(404, 'Charge not found', {
            code: 'charge_not_found',
        });
    }
    return charge;
};

// -- Handlers -----------------------------------------------------------------

export const handleGetSettings = async (_req: Request, res: Response) => {
    const actor = requireActor();
    const settings = await getSettings(actor.user.uuid as string);
    res.json({ ...settings, glowSetupUrl: GLOW_SETUP_URL });
};

export const handleUpdateSettings = async (req: Request, res: Response) => {
    const actor = requireActor();
    const raw = (req.body ?? {}).lightningAddress;
    let lightningAddress: string | null = null;
    if (raw !== null && raw !== undefined && raw !== '') {
        lightningAddress = normalizeLightningAddress(raw);
        // Confirms the address exists before it is stored as the default.
        await fetchLnurlPayInfo(lightningAddress);
    }
    const settings: PaymentSettings = { lightningAddress };
    await kvSet(settingsKey(actor.user.uuid as string), settings);
    res.json({ ...settings, glowSetupUrl: GLOW_SETUP_URL });
};

export const handleCreateCharge = async (req: Request, res: Response) => {
    const actor = requireActor();
    const body = req.body ?? {};
    const price = parsePrice(body);
    const description = parseDescription(body.description);
    const metadata = parseMetadata(body.metadata);

    const developerUuid = await resolveDeveloperUuid(actor);
    let lightningAddress: string;
    if (body.lightningAddress !== undefined && body.lightningAddress !== null) {
        // An app token runs in the payer's browser, so a per-charge payee
        // from it is payer-chosen: it could make a charge paid to a stranger
        // look paid in the developer's list. Only the developer's own
        // context (session, API token, worker) may pick the address.
        if (actor.effectiveApp?.uid) {
            throw new HttpError(
                403,
                'lightningAddress cannot be set from an app; charges pay the app owner’s configured address',
                { code: 'lightning_address_override_forbidden' },
            );
        }
        lightningAddress = normalizeLightningAddress(body.lightningAddress);
    } else {
        const settings = await getSettings(developerUuid);
        if (!settings.lightningAddress) {
            throw new HttpError(
                400,
                'No Lightning address configured for this developer',
                {
                    code: 'lightning_address_not_configured',
                    fields: { glowSetupUrl: GLOW_SETUP_URL },
                },
            );
        }
        lightningAddress = settings.lightningAddress;
    }

    // Quote the fiat price right before the invoice is requested so the rate
    // stored on the charge is the one the invoice was actually made at.
    const { amountSats, fiat } =
        price.kind === 'fiat'
            ? await quoteFiat(price.amount, price.currency)
            : { amountSats: price.amountSats, fiat: null };

    const info = await fetchLnurlPayInfo(lightningAddress);
    const amountMsats = amountSats * 1000;
    if (amountMsats < info.minSendable || amountMsats > info.maxSendable) {
        throw new HttpError(
            400,
            `amountSats must be between ${Math.ceil(info.minSendable / 1000)} and ${Math.floor(info.maxSendable / 1000)}`,
            { code: 'amount_out_of_range' },
        );
    }
    const invoice = await requestInvoice(info, amountMsats, description);

    const now = Date.now();
    const charge: ChargeRecord = {
        id: uuidv4(),
        developerUuid,
        appUid: actor.effectiveApp?.uid ?? null,
        payerUuid: actor.user.uuid as string,
        lightningAddress,
        amountSats,
        fiat,
        description,
        metadata,
        invoice: invoice.pr,
        verifyUrl: invoice.verify,
        status: 'pending',
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + CHARGE_EXPIRY_SECS * 1000).toISOString(),
        paidAt: null,
    };
    await saveCharge(charge);
    await kvSet(indexKey(developerUuid, now, charge.id), charge.id);
    res.status(201).json(toWire(charge));
};

export const handleGetCharge = async (req: Request, res: Response) => {
    const actor = requireActor();
    const charge = await loadReadableCharge(actor, req.params.id as string);
    res.json(toWire(await refreshCharge(charge)));
};

export const handleGetChargeQr = async (req: Request, res: Response) => {
    const actor = requireActor();
    const charge = await loadReadableCharge(actor, req.params.id as string);
    // Uppercase lets the encoder use alphanumeric mode: a denser QR.
    const svg = await QRCode.toString(
        `LIGHTNING:${charge.invoice.toUpperCase()}`,
        { type: 'svg', errorCorrectionLevel: 'M', margin: 1 },
    );
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.send(svg);
};

/** Refreshes charges a few at a time so a dashboard page cannot fan out. */
const refreshMany = async (
    charges: ChargeRecord[],
): Promise<ChargeRecord[]> => {
    const out: ChargeRecord[] = [...charges];
    let next = 0;
    const worker = async () => {
        while (next < charges.length) {
            const i = next++;
            out[i] = await refreshCharge(charges[i]);
        }
    };
    await Promise.all(
        Array.from({ length: LIST_REFRESH_CONCURRENCY }, () => worker()),
    );
    return out;
};

export const handleListCharges = async (req: Request, res: Response) => {
    const actor = requireActor();
    const developerUuid = actor.user.uuid as string;
    const limit = parseLimit(req.query.limit);
    const cursor =
        typeof req.query.cursor === 'string' && req.query.cursor !== ''
            ? req.query.cursor
            : undefined;
    const includeTotal = req.query.includeTotal === 'true';

    const page = (
        await stores.kv.list({
            as: 'values',
            pattern: `${indexPrefix(developerUuid)}*`,
            limit,
            cursor,
            includeTotal,
        })
    ).res as { items: string[]; cursor?: string; total?: number };

    const ids = page.items.filter((id): id is string => typeof id === 'string');
    const records = ids.length
        ? ((await stores.kv.get({ key: ids.map(chargeKey) }))
              .res as (ChargeRecord | null)[])
        : [];
    const charges = await refreshMany(
        records.filter((c): c is ChargeRecord => !!c),
    );

    res.json({
        items: charges.map(toWire),
        ...(page.cursor ? { cursor: page.cursor } : {}),
        ...(page.total !== undefined ? { total: page.total } : {}),
    });
};

// -- Routes -------------------------------------------------------------------

// Developer-only surfaces: the account's own session, its full-access API
// token (a server or script acting as the developer) or a worker; never an
// app token, which runs in some other user's browser.
const developerRoute = (scope: string, limit: number) =>
    ({
        subdomain: 'api',
        requireUserActor: true,
        allowFullAccessToken: true,
        rateLimit: { scope, limit, window: 60_000, key: 'user' },
    }) as const;

const payerRoute = (scope: string, limit: number) =>
    ({
        subdomain: 'api',
        requireAuth: true,
        rateLimit: { scope, limit, window: 60_000, key: 'user' },
    }) as const;

extension.get(
    '/payments/settings',
    developerRoute('payments-settings', 60),
    handleGetSettings,
);
extension.put(
    '/payments/settings',
    developerRoute('payments-settings', 60),
    handleUpdateSettings,
);
extension.get(
    '/payments/charges',
    developerRoute('payments-list', 120),
    handleListCharges,
);
// Each create is two upstream calls and a fresh invoice on the payee's
// address, so it gets the tightest window.
extension.post(
    '/payments/charges',
    payerRoute('payments-create', 30),
    handleCreateCharge,
);
// Checkout windows poll every 2 seconds.
extension.get(
    '/payments/charges/:id',
    payerRoute('payments-read', 600),
    handleGetCharge,
);
extension.get(
    '/payments/charges/:id/qr',
    payerRoute('payments-read', 600),
    handleGetChargeQr,
);
