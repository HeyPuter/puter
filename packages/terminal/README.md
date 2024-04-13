<h3 align="center"><img width="150" alt="HiTIDE logo" src="./doc/logo.png"></h3>
<h3 align="center">Puter Terminal Emulator</h3>
<p align="center">
    <a href="https://puter.com/app/terminal"><strong>« LIVE DEMO »</strong></a>
    <br />
    <br />
    <a href="https://puter.com">Puter.com</a>
    ·
    <a href="https://discord.com/invite/PQcx7Teh8u">Discord</a>
    ·
    <a href="https://reddit.com/r/puter">Reddit</a>
    ·
    <a href="https://twitter.com/HeyPuter">X (Twitter)</a>
</p>

<h3 align="center"><img alt="animated demo" src="./doc/readme-gif.gif">
</h3>

<hr>

This is a [Puter](https://puter.com)-compatible pure-javascript terminal emulator
built on [xtermjs](https://xtermjs.org/).
It integrates with an external shell provider.
We develop and test the terminal emulator alongside [Puter's shell: phoenix](https://github.com/HeyPuter/phoenix).

## The Terminal as a Whole

This terminal emulator alongside `phoenix` give you an AGPL-3.0-licensed pure-javascript
terminal experience which integrates with Puter's filesystem, AI services, and more.

Here are a few examples of what you can do:
- `ai "write me a story"`
- `txt2img "a blue computer on a cloud" > puter.png`
- `neofetch`
- `echo $(echo "command substitution")`
- `cat example.txt | grep "find me"`
- `cat example.json | jq "name"`

## Quickstart

**Note:** we've released Puter's terminal and shell very recently, so you may
run into some hurdles.
If you encounter any inconvenience we'd greatly appreciate
[an issue report](https://github.com/HeyPuter/terminal/issues/new).

The terminal emulator needs a shell to communicate with.
You can run it with Puter's shell, [phoenix](https://github.com/HeyPuter/phoenix).

1. Clone `phoenix` as a sibling directory to this repo, to get a directory
   structure like the following:
   
   ```
   my-puter-repos/
     terminal/
     phoenix/
   ```
2. Ensure you've run `npm install` in both repos
3. Install `dev-runner`
   ```
   npm install -g @heyputer/dev-runner
   ```
4. While `cd`'d into this repo, run `run-phoenix-http.json5`
   ```
   dev-runner ./run-phoenix-http.json5
   ```
5. Navigate to [http://127.0.0.1:8082](http://127.0.0.1:8082),
   and use the `login` command to access files on puter.com.

   **Note:** You will need to ensure the login popup is allowed.
   If you choose to allow it _after_ the popup was blocked,
   it will break; you need to allow always and then reload.
