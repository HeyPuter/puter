## Backend - dev socket

The "dev socket" allows you to interact with Puter's backend by running commands.
It's a UNIX socket created in Puter's runtime directory
(typically `./volatile/runtime`, or `/var/puter` for production instances).

When in the runtime directory, you can connect to the socket with your tool
of choice. For example, using `nc` as well as `rlwrap` to get readline history:

```
rlwrap nc -U ./dev.sock
```

If it is successful you will see a message with instructions. At this point
you may enter a command. Enter the `help` command to see a list of commands.
