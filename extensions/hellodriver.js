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
 */
extension.on('create.drivers', event => {
    event.createDriver('hello-world', 'no-frills', {
        greet ({ subject }) {
            if ( subject === '%fail%' ) {
                throw new Error('failing on purpose');
            }
            return `Hello, ${subject ?? 'World'}!`;
        },
    });
});
