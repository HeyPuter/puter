import crypto from 'node:crypto';
import { HttpError } from '../HttpError.js';
import svgCaptcha from 'svg-captcha';
/**
 * Simple SVG captcha service — generates image challenges and
 * verifies one-time tokens. No external deps beyond `svg-captcha`.
 *
 * Exposed as a route option: `{ captcha: true }` on any route.
 * The middleware rejects if captcha is enabled and the request
 * doesn't carry valid captchaToken + captchaAnswer fields.
 *
 * When captcha is disabled in config, the middleware is a no-op.
 */

const EXPIRATION_MS = 10 * 60_000; // 10 minutes
const DIFFICULTY = {
    easy: { size: 4, width: 150, height: 50, noise: 1 },
    medium: { size: 6, width: 180, height: 50, noise: 2 },
    hard: { size: 7, width: 200, height: 60, noise: 3 },
};

/** token → { text, expiresAt } */
const tokens = new Map();

// Cleanup every 15 minutes
const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for ( const [k, v] of tokens.entries() ) {
        if ( v.expiresAt < now ) tokens.delete(k);
    }
}, 15 * 60_000);
cleanupTimer.unref?.();

// ── Public API ──────────────────────────────────────────────────────

/** Generate a captcha image + token pair. */
export async function generateCaptcha (difficulty = 'medium') {
    if ( ! svgCaptcha ) throw new Error('svg-captcha not available');
    const opts = DIFFICULTY[difficulty] || DIFFICULTY.medium;
    const captcha = svgCaptcha.create({
        ...opts,
        ignoreChars: '0o1ilI',
        color: true,
        background: '#f0f0f0',
    });
    const token = crypto.randomBytes(32).toString('hex');
    tokens.set(token, {
        text: captcha.text.toLowerCase(),
        expiresAt: Date.now() + EXPIRATION_MS,
    });
    return { token, image: captcha.data };
}

/** Verify a captcha answer. One-time use — token is consumed. */
export function verifyCaptcha (token, answer) {
    const entry = tokens.get(token);
    if ( ! entry ) return false;
    tokens.delete(token);
    if ( entry.expiresAt < Date.now() ) return false;
    return entry.text === answer.toLowerCase().trim();
}

// ── Route middleware ────────────────────────────────────────────────

/**
 * Captcha gate middleware factory.
 *
 * Reads `captchaToken` and `captchaAnswer` from `req.body`.
 * Rejects with 400 if missing or invalid.
 *
 * Pass `enabled` from config — when false, the gate is a no-op.
 */
export function captchaGate (enabled) {
    return (req, _res, next) => {
        if ( ! enabled ) return next();

        const { captchaToken, captchaAnswer } = req.body ?? {};
        if ( !captchaToken || !captchaAnswer ) {
            return next(new HttpError(400, 'Captcha verification required.'));
        }
        if ( ! verifyCaptcha(captchaToken, captchaAnswer) ) {
            return next(new HttpError(400, 'Invalid captcha response.'));
        }
        next();
    };
}
