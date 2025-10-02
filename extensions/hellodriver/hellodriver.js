const { kv } = extension.import('data');

/**
 * Here we create an interface called 'hello-world'. This interface
 * specifies that any implementation of 'hello-world' should implement
 * a method called `greet`. The greet method has a couple of optional
 * parameters including `subject` and `locale`. The `locale` parameter
 * is not implemented by the driver implementation in the proceeding
 * definition, showing how driver implementations don't always need
 * to support optional features.
 *
 * subject: the person to greet
 * locale: a standard locale string (ex: en_US.UTF-8)
 */
extension.on('create.interfaces', event => {
    event.createInterface('hello-world', {
        description: 'Provides methods for generating greetings',
        methods: {
            greet: {
                description: 'Returns a greeting',
                parameters: {
                    subject: {
                        type: 'string',
                        optional: true,
                    },
                    locale: {
                        type: 'string',
                        optional: true,
                    },
                },
            },
        },
    });
});

/**
 * Here we register an implementation of the `hello-world` driver
 * interface. This implementation is called "no-frills" which is
 * the most basic reasonable implementation of the interface. The
 * default return value is "Hello, World!", but if subject is
 * provided it will be "Hello, <subject>!".
 *
 * This implementation can be called from puter.js like this:
 *
 *   await puter.call('hello-world', 'no-frills', 'greet', { subject: 'Dave' });
 *
 * If you get an authorization error it's because the user you're
 * logged in as does not have permission to invoke the `no-frills`
 * implementation of `hello-world`. Users must be granted the following
 * permission to access this driver:
 *
 *   service:no-frills:ii:hello-world
 *
 * The value of `<subject>` can be one of many "special" values
 * to demonstrate capabilities of drivers or extensions, including:
 * - `%fail%`: simulate an error response from a driver
 * - `%config%`: return the effective configuration object
 */
extension.on('create.drivers', event => {
    event.createDriver('hello-world', 'no-frills', {
        greet ({ subject }) {
            return `Hello, ${subject ?? 'World'}!`;
        },
    });
});

extension.on('create.drivers', event => {
    event.createDriver('hello-world', 'extension-examples', {
        greet ({ subject }) {
            if ( subject === 'fail' ) {
                throw new Error('failing on purpose');
            }
            if ( subject === 'config' ) {
                return JSON.stringify(config ?? null);
            }

            const STR_KVSET = 'kv-set:';
            if ( subject.startsWith(STR_KVSET) ) {
                return kv.set({
                    key: 'extension-examples-test-key',
                    value: subject.slice(STR_KVSET.length),
                });
            }
            if ( subject === 'kv-get' ) {
                return kv.get({
                    key: 'extension-examples-test-key',
                });
            }

            /* eslint-disable */
            const STR_KVSET2 = 'kv-set-2:';
            if ( subject.startsWith(STR_KVSET2) ) {
                return kv.set(
                    'extension-examples-test-key',
                    subject.slice(STR_KVSET2.length),
                );
            }
            if ( subject === 'kv-get-2' ) {
                return kv.get(
                    'extension-examples-test-key',
                );
            }
            /* eslint-enable */

            return `Hello, ${subject ?? 'World'}!`;
        },
    });
});

/**
 * Here we specify that both registered and temporary users are allowed
 * to access the `no-frills` implementation of the `hello-world` driver.
 */
extension.on('create.permissions', event => {
    event.grant_to_everyone('service:no-frills:ii:hello-world');
    event.grant_to_everyone('service:extension-examples:ii:hello-world');
});
