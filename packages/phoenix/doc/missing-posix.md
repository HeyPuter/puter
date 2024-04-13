# Missing POSIX Functionality

### References

- [POSIX.1-2017 Chapter 2: Shell Command Language](https://pubs.opengroup.org/onlinepubs/9699919799.2018edition/utilities/V3_chap02.html)

### Shell Command Language features known to be missing from `phoenix`

- Parameter expansion
  > This is support for `$variables`, and this is **highest priority**.
- Compound commands
  > This is `if`, `case`, `while`, `for`, etc
- Arithmetic expansion
- Alias substitution

### How to Contribute

- Check the [README.md file](../README.md) for contributor guidelines.
- Additional features will require updates to
  [the parser](phoenix/src/ansi-shell/parsing).
  Right now there are repeated concerns between
  `buildParserFirstHalf` and `buildParserSecondHalf` which need to
  be factored out.
