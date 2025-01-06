/*
 * Copyright (C) 2024 Puter Technologies Inc.
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

class ArrayLogger extends AdvancedBase {
    static PROPERTIES = {
        buffer: {
            factory: () => []
        }
    }
    static IMPLEMENTS = {
        [TLogger]: {
            log (level, message, fields, values) {
                this.buffer.push({ level, message, fields, values });
            }
        }
    }
}

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
            log (level, message, fields, values) {
                const category = fields.category;
                if ( ! this.categories[category] ) return;
                return this.delegate.log(level, message, fields, values);
            }
        }
    }
    on (category) {
        this.categories[category] = true;
    }
    off (category) {
        delete this.categories[category];
    }
}

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
            log (level, message, fields, values) {
                if ( ! this.enabled) return;
                return this.delegate.log(level, message, fields, values);
            }
        }
    }
}

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
            log (level, message, fields, values) {
                return this.delegate.log(
                    level, this.prefix + message,
                    fields, values
                );
            }
        }
    }
}

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
            log (level, message, fields, values) {
                console.log()
            }
        }
    }

    fields (fields) {
        const new_delegate = new FieldsLogger({
            fields,
            delegate: this.impl,
        });
        return new LoggerFacade({
            impl: new_delegate,
        });
    }

    info (message, ...values) {
        this.impl.log('info', message, {}, values);
    }

    on (category) {
        this.cat.on(category);
    }
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
