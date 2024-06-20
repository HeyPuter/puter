# Protected Apps and Subdomains

## Protected Sites

If a site is not protected, anyone can access the site.
When a site is protected, the following changes:

- The site can only be accessed inside a Puter app iframe
- Only users with explicit permission will be able to load
  the page associated with the site.

## Protected Apps

If an app is not protected, anyone with the name of the
app or its UUID will be able to access the app.
If the app is **approved for listing** (todo: doc this)
all users can access the app.
If an app is protected, the following changes:

- The app can only be "seen" (listed) by users
  with explicit permission.
- App metadata can only be accessed by users
  with explicit permission.

Note that an app being protected does not imply that the
site is protected. If a user action results in an app
being protected it should also result in the site (subdomain)
being protected **if they own it**. If the site will not
be protected the user should have some indication.
