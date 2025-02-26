### `domain`

Domain name of the Puter instance. This may be used to generate URLs
in the UI. If "allow_all_host_values" is false or undefined, the domain
will be used to validate the host header of incoming requests.

#### Examples

- `"domain": "example.com"`
- `"domain": "subdomain.example.com"`

### `protocol`

The protocol to use for URLs. This should be either "http" or "https".

#### Examples

- `"protocol": "http"`
- `"protocol": "https"`

### `static_hosting_domain`

This domain name will be used for public site URLs. For example: when
you right-click a directory and choose "Publish as Website".
This domain should point to the same server. If you have a LAN configuration
you could set this to something like
`site.192.168.555.12.nip.io`, replacing
`192.168.555.12` with a valid IP address belonging to the server.


### `allow_all_host_values`

If true, Puter will accept any host header value in incoming requests.
This is useful for development, but should be disabled in production.


### `allow_nipio_domains`

If true, Puter will allow requests with host headers that end in nip.io.
This is useful for development, LAN, and VPN configurations.


### `http_port`

The port to listen on for HTTP requests.


### `enable_public_folders`

If true, any /username/Public directory will be available to all
users, including anonymous users.


### `disable_temp_users`

If true, new users will see the login/signup page instead of being
automatically logged in as a temporary user.


### `disable_user_signup`

If true, the signup page will be disabled and the backend will not
accept new user registrations.


### `disable_fallback_mechanisms`

A general setting to prevent any fallback behavior that might
"hide" errors. It is recommended to set this to true when
debugging, testing, or developing new features.


