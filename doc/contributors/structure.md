# Repository Structure and Tooling

Puter has many of its parts in a single [monorepo](https://en.wikipedia.org/wiki/Monorepo),
rather than a single repository for each cohesive part.
We feel this makes it easier for new contributors to develop Puter since you don't
need to figure out how to tie the parts together or how to work with Git submodules.
It also makes it easier for us to maintain project-wide conventions and tooling.

Some tools, like [puter-cli](https://github.com/HeyPuter/puter-cli), exist in separate
repositories. The `puter-cli` tool is used externally and can communicate with Puter's
API on our production (puter.com) instance or your own instance of Puter, so there's
not really any advantage to putting it in the monorepo.

## Top-Level directories

### The `doc` directory

The top-level `doc` directory contains the file you're reading right now.
Its scope is documentation for using and contributing to Puter in general,
and linking to more specific documentation in other places.

All `doc` directories will have a `README.md` which should be considered as
the index file for the documentation. All documentation under a `doc`
directory should be accessible via a path of links starting from `README.md`.

### The `src` directory

Every directory under `/tools` is [an npm "workspaces" module](https://docs.npmjs.com/cli/v8/using-npm/workspaces). Every direct child of this directory (generally) has a `package.json` and a `src` directory.

Some of these modules are core pieces of Puter:
- **Puter's backend** is [`/src/backend`](/src/backend)
- **Puter's GUI** is [`/src/gui`](/src/gui)

Some of these modules are apps:
- **Puter's Terminal**: [`/src/terminal`](/src/terminal)
- **Puter's Shell**: [`/src/phoenix`](/src/phoenix)
- **Experimental v86 Integration**: [`/src/emulator`](/src/emulator)
  - **Note:** development is focused on Puter PDE files instead (docs pending)

Some of these modules are libraries:
- **common javascript**: [`/src/putility`](/src/putility)
- **runtime import mechanism**: [`/src/useapi`](/src/useapi)
- **Puter's "puter.js" browser SDK**: [`/src/puter-js`](/src/puter-js)

### The `volatile` directory

When you're running Puter with development instructions (i.e. `npm start`),
Puter's configuration directory will be `volatile/config` and Puter's
runtime directory will be `volatile/runtime`, instead of the standard
`/etc/puter` and `/var/puter` directories in production installations.

We should probably rename this directory, actually, but it would inconvenience
a lot of people right now if we did.

### The `tools` directory

Every directory under `/tools` is [an npm "workspaces" module](https://docs.npmjs.com/cli/v8/using-npm/workspaces).

This is where `run-selfhosted.js` is. That's the entrypoint for `npm start`.

These tools are underdocumented and may not behave well if they're not executed
from the correct working directory (which is different for different tools).
Consider this a work-in-progress. If you want to use or contribute to anything
under this directory, for now you should
[tag @KernelDeimos on the community Discord](https://discord.gg/PQcx7Teh8u).
