const BaseService = require("../BaseService");

class OTPService extends BaseService {
    static MODULES = {
        otpauth: require('otpauth'),
        crypto: require('crypto'),
        ['hi-base32']: require('hi-base32'),
    }

    create_secret (label) {
        const require = this.require;
        const otpauth = require('otpauth');

        const secret = this.gen_otp_secret_();
        const totp = new otpauth.TOTP({
            issuer: 'puter.com',
            label,
            algorithm: 'SHA1',
            digits: 6,
            secret,
        });

        return {
            url: totp.toString(),
            secret,
        };
    }

    create_recovery_code () {
        const require = this.require;
        const crypto = require('crypto');
        const { encode } = require('hi-base32');

        const buffer = crypto.randomBytes(6);
        const code = encode(buffer).replace(/=/g, "").substring(0, 8);
        return code;
    }

    verify (label, secret, code) {
        const require = this.require;
        const otpauth = require('otpauth');

        const totp = new otpauth.TOTP({
            issuer: 'puter.com',
            label,
            algorithm: 'SHA1',
            digits: 6,
            secret,
        });

        const allowed = [-1, 0, 1];

        const delta = totp.validate({ token: code });
        if ( delta === null ) return false;
        if ( ! allowed.includes(delta) ) return false;
        return true;
    }

    gen_otp_secret_ () {
        const require = this.require;
        const crypto = require('crypto');
        const { encode } = require('hi-base32');

        const buffer = crypto.randomBytes(15);
        const base32 = encode(buffer).replace(/=/g, "").substring(0, 24);
        return base32;
    };
};

module.exports = { OTPService };
