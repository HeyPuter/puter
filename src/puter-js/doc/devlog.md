## 2024-10-14

### Letting Puter Desktop Control Client FS Cache

#### Move Context to `putility`

The Filesystem module for puter.js will need to check `puter.env` to determine
whether it's delegating client FS calls to Puter's API or Puter's Desktop via
postMessage. `env` was already being passed to the Filesystem module via its
constructor but the constructor had no reference to it; having only looked at
the constructor itself and not where its initialized, I didn't realize this
and started working on another way to pass it.

I decided to add Context which will allow us to incrementally migrate all the
modules to a situation where the things available to modules generally is one
piece of information in the code, and doesn't need to be repeated for each
constructor call manually.

### What happens when apps make FS calls to Puter's desktop?

I'm going to describe a problem that I overlooked before I started working on
this. If `env` is `"app"`, then we delegate filesystem calls to Puter's desktop
so that caching is centralized and all apps can benefit from the cache. Okay,
that's great, but... **Puter Desktop has user privileges, not app privileges.**

With this, I see a couple of options:
- Puter desktop makes the call to check ACL
  - we don't expose this yet
    we need to ensure it doesn't expose the existence of files for which the
    actor does not have "see" permission.
- Apps maintain their own cache

In either case, apps need to be able to subscribe to filesystem events for
cache invalidation. This means the file/location relevant to the event needs
an ACL check either way. It seems there is no choice but to allow Puter Desktop
to expose ACL.

I thought about adding this to `/stat` - i.e. Desktop can pass an app ID and
get information about what kind of access the app has - but that would incur
additional database calls for no reason, especially if Desktop really does
have that entry cached already.

This will require a new endpoint then: `/auth/check-app-acl`. I'll put it in
PermissionAPIService for now. It seems a little out of place there but it
also doesn't seem to make sense to create a new service for it.
This method may eventually be deprecated if we find out apps need to be
able to perform ACL checks on behalf of delegate apps, in which case we might
create a more general-purpose `/auth/check-acl` endpoint that can cover
both cases.
