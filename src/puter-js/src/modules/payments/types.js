// Shapes shared across the `puter.payments` operations. JSDoc-only; no runtime exports.

/**
 * A Lightning charge. The payer settles `invoice` with any Lightning wallet
 * and the developer's own wallet receives the sats; Puter never holds funds.
 *
 * @typedef {Object} Charge
 * @property {string} id The charge's unique identifier.
 * @property {'pending' | 'completed' | 'expired'} status Whether the invoice is still payable,
 * was paid, or ran out of time.
 * @property {number} amountSats The amount in satoshis.
 * @property {string | null} description Free text shown to the payer, or `null`.
 * @property {Record<string, unknown> | null} metadata Whatever the app attached at creation, or `null`.
 * @property {string} lightningAddress The `breez.tips` address the charge pays into.
 * @property {string} invoice The BOLT11 invoice to pay.
 * @property {string} cashAppUrl A `cash.app` link that opens the invoice in Cash App.
 * @property {string | null} appUid The app that created the charge, or `null` when a user did.
 * @property {string} createdAt When the charge was created, ISO 8601.
 * @property {string} expiresAt When the invoice stops being payable, ISO 8601.
 * @property {string | null} paidAt When the payment settled, ISO 8601, or `null`.
 */

/**
 * Options for `Payments.createCharge()`.
 *
 * @typedef {Object} CreateChargeOptions
 * @property {number} amountSats The amount in satoshis, a positive integer.
 * @property {string} [description] Free text shown to the payer, at most 255 characters.
 * @property {string} [lightningAddress] A `breez.tips` address to pay into instead of the
 * developer's configured default. Only honored outside an app (a worker, an API token, the
 * developer's own session); an app's charges always pay the app owner's configured address.
 * @property {Record<string, unknown>} [metadata] Any JSON object to attach, at most 4 KB.
 */

/**
 * Options for `Payments.listCharges()`.
 *
 * @typedef {Object} ListChargesOptions
 * @property {number} [limit] Maximum charges per page, 1 to 200. Defaults to 50.
 * @property {string | null} [cursor] Continuation token from a previous page.
 * @property {boolean} [includeTotal] Adds `total` to the page.
 */

/**
 * One page of charges, newest first.
 *
 * @typedef {Object} ChargePage
 * @property {Charge[]} items The charges on this page.
 * @property {string} [cursor] Present while more pages exist.
 * @property {number} [total] Present when `includeTotal` was set.
 */

/**
 * Options for `Payments.waitForPayment()`.
 *
 * @typedef {Object} WaitForPaymentOptions
 * @property {number} [intervalMs] How often to poll, in milliseconds. Defaults to 2000.
 * @property {AbortSignal} [signal] Aborts the wait; the promise rejects with code `aborted`.
 */

/**
 * The developer's payment settings.
 *
 * @typedef {Object} PaymentSettings
 * @property {string | null} lightningAddress The default `breez.tips` address charges pay
 * into, or `null` when none is configured.
 * @property {string} glowSetupUrl Where a developer gets a Glow wallet and a `breez.tips` address.
 */

/**
 * Options for `Payments.checkout()`. Everything `createCharge()` accepts, plus
 * how the checkout window presents itself.
 *
 * @typedef {CreateChargeOptions & {
 *     title?: string;
 * }} CheckoutOptions
 */
