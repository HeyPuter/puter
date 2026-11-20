---
title: Subdomain
description: The Subdomain object containing subdomain details.
---

The `Subdomain` object containing subdomain details.

## Attributes

#### `uid` (String)

A string containing the unique identifier of the subdomain.

#### `subdomain` (String)

A string containing the name of the subdomain. This is the part of the domain that comes before the main domain name.
e.g. in `example.puter.site`, `example` is the subdomain.

#### `root_dir` (FSItem)

An FSItem object representing the root directory of the subdomain. This is the directory where the files of the subdomain are stored.

#### `custom_domains` (Array, optional)

The custom domains connected to the website, whether pending or active. Each one is an object with these attributes:

- `uuid` (String): the unique identifier of the custom domain.
- `hostname` (String): the domain, such as `www.example.com`.
- `status` (String): `pending`, `active` or `failed`, as on a [`CustomDomain`](/Objects/customdomain/).

The array is empty when the website has no custom domains. The attribute is missing when Puter couldn't look the domains up, so read a missing attribute as unknown rather than as no domains.
