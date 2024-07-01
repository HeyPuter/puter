# Puter Mods

## What is a Puter Mod?

Currently, the definition of a Puter mod is:

> A [Module](../../packages/backend/doc/contributors/modules.md)
> which is exported by a package directory which itself exists
> within a directory specified in the `mod_directories` array
> in `config.json`.

## Enabling Puter Mods

### Step 1: Update Configuration

First update the configuration (usually at `./volatile/config.json`
or `/var/puter/config.json`) to specify mod directories.

```json
{
    "config_name": "example config",

    "mod_directories": [
        "{source}/mods/mods_enabled"
    ]

    // ... other config options
}
```

The first path you'll want to add is
`"{source}/mods/mods_enabled"`
which adds all the mods included in Puter's official repository.
You don't need to change `{source}` unless your entry javascript
file is in a different location than the default.

If you want to enable all the mods, you can change the path above
to `mods_available` instead and skip step 2 below.

### Step 2: Select Mods

To enable a Puter mod, create a symbolic link (AKA symlink) in
`mods/mods_enabled`, pointing to
a directory in `mods/mods_available`. This follows the same convention
as managing sites/mods in Apache or Nginx servers.

For example to enable KDMOD (which you can read as "Kernel Dev" mod,
or "the mod that GitHub user KernelDeimos created to help with testing")
you would run this command:
```sh
ln -rs ./mods/mods_available/kdmod ./mods/mods_enabled/
```

This will create a symlink at `./mods/mods_enabled/kdmod` pointing
to the directory `./mods/mods_available/kdmod`.

> **note:** here are some helpful tips for the `ln` command:
> - You can remember `ln`'s first argument is the unaffected
>   source file by remembering `cp` and `mv` are the same in
>   this way.
> - If you don't add `-s` you get a hard link. You will rarely
>   find yourself needing to do that.
> - The `-r` flag allows you to write both paths relative to
>   the directory from which you are calling the command, which
>   is sometimes more intuitive.

