/** @typedef {import('../../index.js').Puter} Puter */

import { fetchUrl } from '../../lib/networkUtils.js';
import { PuterJSError } from '../../lib/PuterJSError.js';

const POLL_INTERVAL_MS = 2000;
// Matches the server's late-settlement grace: a charge is only given up on
// once this has passed after `expiresAt` without a definitive answer.
const LATE_SETTLEMENT_GRACE_MS = 10 * 60 * 1000;

const escapeHtml = (value) =>
    String(value).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);

const formatSats = (sats) => `${new Intl.NumberFormat().format(sats)} sats`;
const formatFiat = ({ amount, currency }) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);

/**
 * The amount block: a fiat-priced charge leads with the fiat price and shows
 * the satoshis it converted to underneath; a sats-priced one shows sats only.
 */
const amountHtml = (charge) => {
    if ( !charge.fiat ) {
        return `<p class="amount">${escapeHtml(formatSats(charge.amountSats))}</p>`;
    }
    return `<p class="amount">${escapeHtml(formatFiat(charge.fiat))}</p>`
        + `<p class="amount-sats">${escapeHtml(formatSats(charge.amountSats))}</p>`;
};

const formatCountdown = (ms) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
};

const STYLE = `
    :host { all: initial; }
    .backdrop {
        position: fixed; inset: 0; z-index: 2147483000;
        background: rgba(0, 0, 0, 0.5);
        display: flex; align-items: flex-start; justify-content: center;
        overflow-y: auto; padding: 16px 0; box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
    }
    .card {
        width: 340px; max-width: calc(100vw - 32px); margin: auto;
        background: #fff; color: #575762;
        border: 1px solid #e8e8e8; border-radius: 8px;
        box-shadow: 0 0 9px 1px rgb(0 0 0 / 21%);
        padding: 20px; box-sizing: border-box; text-align: center;
    }
    .title { font-size: 16px; font-weight: 500; color: #333; margin: 0 0 4px; }
    .desc { font-size: 13px; margin: 0 0 12px; word-break: break-word; }
    .amount { font-size: 22px; font-weight: 600; color: #333; margin: 0 0 14px; }
    .amount + .amount-sats { font-size: 13px; color: #8a8a94; margin: -10px 0 14px; }
    .qr { width: 220px; height: 220px; margin: 0 auto 6px; display: block; }
    .qr svg { width: 100%; height: 100%; display: block; }
    .qr.loading { background: #f4f4f6; border-radius: 6px; }
    .expires { font-size: 12px; color: #8a8a94; margin: 0 0 14px; }
    .button {
        display: block; width: 100%; box-sizing: border-box;
        border-radius: 4px; padding: 10px 12px; margin-bottom: 8px;
        font-size: 14px; font-weight: 500; cursor: pointer; text-decoration: none;
        border: 1px solid #ccc; background: #fafafa; color: #333;
    }
    .button:focus-visible { outline: 2px solid #088ef0; outline-offset: 2px; }
    .button-primary {
        border-color: #088ef0; color: #fff;
        background: linear-gradient(#34a5f8, #088ef0);
    }
    .button-cashapp { border-color: #00d54b; background: #00d54b; color: #fff; }
    .button-link { border: none; background: none; color: #8a8a94; font-size: 13px; margin: 4px 0 0; }
    .status { font-size: 13px; min-height: 18px; margin: 0 0 8px; word-break: break-all; }
    .invoice-copy {
        width: 100%; box-sizing: border-box; font-size: 12px; padding: 6px;
        border: 1px solid #ddd; border-radius: 4px; color: #575762; margin-bottom: 8px;
    }
    .paid .amount { color: #1ccd60; }
    .expired .amount { color: #8a8a94; }
`;

const CHECK_SVG = '<svg width="220" height="220" viewBox="0 0 220 220" role="img" aria-label="Paid"><circle cx="110" cy="110" r="100" fill="#1ccd60"/><path d="M60 115l32 32 68-72" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const EXPIRED_SVG = '<svg width="220" height="220" viewBox="0 0 220 220" role="img" aria-label="Expired"><circle cx="110" cy="110" r="100" fill="#e8e8ec"/><path d="M110 60v60l40 24" fill="none" stroke="#8a8a94" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Whether a checkout window can be rendered in this environment. */
export const canRenderCheckout = () =>
    typeof document !== 'undefined' && !!document.body;

/**
 * Renders the checkout window for a charge and settles when it is paid.
 * Browser environments only; `checkout()` checks `canRenderCheckout()` before
 * creating the charge.
 *
 * @param {Puter} puter
 * @param {import('./types.js').Charge} charge
 * @param {{ title?: string; getCharge: (id: string) => Promise<import('./types.js').Charge> }} opts
 * @returns {Promise<import('./types.js').Charge>}
 */
