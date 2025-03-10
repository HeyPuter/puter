# Puter Setup Wizard

This module provides a setup wizard for Puter, making initial configuration easier for users deploying Puter for the first time.

## Features

- **Subdomain Configuration**: Configure subdomain behavior with security recommendations
- **Domain Configuration**: Set up a custom domain or use nip.io for IP-based access
- **Admin Password**: Securely set the admin user password during setup

## How It Works

The setup wizard is automatically integrated into the SelfHostedModule of Puter. When starting Puter for the first time, if setup hasn't been completed, all web requests will be redirected to the setup wizard interface.

## Usage

The setup wizard runs automatically - no special commands needed. When you access Puter for the first time, you'll be presented with the setup wizard interface.

1. Run Puter normally: `npm start`
2. Access Puter in your browser
3. If setup isn't completed, you'll see the setup wizard

## Technical Details

The wizard creates a file at `config/setup-completed` when setup is finished. Configuration is saved to `config/wizard-config.json`.

## Security Note

The wizard includes a warning about disabling subdomains, as this can reduce security. Users are encouraged to keep subdomains enabled unless their hosting environment doesn't support them.
