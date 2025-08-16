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
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const { AdvancedBase } = require("../AdvancedBase");
const { TLogger, AS } = require("../traits/traits");

/**
 * Logger implementation that stores log entries in an internal array buffer.
 * Useful for testing or collecting log entries for later processing.
 */
class ArrayLogger extends AdvancedBase {
    static PROPERTIES = {
        buffer: {
            factory: () => []
        }
    }
    static IMPLEMENTS = {
        [TLogger]: {
            /**
             * Logs a message by storing it in the internal buffer array.
             * @param {string} level - The log level (e.g., 'info', 'warn', 'error')
             * @param {string} message - The log message
             * @param {Object} fields - Additional fields to include with the log entry
             * @param {Array} values - Additional values to log
             */
            log (level, message, fields, values) {
                this.buffer.push({ level, message, fields, values });
            }
        }
    }
}

/**
 * Logger that filters log entries based on enabled categories.
 * Only logs messages for categories that have been explicitly enabled.
 */
class CategorizedToggleLogger extends AdvancedBase {
    static PROPERTIES = {
        categories: {
            description: 'categories that are enabled',
            factory: () => ({})
        },
        delegate: {
            construct: true,
            value: null,
            adapt: v => AS(v, TLogger),
        }
    }
    static IMPLEMENTS = {
        [TLogger]: {
            /**
             * Logs a message only if the category specified in fields is enabled.
             * @param {string} level - The log level
             * @param {string} message - The log message
             * @param {Object} fields - Fields object that should contain a 'category' property
             * @param {Array} values - Additional values to log
             * @returns {*} Result from delegate logger if category is enabled, undefined otherwise
             */
            log (level, message, fields, values) {
                const category = fields.category;
                if ( ! this.categories[category] ) return;
                return this.delegate.log(level, message, fields, values);
            }
        }
    }
    /**
     * Enables logging for the specified category.
     * @param {string} category - The category to enable
     */
    on (category) {
        this.categories[category] = true;
    }
    /**
     * Disables logging for the specified category.
     * @param {string} category - The category to disable
     */
    off (category) {
        delete this.categories[category];
    }
}

/**
 * Logger that can be enabled or disabled globally.
 * When disabled, all log messages are ignored.
 */
class ToggleLogger extends AdvancedBase {
    static PROPERTIES = {
        enabled: {
            construct: true,
            value: true
        },
        delegate: {
            construct: true,
            value: null,
            adapt: v => AS(v, TLogger),
        }
    }
    static IMPLEMENTS = {
        [TLogger]: {
            /**
             * Logs a message only if the logger is enabled.
             * @param {string} level - The log level
             * @param {string} message - The log message
             * @param {Object} fields - Additional fields to include
             * @param {Array} values - Additional values to log
             * @returns {*} Result from delegate logger if enabled, undefined otherwise
             */
            log (level, message, fields, values) {
                if ( ! this.enabled) return;
                return this.delegate.log(level, message, fields, values);
            }
        }
    }
}

/**
 * Logger that outputs formatted messages to the console.
 * Supports colored output using ANSI escape codes and different log levels.
 */
class ConsoleLogger extends AdvancedBase {
    static MODULES = {
        // This would be cool, if it worked in a browser.
        // util: require('util'),

        util: {
            inspect: v => v,
            // inspect: v => {
            //     if (typeof v === 'string') return v;
            //     try {
            //         return JSON.stringify(v);
            //     } catch (e) {}
            //     return '' + v;
            // }
        }
    }
    static PROPERTIES = {
        console: {
            construct: true,
            factory: () => console
        },
        format: () => ({
            info: {
                ansii: '\x1b[32;1m',
            },
            warn: {
                ansii: '\x1b[33;1m',
            },
            error: {
                ansii: '\x1b[31;1m',
                err: true,
            },
            debug: {
                ansii: '\x1b[34;1m',
            },
        }),
    }
    static IMPLEMENTS = {
        [TLogger]: {
            /**
             * Logs a formatted message to the console with color coding based on log level.
             * @param {string} level - The log level (info, warn, error, debug)
             * @param {string} message - The main log message
             * @param {Object} fields - Additional fields to display
             * @param {Array} values - Additional values to pass to console
             */
            log (level, message, fields, values) {
                const require = this.require;
                const util = require('util');
                const l = this.format[level];
                let str = '';
                str += `${l.ansii}[${level.toUpperCase()}]\x1b[0m `;
                str += message;

                // fields
                if (Object.keys(fields).length) {
                    str += ' ';
                    str += Object.entries(fields)
                        .map(([k, v]) => `\n  ${k}=${util.inspect(v)}`)
                        .join(' ') + '\n';
                }

                (this.console ?? console)[l.err ? 'error' : 'log'](str, ...values);
            }
        }
    }
}