export function renderCheckout (puter, charge, { title, getCharge }) {
    if ( !canRenderCheckout() ) {
        throw new PuterJSError('checkout() needs a browser document', 'unsupported_environment');
    }
    const heading = title ?? 'Pay with bitcoin';
    const lightningUri = `lightning:${charge.invoice}`;

    return new Promise((resolve, reject) => {
        const host = document.createElement('div');
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = `
            <style>${STYLE}</style>
            <div class="backdrop" role="dialog" aria-modal="true" aria-label="${escapeHtml(heading)}">
                <div class="card">
                    <p class="title">${escapeHtml(heading)}</p>
                    ${charge.description ? `<p class="desc">${escapeHtml(charge.description)}</p>` : ''}
                    ${amountHtml(charge)}
                    <div class="qr loading"></div>
                    <p class="expires">Expires in <span class="countdown"></span></p>
                    <p class="status"></p>
                    <a class="button button-primary wallet" href="${escapeHtml(lightningUri)}">Open in wallet</a>
                    <a class="button button-cashapp" href="${escapeHtml(charge.cashAppUrl)}" target="_blank" rel="noopener">Pay with Cash App</a>
                    <button type="button" class="button copy">Copy invoice</button>
                    <button type="button" class="button button-link cancel">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(host);

        const $ = (sel) => root.querySelector(sel);
        const expiresAtMs = new Date(charge.expiresAt).getTime();
        const giveUpAtMs = expiresAtMs + LATE_SETTLEMENT_GRACE_MS;
        let timer = null;
        let countdownTimer = null;
        let done = false;

        const stopTimers = () => {
            clearTimeout(timer);
            clearInterval(countdownTimer);
        };
        const close = () => {
            stopTimers();
            document.removeEventListener('keydown', onKeydown, true);
            host.remove();
        };
        const closeAnd = (fn, value) => {
            if ( done ) return;
            done = true;
            close();
            fn(value);
        };
        const cancel = () => {
            closeAnd(reject, new PuterJSError('Checkout cancelled', 'checkout_cancelled', { chargeId: charge.id }));
        };
        const onKeydown = (event) => {
            if ( event.key === 'Escape' && !done ) {
                event.stopPropagation();
                cancel();
            }
        };
        document.addEventListener('keydown', onKeydown, true);

        const tickCountdown = () => {
            const left = expiresAtMs - Date.now();
            $('.countdown').textContent = left > 0 ? formatCountdown(left) : '0:00';
        };
        tickCountdown();
        countdownTimer = setInterval(tickCountdown, 1000);

        fetchUrl(`${puter.APIOrigin}/payments/charges/${encodeURIComponent(charge.id)}/qr`, {
            method: 'GET',
            includePuterAuth: true,
            logContext: { service: 'payments', operation: 'checkoutQr', params: {} },
        })
            .then((resp) => (resp.ok ? resp.text() : Promise.reject(new Error('qr'))))
            .then((svg) => {
                const qr = $('.qr');
                if ( !qr || done ) return;
                qr.classList.remove('loading');
                qr.innerHTML = svg;
            })
            .catch(() => {
                const s = $('.status');
                if ( s && !done ) s.textContent = 'QR unavailable, copy the invoice instead.';
            });

        // Clipboard access is often denied inside app iframes; fall back to a
        // selectable field the payer can copy from.
        const showInvoiceField = () => {
            if ( $('.invoice-copy') ) return;
            const field = document.createElement('input');
            field.className = 'invoice-copy';
            field.readOnly = true;
            field.value = charge.invoice;
            field.setAttribute('aria-label', 'Lightning invoice');
            $('.copy').insertAdjacentElement('afterend', field);
            field.focus();
            field.select();
        };
        $('.copy').addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(charge.invoice);
                $('.copy').textContent = 'Copied';
            } catch {
                showInvoiceField();
            }
        });
        $('.cancel').addEventListener('click', cancel);
        $('.wallet').focus();

        const showFinal = ({ className, svg, note, buttonLabel, onClose }) => {
            done = true;
            stopTimers();
            $('.card').classList.add(className);
            $('.qr').innerHTML = svg;
            $('.qr').classList.remove('loading');
            $('.expires').textContent = note;
            $('.status').textContent = '';
            for ( const sel of ['.wallet', '.button-cashapp', '.copy', '.invoice-copy'] ) $(sel)?.remove();
            const closeButton = document.createElement('button');
            closeButton.type = 'button';
            closeButton.className = 'button button-primary';
            closeButton.textContent = buttonLabel;
            closeButton.addEventListener('click', () => {
                close();
                onClose();
            });
            $('.cancel').replaceWith(closeButton);
            closeButton.focus();
        };
        const showPaid = (paid) => showFinal({
            className: 'paid',
            svg: CHECK_SVG,
            note: 'Payment received',
            buttonLabel: 'Done',
            onClose: () => resolve(paid),
        });
        const showExpired = () => showFinal({
            className: 'expired',
            svg: EXPIRED_SVG,
            note: 'This invoice expired before it was paid',
            buttonLabel: 'Close',
            onClose: () => reject(new PuterJSError('Charge expired before it was paid', 'charge_expired', { chargeId: charge.id })),
        });

        const poll = async () => {
            if ( done ) return;
            let latest = null;
            try {
                latest = await getCharge(charge.id);
            } catch {
                // A failed poll is retried on the next tick.
            }
            if ( done ) return;
            if ( latest?.status === 'completed' ) {
                showPaid(latest);
                return;
            }
            // The server keeps verifying an expired charge through the grace
            // window, so only its verdict (or the grace running out) ends the
            // wait; a verify hiccup right at expiry must not drop a payment.
            if ( latest?.status === 'expired' || Date.now() >= giveUpAtMs ) {
                showExpired();
                return;
            }
            timer = setTimeout(poll, POLL_INTERVAL_MS);
        };
        timer = setTimeout(poll, POLL_INTERVAL_MS);
    });
}
