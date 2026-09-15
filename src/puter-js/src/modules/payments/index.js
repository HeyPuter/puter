/** @typedef {import('../../index.js').Puter} Puter */

import { apiRequest, requireSegment } from '../../lib/apiRequest.js';
import { PuterJSError } from '../../lib/PuterJSError.js';
import { PuterModule } from '../../lib/PuterModule.js';
import { canRenderCheckout, renderCheckout } from './checkout.js';

/** @typedef {import('./types.js').Charge} Charge */
/** @typedef {import('./types.js').CreateChargeOptions} CreateChargeOptions */
/** @typedef {import('./types.js').ListChargesOptions} ListChargesOptions */
/** @typedef {import('./types.js').ChargePage} ChargePage */
/** @typedef {import('./types.js').WaitForPaymentOptions} WaitForPaymentOptions */
/** @typedef {import('./types.js').PaymentSettings} PaymentSettings */
/** @typedef {import('./types.js').CheckoutOptions} CheckoutOptions */

const LIGHTNING_DOMAIN = 'breez.tips';
const ADDRESS_RE = /^[a-z0-9][a-z0-9._-]{0,63}@breez\.tips$/i;
const DEFAULT_POLL_MS = 2000;
// A payment in flight at expiry can still settle a little later; the server
// keeps verifying for this long, so a wait gives up only once it has passed.
const LATE_SETTLEMENT_GRACE_MS = 10 * 60 * 1000;
const FINAL_WAIT_CODES = new Set(['charge_not_found', 'unauthorized', 'permission_denied', 'invalid_request']);

const METHODS = [
    'createCharge', 'getCharge', 'listCharges', 'waitForPayment',
    'checkout', 'getSettings', 'updateSettings',
];

const req = (puter, method, route, opts = {}) =>
    apiRequest(puter, method, route, { service: 'payments', ...opts });

/** Kept identical to the server's check in extensions/payments.ts. */
const CURRENCY_RE = /^[A-Za-z]{3}$/;

/**
 * Checks the shape of the price options and returns the request body. A
 * charge is priced in satoshis (`amountSats`) or in a fiat currency (`amount`
 * + `currency`), never both. Value rules (minor units, what the address
 * accepts) are the server's; this only catches what can be caught without a
 * round trip. `null` means absent, as for every other optional field.
 */
const validateCreateOptions = (options) => {
    const hasSats = options?.amountSats != null;
    const hasFiat = options?.amount != null || options?.currency != null;
    if ( hasSats && hasFiat ) {
        throw new PuterJSError('pass either `amountSats` or `amount` with `currency`, not both', 'invalid_amount');
    }
    const body = {};
    if ( hasFiat ) {
        const { amount, currency } = options;
        if ( typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 ) {
            throw new PuterJSError('`amount` must be a positive number', 'invalid_amount');
        }
        if ( typeof currency !== 'string' || !CURRENCY_RE.test(currency) ) {
            throw new PuterJSError('`currency` must be a three-letter ISO 4217 code, like USD', 'invalid_currency');
        }
        body.amount = amount;
        body.currency = currency.toUpperCase();
    } else {
        const amountSats = options?.amountSats;
        if ( typeof amountSats !== 'number' || !Number.isInteger(amountSats) || amountSats < 1 ) {
            throw new PuterJSError('`amountSats` must be a positive integer', 'invalid_amount');
        }
        body.amountSats = amountSats;
    }
    if ( options.description !== undefined ) body.description = options.description;
    if ( options.metadata !== undefined ) body.metadata = options.metadata;
    if ( options.lightningAddress !== undefined && options.lightningAddress !== null ) {
        if ( typeof options.lightningAddress !== 'string' || !ADDRESS_RE.test(options.lightningAddress.trim()) ) {
            throw new PuterJSError(`\`lightningAddress\` must be a ${LIGHTNING_DOMAIN} address`, 'invalid_lightning_address');
        }
        body.lightningAddress = options.lightningAddress.trim().toLowerCase();
    }
    return body;
};

/**
 * Lightning payments for apps. A developer links a Glow wallet (a
 * `breez.tips` Lightning address) in the Dev Center; apps then create charges
 * that any Lightning wallet can pay, and the developer's wallet receives
 * directly. Puter never holds funds.
 */
export class PaymentsModule extends PuterModule {
    /** @param {Puter} puter */
    constructor (puter) {
        super(puter);
        const methods = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (
            /** @type {unknown} */ (this)
        );
        for ( const name of METHODS ) {
            methods[name] = methods[name].bind(this);
        }
    }

    /**
     * Creates a charge: a Lightning invoice paying into the developer's
     * `breez.tips` address (or `lightningAddress` when given). Price it in
     * satoshis with `amountSats`, or in a fiat currency with `amount` and
     * `currency`; the server converts at the current rate.
     *
     * @param {CreateChargeOptions} options
     * @returns {Promise<Charge>}
     */
    async createCharge (options) {
        const body = validateCreateOptions(options);
        return req(this.puter, 'POST', '/payments/charges', { body, operation: 'createCharge' });
    }