/**
 * Logger that adds a prefix to all log messages before delegating to another logger.
 */
class PrefixLogger extends AdvancedBase {
    static PROPERTIES = {
        prefix: {
            construct: true,
            value: ''
        },
        delegate: {
            construct: true,
            value: null,
            adapt: v => AS(v, TLogger),
        }
    }
    static IMPLEMENTS = {
        [TLogger]: {
            /**
             * Logs a message with the configured prefix prepended to the message.
             * @param {string} level - The log level
             * @param {string} message - The original message
             * @param {Object} fields - Additional fields to include
             * @param {Array} values - Additional values to log
             * @returns {*} Result from the delegate logger
             */
            log (level, message, fields, values) {
                return this.delegate.log(
                    level, this.prefix + message,
                    fields, values
                );
            }
        }
    }
}

/**
 * Logger that adds default fields to all log entries before delegating to another logger.
 */
class FieldsLogger extends AdvancedBase {
    static PROPERTIES = {
        fields: {
            construct: true,
            factory: () => ({})
        },
        delegate: {
            construct: true,
            value: null,
            adapt: v => AS(v, TLogger),
        }
    }

    static IMPLEMENTS = {
        [TLogger]: {
            /**
             * Logs a message with the configured default fields merged with provided fields.
             * @param {string} level - The log level
             * @param {string} message - The log message
             * @param {Object} fields - Additional fields that will be merged with default fields
             * @param {Array} values - Additional values to log
             * @returns {*} Result from the delegate logger
             */
            log (level, message, fields, values) {
                return this.delegate.log(
                    level, message,
                    Object.assign({}, this.fields, fields),
                    values,
                );
            }
        }
    }
}

/**
 * Facade that provides a convenient interface for logging operations.
 * Supports method chaining and category management.
 */
class LoggerFacade extends AdvancedBase {
    static PROPERTIES = {
        impl: {
            value: () => {
                return new ConsoleLogger();
            },
            adapt: v => AS(v, TLogger),
            construct: true,
        },
        cat: {
            construct: true,
        },
    }

    static IMPLEMENTS = {
        [TLogger]: {
            /**
             * Basic log implementation (currently just outputs to console).
             * @param {string} level - The log level
             * @param {string} message - The log message
             * @param {Object} fields - Additional fields
             * @param {Array} values - Additional values
             */
            log (level, message, fields, values) {
                console.log()
            }
        }
    }

    /**
     * Creates a new logger facade with additional default fields.
     * @param {Object} fields - Default fields to add to all log entries
     * @returns {LoggerFacade} New logger facade instance with the specified fields
     */
    fields (fields) {
        const new_delegate = new FieldsLogger({
            fields,
            delegate: this.impl,
        });
        return new LoggerFacade({
            impl: new_delegate,
        });
    }

    /**
     * Logs an info-level message.
     * @param {string} message - The message to log
     * @param {...*} values - Additional values to include in the log
     */
    info (message, ...values) {
        this.impl.log('info', message, {}, values);
    }

    /**
     * Enables logging for a specific category.
     * @param {string} category - The category to enable
     */
    on (category) {
        this.cat.on(category);
    }
    /**
     * Disables logging for a specific category.
     * @param {string} category - The category to disable
     */
    off (category) {
        this.cat.off(category);
    }
}

module.exports = {
    ArrayLogger,
    CategorizedToggleLogger,
    ToggleLogger,
    ConsoleLogger,
    PrefixLogger,
    FieldsLogger,
    LoggerFacade,
};
