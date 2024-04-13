## keyboard modifier translation

Encoding of modifier keys in `xterm` is done following this
table:
  encoded | keys pressed
  --------|---------------------------
  2       | Shift
  3       | Alt
  4       | Shift + Alt
  5       | Control
  6       | Shift + Control
  7       | Alt + Control
  8       | Shift + Alt + Control
  9       | Meta
  10      | Meta + Shift
  11      | Meta + Alt
  12      | Meta + Alt + Shift
  13      | Meta + Ctrl
  14      | Meta + Ctrl + Shift
  15      | Meta + Ctrl + Alt
  16      | Meta + Ctrl + Alt + Shift

This script was used to convert between more useful bit flags
and the xterm encodings of the modifiers:

```javascript
const modifier_keys = ['shift', 'ctrl', 'alt', 'meta'];
const MODIFIER = {};
for ( let i=0 ; i < modifier_keys.length ; i++ ) {
    MODIFIER[modifier_keys[i].toUpperCase()] = 1 << i;
}

const pc_modifier_list = [
    MODIFIER.SHIFT,
    MODIFIER.ALT,
    MODIFIER.CTRL,
    MODIFIER.META
];

const PC_STYLE_MODIFIER_MAP = {};

(() => {
    let i = 2;
    for ( const mod of pc_modifier_list ) {
        const new_entries = { [i++]: mod };
        for ( const key in PC_STYLE_MODIFIER_MAP ) {
            new_entries[i++] = mod | PC_STYLE_MODIFIER_MAP[key];
        }
        for ( const key in new_entries ) {
            PC_STYLE_MODIFIER_MAP[key] = new_entries[key];
        }
    }
})();

for ( const k in PC_STYLE_MODIFIER_MAP ) {
    console.log(`${k} :: ${print(PC_STYLE_MODIFIER_MAP[k])}`);
}
```

However, it was eventually determined that the PC-style function
keys, although this is not documented, really do represent bit
flags if you simply subtract 1.

For example, this situation doesn't look like it can be explained
using bit flags:
- **shift** is `2`
- **ctrl** is `5`, and has two `1` bits
- **shift** + **ctrl** is `6`
- flags don't explain this: `2 | 5 = 7`

But after subtracting `1` from each value:
- **shift** is `1`
- **ctrl** is `4`
- **shift** + **ctrl** is `5`
- flags work correctly: `1 | 4 = 5`

This is true for all examples.
