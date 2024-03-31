# Contributing to Puter

## Essential / General Knowledge

### Repository Dichotomy

- Puter's GUI is at the root; `/src` is the GUI
- Puter's backend is a workspace npm package;
  it resides in `packages/backend(/src)`

The above may seem counter-intuitive; backend and frontend are siblings, right?
Consider this: by a different intuition, the backend is at a "deeper" level
of function; this directory structure better adheres to soon-to-be contributors
sifting around through the files to discover "what's what".

The directory `volatile` exists _for your convenience_ to simplify running
Puter for development. When Puter is run
run with the backend with this repository as its working directory, it
will use `volatile/config` and `volatile/runtime` instead of
`/etc/puter` and `/var/puter`.

## See Next

- [Backend Documentation](../../packages/backend/doc/contributors/index.md)
<!-- - [Frontend Documentation](./frontend.md) -->
