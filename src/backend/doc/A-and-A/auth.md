# Authentication Documentation

## Concepts

### Actor

An "Actor" is an entity that can be authenticated. The following types of
actors are currently supported by Puter:
- **UserActorType** - represents a user and is identified by a user's UUID
- **AppUnderUserActorType** - represents an app running in an iframe from a
  `puter.site` domain or another origin and is identified by a user's UUID
  and an app's UUID together.
- **AccessTokenActorType** - not widely currently, but Puter supports
  a concept called "access tokens". Any user can create an access token and
  then grant any permissions they want to that access token. The access
  token will have those permissions granted provided that the user who
  created the access token does as well (via permission cascade)
- **SiteActorType** - represents a `puter.site` website accessing Puter's API.
- **SystemActorType** - internal representation of the actor during a privileged
  backend operation. This actor cannot be authenticated in a request.
  This actor does not represent the `system` user.

### Token

- **Legacy** - legacy tokens result in an error response
- **Session** - this token is a JWT with a claim for the UUID of an entry in
  server memory or the database that we call a "session". This entry associates
  the token to a user and some metadata for security auditing purposes.
  Revoking the session entry disables the token.
  This type of token resolves to an actor with **UserActorType**.
- **AppUnderUser** - this token is a JWT with a claim for an app UUID and a
  claim for a session UUID.
  Revoking the session entry disables the token.
  This type of token resolves to an actor with **AppUnderUserActorType**.
- **AccessToken** - this token is a JWT with three claims:
  - A session UUID
  - An optional App UUID
  - A UUID representing the access token for permission associations
  The session or session+app creates a **UserActorType** or
  **AppUnderUserActorType** actor respectively. This actor is called
  the "authorizor". This actor is aggregated by an **AccessTokenActorType**
  actor which becomes the effective actor for a request.
- **ActorSite** - this token is a JWT with a claim for a site UID.
  The site UID is associated with an origin, generally a `puter.site`
  subdomain.

## Components

### Auth Middleware

There have so far been three iterations of the authentication middleware:
- `src/backend/src/middleware/auth.js`
- `src/backend/src/middleware/auth2.js`
- `src/backend/src/middleware/configurable_auth.js`

The newest implementation is `configurable_auth` and eventually the other
two will be removed. There is no legacy behavior involved:
- `auth` was rewritten to use `auth2`
- `auth2` was rewritten to use `configurable_auth`

The `configurable_auth` middleware accepts a parameter that can be specified
if an endpoint is optionally authenticated. In this case, the request's
`actor` will be `undefined` if there was no information for authentication.
