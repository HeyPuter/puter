# Share Links

A **share link** is a link to Puter's origin which contains a token
in the query string (the key is `share_token`; ex:
`http://puter.localhost:4100?share_token=...`).

This token can be used to apply permissions to the user of the
current session **if and only if** this user's email is confirmed
and matches the share link's associated email.
