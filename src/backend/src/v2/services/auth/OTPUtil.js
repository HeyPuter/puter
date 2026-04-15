import { TOTP } from 'otpauth';
import crypto from 'node:crypto';
import { encode } from 'hi-base32';

/**
 * Standalone OTP utilities — no service class, just functions.
 * Ported from v1's OTPService but without the BaseService dependency.
 */

export function createSecret (label) {
    const secret = genOtpSecret();
    const totp = new TOTP({
        issuer: 'puter.com',
        label,
        algorithm: 'SHA1',
        digits: 6,
        secret,
    });
    return { url: totp.toString(), secret };
}

export function createRecoveryCode () {
    const buffer = crypto.randomBytes(6);
    return encode(buffer).replace(/=/g, '').substring(0, 8);
}

export function verify (label, secret, code) {
    const totp = new TOTP({
        issuer: 'puter.com',
        label,
        algorithm: 'SHA1',
        digits: 6,
        secret,
    });
    const delta = totp.validate({ token: code });
    if ( delta === null ) return false;
    return [-1, 0, 1].includes(delta);
}

export function hashRecoveryCode (code) {
    return crypto
        .createHash('sha256')
        .update(code)
        .digest('base64')
        .slice(0, 22);
}

function genOtpSecret () {
    const buffer = crypto.randomBytes(15);
    return encode(buffer).replace(/=/g, '').substring(0, 24);
}
