export default [
    {
        key: 'domain',
        description: `
            Domain name of the Puter instance. This may be used to generate URLs
            in the UI. If "allow_all_host_values" is false or undefined, the domain
            will be used to validate the host header of incoming requests.
        `,
        example_values: [
            'example.com',
            'subdomain.example.com'
        ]
    },
    {
        key: 'protocol',
        description: `
            The protocol to use for URLs. This should be either "http" or "https".
        `,
        example_values: [
            'http',
            'https'
        ]
    },
    {
        key: 'static_hosting_domain',
        description: `
            This domain name will be used for public site URLs. For example: when
            you right-click a directory and choose "Publish as Website".
            This domain should point to the same server. If you have a LAN configuration
            you could set this to something like
            \`site.192.168.555.12.nip.io\`, replacing
            \`192.168.555.12\` with a valid IP address belonging to the server.
        `
    },
    {
        key: 'allow_all_host_values',
        description: `
            If true, Puter will accept any host header value in incoming requests.
            This is useful for development, but should be disabled in production.
        `,
    },
    {
        key: 'allow_nipio_domains',
        description: `
            If true, Puter will allow requests with host headers that end in nip.io.
            This is useful for development, LAN, and VPN configurations.
        `
    },
    {
        key: 'http_port',
        description: `
            The port to listen on for HTTP requests.
        `,
    },
    {
        key: 'enable_public_folders',
        description: `
            If true, any /username/Public directory will be available to all
            users, including anonymous users.
        `
    },
    {
        key: 'disable_temp_users',
        description: `
            If true, new users will see the login/signup page instead of being
            automatically logged in as a temporary user.
        `
    },
    {
        key: 'disable_user_signup',
        description: `
            If true, the signup page will be disabled and the backend will not
            accept new user registrations.
        `
    },
    {
        key: 'disable_fallback_mechanisms',
        description: `
            A general setting to prevent any fallback behavior that might
            "hide" errors. It is recommended to set this to true when
            debugging, testing, or developing new features.
        `
    }
]