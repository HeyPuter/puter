# Contributing to Puter's Backend

## File Structure



## Architecture

- [boot sequence](./doc/contributors/boot-sequence.md)
- [modules and services](./doc/contributors/modules.md)

## Features

- [protected apps](./doc/features/protected-apps.md)
- [service scripts](./doc/features/service-scripts.md)

## Lists of Things

- [list of permissions](./doc/lists-of-things/list-of-permissions.md)

## Code-First Approach

If you prefer to understand a system by looking at the
first files which are invoked and starting from there,
here's a handy list!

- [Kernel](./src/Kernel.js), despite its intimidating name, is a
  relatively simple (< 200 LOC) class which loads the modules
  (modules register services), and then starts all the services.
- [RuntimeEnvironment](./src/boot/RuntimeEnvironment.js)
  sets the configuration and runtime directories. It's invoked by Kernel.
- The default setup for running a self-hosted Puter loads these modules:
  - [CoreModule](./src/CoreModule.js)
  - [DatabaseModule](./src/DatabaseModule.js)
  - [LocalDiskStorageModule](./src/LocalDiskStorageModule.js)
- HTTP endpoints are registered with
  [WebServerService](./src/services/WebServerService.js)
  by these services:
  - [ServeGUIService](./src/services/ServeGUIService.js)
  - [PuterAPIService](./src/services/PuterAPIService.js)
  - [FilesystemAPIService](./src/services/FilesystemAPIService.js)

## Development Philosophies

### The copy-paste rule

If you're copying and pasting code, you need to ask this question:
- am I copying as a reference (i.e. how this function is used),
- or am I copying an implementation of actual behavior?

If your answer is the first, you should find more than one piece of
code that's doing the same thing you want to do and see if any of them
are doing it differently. One of the ways of doing this thing is going
to be more recent and/or (yes, potentially "or") more correct.
More correct approaches are ones which reduce
[coupling](https://en.wikipedia.org/wiki/Coupling_(computer_programming)),
move from legacy implementations to more recent ones, and are actually
more convenient for you to use. Whenever ever any of these three things
are in contention it's very important to communicate this to the
appropriate maintainers and contributors.

If your answer is the second, you should find a way to
[DRY that code](https://en.wikipedia.org/wiki/Don%27t_repeat_yourself).

### Architecture Mistakes? You will make them and it will suck.

In my experience, the harder I think about the correct way to implement
something, the bigger a mistake I'm going to make; ***unless*** a big part
of the reason I'm thinking so hard is because I want to find a solution
that reduces complexity and has the right maintenance trade-off.
There's no easy solution for this so just keep it in mind; there are some
things we might write 2 times, 3 times, even more times over before we
really get it right and *that's okay*; sometimes part of doing useful work is
doing the useless work that reveals what the useful work is.

## Underlying Constructs

- [putility's README.md](../putility/README.md)
  - Whenever you see `AdvancedBase`, that's from here
    - Many things in backend extend this. Anything that doesn't only doesn't
      because it was written before `AdvancedBase` existed.
  - Allows adding "traits" to classes
    - Have you ever wanted to wrap every method of a class with
      common behavior? This can do that!
