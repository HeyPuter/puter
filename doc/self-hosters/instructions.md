# Self-Hosting Puter

> [!WARNING]
> The self-hosted version of Puter is currently in alpha stage and should not be used in production yet. It is under active development and may contain bugs, other issues. Please exercise caution and use it for testing and evaluation purposes only.

### Self-Hosting Differences
Currently, the self-hosted version of Puter is different in a few ways from [Puter.com](https://puter.com):
- There is no built-in way to access apps from puter.com (see below)
- Several "core" apps are missing, such as **Code** or **Draw**
- Some assets are different

Work is ongoing to improve the **App Center** and make it available on self-hosted.
Until then, it is still possible to add apps using the **Dev Center** app.

<br/>

## Configuration

Running the server will generate a [configuration file](./config.md) in one of these locations:
- `config/config.json` when [Using Docker](#using-docker)
- `volatile/config/config.json` in [Local Development](#local-development)
- `/etc/puter/config.json` on a server (or within a Docker container)

### Domain Name

To access Puter on your device, you can simply go to the address printed in
the server console (usually `puter.localhost:4100`).

To access Puter from another device on LAN, enable the following configuration:
```json
"allow_nipio_domains": true
```

To access Puter from another device, a domain name must be configured, as well as
an `api` subdomain. For example, `example.local` might be the domain name pointing
to the IP address of the server running puter, and `api.example.com` must point to
this address as well. This domain must be specified in the configuration file
(usually `volatile/config/config.json`) as well.

See [domain configuration](./domains.md) for more information.

### Configure the Port

- You can specify a custom port by setting `http_port` to a desired value
- If you're using a reverse-proxy such as nginx or cloudflare, you should
  also set `pub_port` to the public (external) port (usually `443`)
- If you have HTTPS enabled on your reverse-proxy, ensure that
  `protocol` in config.json is set accordingly

### Default User

By default, Puter will create a user called `default_user`.
This user will have a randomly generated password, which will be printed
in the development console.
A warning will persist in the dev console until this user's
password is changed. Please login to this user and change the password as
your first step.

<br/>
