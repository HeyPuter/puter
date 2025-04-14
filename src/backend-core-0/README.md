# What is `backend-core-0`?

The ugly name is intentional. We prefer to refactor incrementally which
means we need a way to "re-core" the backend, and we may do this more
than once simultaneously (hence it's `0` right now).

"re-core" is a term I just made up, and it means this:
> To find the utility code that is not dependent on other utility code,
> move that into a new package, and then continue this process in multiple
> iterations until the problem being solved is solved.

The purpose of `backend-core-0` is to move common dependencies for driver
implementations into a new core so that existing driver implementations
can be moved from backend modules (part of the `backend` package) to
extensions (packages added to Puter at runtime).

What will follow is a log of what was moved here and why.

## 2025-03-31

The AI/LLM driver module depends on constructs related to driver
interfaces. The actual mechanism that facilitates these interfaces,
as well as the interface format, both don't really have a name yet;
I'll call it the "PDIM" (Puter Driver Interface Mechanism) in this log.

The PDIM depends on some class definitions currently in
`src/backend/src/services/drivers/meta` which are split into the categories
of "Constructs" and "Runtime Entities". A construct is the class
representation of something defined in an interface, including
**Interface** itself, and a RuntimeEntity - well there's only one;
it's a wrapper for runtime-typed values such as "jpeg stream".

A construct called **Parameter**, which is the class represerntation
of a parameter of an interface that a driver may implement, depends on
a file called `types.js`. This file defines high-level types like String,
URL, File, etc that can be used in Puter drivers.

Some types depend on utilities in Puter's backend:
- **File**
  - filesystem/validation
  - `is_valid_uuidv4` from helpers.js
- **URL**
  - `is_valid_url` from helpers.js

These utilities do not have dependencies so they are good candidates
to be moved into this package. Afterwards, it currently apperas that
everything in `drivers/meta` can be moved here, allowing DriverService
to finally be moved to a backend module (right now it's part of backend
core), and driver modules like `puterai` will be closer to being able
to be moved to extensions.
