---
title: CustomDomain
description: The CustomDomain object containing the details of a domain connected to a website.
---

The `CustomDomain` object describes a domain the user owns that serves one of their websites hosted on Puter. The [`puter.hosting.attach()`](/Hosting/attach/) method resolves to it.

## Attributes

#### `uuid` (String)

The unique identifier of the custom domain.

#### `hostname` (String)

The domain, such as `www.example.com`.

#### `site` (String)

The name of the website the domain serves, such as `example` for `example.puter.site`.

#### `status` (String)

The state of the domain. It's one of the following:

- `pending` until the DNS records are set and the domain is verified.
- `active` once the domain serves the website.
- `failed` when the domain can't be verified. The `statusDetail` attribute says why.

#### `statusDetail` (String | null)

Why the domain isn't active yet, when that's known.

#### `isApex` (Boolean)

`true` when the hostname is a root domain such as `example.com`. A root domain can't use a regular `CNAME` record, so its DNS provider has to support `CNAME` flattening, `ALIAS`, or `ANAME` records.

#### `records` (Array)

The DNS records to set at the domain's DNS provider. Each record is an object with these attributes:

- `type` (String): `CNAME`, `TXT` or `A`.
- `name` (String): the record's name.
- `value` (String): the record's value.
- `purpose` (String): `routing` for the record that sends traffic to the website, `ownership` for the record that proves the user owns the domain, `certificate` for a record that speeds up issuing the HTTPS certificate, or `redirect` for the `A` record that forwards a root domain to its `www.` hostname.
- `required` (Boolean): `true` for the `routing`, `ownership` and `redirect` records, which the user has to set. A `certificate` record is optional.

#### `createdAt` (Number)

When the domain was added, in milliseconds since the Unix epoch.

#### `activatedAt` (Number | null)

When the domain became active, in milliseconds since the Unix epoch, or `null` if it isn't active.

#### `dnsProvider` (String, optional)

Who hosts the DNS of a root domain: `route53`, `godaddy` or `other`. Puter looks this up when a root domain is added, and only includes it in that response. Route 53 and GoDaddy can't point a root domain at another host name, so a root domain on either is added as its `www.` hostname (see `redirectFrom`).

#### `redirectFrom` (String, optional)

The root domain that forwards to this `www.` hostname. A root domain hosted on Route 53 or GoDaddy is added as its `www.` hostname, and the user can switch any other root domain to `www.` in the dialog. The `records` then include an `A` record that forwards the root domain.
