# Type **File Name**

A filename parameter accepts a string value of any valid filename
for the Puter operating system.

## Invalid Characters

The following characters are not allowed in filenames.

### Characters not valid in major operating systems

- Windows: `<>:"/\|?*`
- POSIX: The NULL character

These characters are disallowed to prevent incompatibility with
existing systems. They are highly unlikely to appear in file trees,
as they are generally avoided for this reason.

### Control characters

ASCII characters bellow `0x20` (control characters) are not allowed
in filenames. These characters are usually invisible and may be
interpreted by applications to deal with transmission and additional
features. For example, they are understood by teletype shells.

### Characters which may be harmful

Certain unicode characters are now allowed because they may be used
to obfuscate the true nature of a file or break text rendering.

For example, unicode characters in the range `202A-202E` are used
to override the direction (left-to-right vs right-to-left) of text,
which has been used to display inaccuarte file extensions on malicious
executables to users of Windows operating systems.
