## method `readline` from `BetterReader`

This method was meant to be a low-level line reader that simply
terminates at the first line feed character and returns the
input.

This might be useful for non-visible inputs like passwords, but
for visible inputs it is not practical unless the output stream
provided is decorated with something that can filter undesired
input characters that would move the terminal cursor.

It's especially not useful for a prompt with history, since the
up arrow should clear the input buffer and replace it with something
else.

Where this may shine is in a benchmark. The approach here doesn't
explicitly iterate over every byte, so assuming methods like
`.indexOf` and `.subarray` on TypedArray values are efficient this
would be faster than the implementation which is now used.

```javascript
    async readLine (options) {
        options = options ?? {};

        let stringSoFar = '';

        let lineFeedFound = false;
        while ( ! lineFeedFound ) {
            let chunk = await this.getChunk_();

            const iLF = chunk.indexOf(CHAR_LF);

            // do we have a line feed character?
            if ( iLF >= 0 ) {
                lineFeedFound = true;

                // defer the rest of the chunk until next read
                if ( iLF !== chunk.length - 1 ) {
                    this.chunks_.push(chunk.subarray(iLF + 1))
                }

                // (note): LF is not included in return value or next read
                chunk = chunk.subarray(0, iLF);
            }

            if ( options.stream ) {
                options.stream.write(chunk);
                if ( lineFeedFound ) {
                    options.stream.write(new Uint8Array([CHAR_LF]));
                }
            }

            const text = new TextDecoder().decode(chunk);
            stringSoFar += text;
        }

        return stringSoFar;
    }
```