    /**
     * Fetches a charge with its current status. Pending charges are checked
     * against the Lightning network on every read.
     *
     * @param {string} chargeId
     * @returns {Promise<Charge>}
     */
    async getCharge (chargeId) {
        const id = requireSegment(chargeId, 'chargeId');
        return req(this.puter, 'GET', `/payments/charges/${id}`, { operation: 'getCharge' });
    }

    /**
     * Lists the caller's charges as a developer, newest first.
     *
     * @param {ListChargesOptions} [options]
     * @returns {Promise<ChargePage>}
     */
    async listCharges (options = {}) {
        const query = {};
        if ( options.limit !== undefined ) query.limit = options.limit;
        if ( options.cursor ) query.cursor = options.cursor;
        if ( options.includeTotal ) query.includeTotal = 'true';
        return req(this.puter, 'GET', '/payments/charges', { query, operation: 'listCharges' });
    }

    /**
     * Polls a charge until it is paid or expires.
     *
     * @param {string} chargeId
     * @param {WaitForPaymentOptions} [options]
     * @returns {Promise<Charge>} The completed charge. Rejects with code
     *   `charge_expired` once the invoice has expired and the late-settlement
     *   grace has passed, or `aborted`; both carry `chargeId`.
     */
    async waitForPayment (chargeId, options = {}) {
        requireSegment(chargeId, 'chargeId');
        const intervalMs = options.intervalMs ?? DEFAULT_POLL_MS;
        const { signal } = options;
        let deadline = null;
        for ( ;; ) {
            if ( signal?.aborted ) {
                throw new PuterJSError('waitForPayment aborted', 'aborted', { chargeId });
            }
            let charge = null;
            try {
                charge = await this.getCharge(chargeId);
            } catch (err) {
                // A transport or server hiccup is retried; a definitive
                // answer about the charge or the caller is final.
                if ( FINAL_WAIT_CODES.has(err?.code) ) throw err;
            }
            if ( charge ) {
                if ( charge.status === 'completed' ) return charge;
                deadline = new Date(charge.expiresAt).getTime() + LATE_SETTLEMENT_GRACE_MS;
                if ( charge.status === 'expired' ) {
                    throw new PuterJSError('Charge expired before it was paid', 'charge_expired', { chargeId });
                }
            }
            if ( deadline !== null && Date.now() >= deadline ) {
                throw new PuterJSError('Charge expired before it was paid', 'charge_expired', { chargeId });
            }
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
    }

    /**
     * Creates a charge and shows a checkout window with the QR code, a Cash
     * App button and a copyable invoice. Resolves once the payment settles.
     * Browser environments only.
     *
     * @param {CheckoutOptions} options
     * @returns {Promise<Charge>} The completed charge. Rejects with code
     *   `checkout_cancelled` or `charge_expired` (both carry `chargeId`), or
     *   `unsupported_environment` outside a browser, before any charge is
     *   created. Cancelling only closes the window; a payer who already
     *   scanned the invoice can still pay it, so reconcile by `chargeId`.
     */
    async checkout (options) {
        if ( !canRenderCheckout() ) {
            throw new PuterJSError('checkout() needs a browser document', 'unsupported_environment');
        }
        const { title, ...createOptions } = options ?? {};
        const charge = await this.createCharge(createOptions);
        return renderCheckout(this.puter, charge, { title, getCharge: this.getCharge });
    }

    /**
     * Reads the caller's developer payment settings.
     *
     * @returns {Promise<PaymentSettings>}
     */
    async getSettings () {
        return req(this.puter, 'GET', '/payments/settings', { operation: 'getSettings' });
    }

    /**
     * Sets the default `breez.tips` address charges pay into. Pass `null` to
     * clear it. The address is checked against `breez.tips` before it is
     * saved.
     *
     * @param {{ lightningAddress: string | null }} settings
     * @returns {Promise<PaymentSettings>}
     */
    async updateSettings (settings) {
        if ( settings?.lightningAddress === undefined ) {
            throw new PuterJSError('`lightningAddress` is required (pass `null` to clear it)', 'invalid_request');
        }
        const address = settings.lightningAddress;
        if ( address !== null && (typeof address !== 'string' || !ADDRESS_RE.test(address.trim())) ) {
            throw new PuterJSError(`\`lightningAddress\` must be a ${LIGHTNING_DOMAIN} address`, 'invalid_lightning_address');
        }
        const body = { lightningAddress: address === null ? null : address.trim().toLowerCase() };
        return req(this.puter, 'PUT', '/payments/settings', { body, operation: 'updateSettings' });
    }
}

/**
 * The public face of the module: derived from the class, with the internal
 * `puter` handle and the legacy `authToken` accessor omitted.
 *
 * @typedef {import('../../lib/types.js').OmitMembers<
 *     typeof PaymentsModule,
 *     'puter' | 'authToken'
 * >} PaymentsConstructor
 */

export const Payments = /** @type {PaymentsConstructor} */ (PaymentsModule);

export default Payments;
