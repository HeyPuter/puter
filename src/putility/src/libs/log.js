const { AdvancedBase } = require("../..");
const { TLogger } = require("../traits/traits");

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

class ConsoleLogger extends AdvancedBase {
    static MODULES = {
        util: require('util'),
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

                // values
                if (values.length) {
                    str += ' ';
                    str += values
                        .map(v => util.inspect(v))
                        .join(' ');
                }

                // fields
                if (Object.keys(fields).length) {
                    str += ' ';
                    str += Object.entries(fields)
                        .map(([k, v]) => `\n  ${k}=${util.inspect(v)}`)
                        .join(' ');
                }

                this.console[l.err ? 'error' : 'log'](str);
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
            value: null
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
            adapt: v => {
                return v.as(TLogger);
            },
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
}

module.exports = {
    ArrayLogger,
    ConsoleLogger,
    FieldsLogger,
    LoggerFacade,
};
