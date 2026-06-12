/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { Thumbmark } from '@thumbmarkjs/thumbmarkjs';

const FINGERPRINT_TIMEOUT = 1500;
const DFP_TELEMETRY_TIMEOUT = 2500;
// Server-side caps for the matching /signup fields; values that would be
// rejected there are dropped client-side so signup can never 400 over them.
const FINGERPRINT_MAX_LENGTH = 128;
const DFP_TELEMETRY_ID_MAX_LENGTH = 64;

// Resolves null on rejection or timeout so signup flows can await these
// signals unconditionally without ever blocking or failing on them.
const settleWithin = (promise, ms) => {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), ms);
        promise.then(
            (value) => { clearTimeout(timer); resolve(value ?? null); },
            () => { clearTimeout(timer); resolve(null); },
        );
    });
};

const asPlausible = (value, maxLength) => {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength
        ? value
        : null;
};

let fingerprint_promise = null;
const computeFingerprint = () => {
    if ( ! fingerprint_promise ) {
        // logging:false keeps the library fully offline; it would otherwise
        // send a small sample of fingerprints to thumbmarkjs.com.
        fingerprint_promise = new Thumbmark({ logging: false, timeout: FINGERPRINT_TIMEOUT })
            .get()
            .then(result => result?.thumbmark || null);
        fingerprint_promise.catch(error => {
            // Don't cache the failure — a later attempt may succeed.
            fingerprint_promise = null;
            console.debug('device fingerprint unavailable:', error);
        });
    }
    return fingerprint_promise;
};

let stytch_script_promise = null;
const loadStytchScript = () => {
    if ( ! stytch_script_promise ) {
        stytch_script_promise = window.loadScript('https://elements.stytch.com/telemetry.js');
        stytch_script_promise.catch(error => {
            // Don't cache the failure — a transient load error would
            // otherwise disable DFP for the rest of the session.
            stytch_script_promise = null;
            console.debug('Stytch telemetry script unavailable:', error);
        });
    }
    return stytch_script_promise;
};

// Telemetry ids are short-lived, so unlike the fingerprint this is fetched
// fresh on every call; only the script load itself is reused.
const fetchDfpTelemetryId = async () => {
    await loadStytchScript();
    if ( typeof window.GetTelemetryID !== 'function' ) {
        return null;
    }
    const telemetry_id = await window.GetTelemetryID({
        publicToken: window.gui_params.stytchPublicToken,
    });
    return telemetry_id || null;
};

/**
 * Installs window.getDeviceFingerprint() and window.getDfpTelemetryId(). Both
 * getters resolve to string|null and never reject. Collection is lazy: no
 * probing happens and no third-party script is loaded until a signup flow
 * actually asks. The fingerprint needs no credentials so it's on by default
 * (gui_params.thumbmarkEnabled = false is the kill switch); the Stytch
 * telemetry id requires a public token and is collected only when one is
 * configured.
 */
const init_device_signals = () => {
    window.getDeviceFingerprint = () => {
        try {
            if ( window.gui_params?.thumbmarkEnabled === false ) {
                return Promise.resolve(null);
            }
            return settleWithin(computeFingerprint(), FINGERPRINT_TIMEOUT)
                .then(value => asPlausible(value, FINGERPRINT_MAX_LENGTH));
        } catch (e) {
            return Promise.resolve(null);
        }
    };

    window.getDfpTelemetryId = () => {
        try {
            if ( ! window.gui_params?.stytchPublicToken ) {
                return Promise.resolve(null);
            }
            return settleWithin(fetchDfpTelemetryId(), DFP_TELEMETRY_TIMEOUT)
                .then(value => asPlausible(value, DFP_TELEMETRY_ID_MAX_LENGTH));
        } catch (e) {
            return Promise.resolve(null);
        }
    };
};

export default init_device_signals;
