# Configuring Domains for Self-Hosted Puter

## Local Network Configuration

### Prerequisite Conditions

Ensure the hosting device has a static IP address to prevent potential connectivity issues due to IP changes. This setup will enable seamless access to Puter and its services across your local network.

### Using Hosts Files

The hosts file is a straightforward way to map domain names to IP addresses on individual devices. It's simple to set up but requires manual changes on each device that needs access to the domains.

#### Windows
1. Open Notepad as an administrator.
2. Open the file located at `C:\Windows\System32\drivers\etc\hosts`.
3. Add lines for your domain and subdomain with the server's IP address, in the
   following format:
   ```
   192.168.1.10 puter.local
   192.168.1.10 api.puter.local
   ```

#### For macOS and Linux:
1. Open a terminal.
2. Edit the hosts file with a text editor, e.g., `sudo nano /etc/hosts`.
3. Add lines for your domain and subdomain with the server's IP address, in the
   following format:
   ```
   192.168.1.10 puter.local
   192.168.1.10 api.puter.local
   ```
4. Save and exit the editor.


### Using Router Configuration

Some routers allow you to add custom DNS rules, letting you configure domain names network-wide without touching each device.

1. Access your router’s admin interface (usually through a web browser).
2. Look for DNS or DHCP settings.
3. Add custom DNS mappings for `puter.local` and `api.puter.local` to the hosting device's IP address.
4. Save the changes and reboot the router if necessary.

This method's availability and steps may vary depending on your router's model and firmware.

### Using Local DNS

Setting up a local DNS server on your network allows for flexible and scalable domain name resolution. This method works across all devices automatically once they're configured to use the DNS server.

#### Options for DNS Software:

- **Pi-hole**: Acts as both an ad-blocker and a DNS server. Ideal for easy setup and maintenance.
- **BIND9**: Offers comprehensive DNS server capabilities for complex setups.
- **dnsmasq**: Lightweight and suitable for smaller networks or those new to running a DNS server.

**contributors note:** feel free to add any software you're aware of
which might help with this to the list. Also, feel free to add instructions here for specific software; our goal is for Puter to be easy to setup with tools you're already familiar with.

#### General Steps:

1. Choose and install DNS server software on a device within your network.
2. Configure the DNS server to resolve `puter.local` and `api.puter.local` to the IP address of your Puter hosting device.
3. Update your router's DHCP settings to distribute the DNS server's IP address to all devices on the network.

By setting up a local DNS server, you gain the most flexibility and control over your network's domain name resolution, ensuring that all devices can access Puter and its API without manual configuration.

## Production Configuration

Please note the self-hosting feature is still in alpha and a public production
deployment is not recommended at this time. However, if you wish to host
publicly you can do so following the same steps you normally would to configure
a domain name and ensuring the `api` subdomain points to the server as well.
