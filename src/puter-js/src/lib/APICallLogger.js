/*
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
 * MERCHANTABILITY or FITNESS FOR PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * APICallLogger provides centralized logging for all API calls made by the puter-js SDK.
 * It logs API calls in a simple format: service - operation - params - result
 */
class APICallLogger {
    constructor (config = {}) {
        this.config = {
            enabled: config.enabled ?? false,
            ...config,
        };
    }

    /**
     * Updates the logger configuration
     * @param {Object} newConfig - New configuration options
     */
    updateConfig (newConfig) {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * Enables API call logging
     */
    enable () {
        this.config.enabled = true;
    }

    /**
     * Disables API call logging
     */
    disable () {
        this.config.enabled = false;
    }

    /**
     * Checks if logging is enabled for the current configuration
     * @returns {boolean}
     */
    isEnabled () {
        return this.config.enabled;
    }

    /**
     * Logs the completion of an API request in a simple format
     * @param {Object} options - Request completion options
     */
    logRequest (options = {}) {
        if ( ! this.isEnabled() ) return;

        const {
            service = 'unknown',
            operation = 'unknown',
            params = {},
            result = null,
            error = null,
        } = options;

        // Format params as a readable string
        let paramsStr = '{}';
        if ( params && Object.keys(params).length > 0 ) {
            try {
                paramsStr = JSON.stringify(params);
            } catch (e) {
                paramsStr = '[Unable to serialize params]';
            }
        }

        // Format the log message with bold params
        const logMessage = `${service} - ${operation} - \x1b[1m${paramsStr}\x1b[22m`;

        if ( error ) {
            console.error(logMessage, { error: error.message || error, result });
        } else {
            console.log(logMessage, result);
        }
    }

    /**
     * Gets current logging statistics
     * @returns {Object}
     */
    getStats () {
        return {
            enabled: this.config.enabled,
            config: { ...this.config },
        };
    }
}

export default APICallLogger;