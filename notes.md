## 2024-10-03

### Plan (constantly changing as per what's below)

- `signup.js` only says "email already used" if the one that's
  already been used is confirmed.
- "change email" needs to follow the same logic; show an error when
  an email already exists on an account with a confirmed email.
  Then, upon confirming the update, Ensure that in the meanwhile no
  new account came up with that email set.
- ensure `clean_email` is updated whenever the email is updated

### Email duplicate check on confirmation

- signup.js:149 -> this is where email dupe is currently checked
- signup.js:290 -> This is where we send the confirmation email.
    There is also a branch that sends a "confirm token".
    I don't recall what this is for.

### Investigating the "confirm token"

- email template is `email_verification_code`
    instead of `email_verification_link`
- This happens when either:
  - user.requires_email_confirmation is TRUE
  - send_confirmation_code is TRUE in REQUEST

### Figuring out when `requires_email_confirmation` is TRUE

I'm mostly curious about this state on a user.
It's strange that `signup.js` would do anything on EXISTING users.

1. `pseudo_user` may be populated if `req.body.email` exists
   AND a user with no password exists with that email
2. `uuid_user` may be populated if a user exists with the specified
   UUID, but it has no usefulness unless `uuid_user` has the same
   id as `pseudo_user`.
    
`uuid_user` is only used to set `email_confirmation_required` to 0
  IFF `pseudo_user` has same id as `uuid_user`
  AND `psuedo_user` has an email

When does `pseudo_user` have an email?

### Figuring out when a pseudo user can have an email
- asking NJ, I'm at a loss on this one for the moment

### Figuring out if account takeover is possible on signup.js with a uuid
- Nope, looks like `uuid_user` is only used to set
  `email_confirmation_required = 0`

### Figuring out when `send_confirmation_code` is TRUE in REQUEST
- IFF `require_email_verification_to_publish_website` is TRUE
  - it's not currently, but we need this to be possible to enable
- ^ That seems to be the ONLY place when this matters

### Current Thoughts

- `email_verification_code` will be difficult to test because there is
  nothing currently in the system that's using it. However, I could try
  enabling `require_email_verification_to_publish_website` locally and
  see if this behavior begins to work as expected.

- `email_verification_link` where we can confirm an email. If another email
  was already confirmed since the time the link was sent, we need to display
  an error message to the user.

### Find places where (on backend) email change process is triggered

Right now there are two handlers:
- `/user-protected/change-email` (UserProtectedEndpointsService)
  - Invokes the process (sends confirmation email)
- `/change_email/confirm` (PuterAPIService)
  - Endpoint that the email link points to
