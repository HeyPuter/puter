## 2024-10-16

### Considerations for Mountpoints Feature

- `_storage_upload` takes paramter `uuid` instead of `path`
  - S3 bucket strategy needs the UUID
    - If we do hashes, 10MB chunks should be fine
      - we're already able to smooth out bursty traffic using the
        EWA algorithm
- Use of `systemFSEntryService`
  - Is that normalized? Does everything go through this interface?
- Storage interface has methods like `post_insert`
  - as far as I can tell this doesn't pose any issue
-  

### Brainstorming Migration Strategies

#### Interface boundary at HL<->LL filesystem methods

-- **tags:** brainstorming

From the perspectice of a trait-oriented implementation,
which is not how LL/HL filesystem operations are currently implemented,
the LL-class operations are implemented in separate traits.

The composite trait containing all of these traits would be the trait
that represents a filesystem implementation itself.

Other filesystem interfaces that I've seen, such as FUSE and 9p,
all usually have a monolithic interface - that is to say, an interface
which includes all of the filesystem operations, rather than several
interfaces each implementing a single filesystem operaiton.

Something about the fact that the LL-class operations are in separate
classes makes it difficult to reason about how to move.
Is it simply that multiple files in a directory is just more
annoying to think about? Maybe, but there must be something more.

Perhaps it's that there are several references. Each implementation
(that is, implemenation of a single filesystem operation) could have
any number of different references across any number of different files.
This would not be the case with a monolithic interface.

I think the best of both worlds would be to have an interface representing
the entire filesystem and, in one place, link of of the individual
operation implementations to compose a filesystem implementation

### Filesystem Brainstorming

Puter's backend uses a service architecture. Each service is an instance
of a class extending "Service". A service can listen to events of the
backend's lifecycle, interact with other services, and interact with
external interfaces such as APIs and databases.

Puter's current filesystem, let's call it PuterFSv1, exists as the result
of multiple services working together. We have LocalDiskStorageService
which mimics an S3 bucket on a local system, and we have
DatabaseFSEntryService which manages information about files, directories,
and their relationships within the database, and therefore depends on
DatabaseAccessService.

It is now time to introduce a MountpointService. This will allow another
service or a user's configuration to assign an instance of a filesystem
implementation (such as PuterFSv1) to a specific path.

The trouble here is that PuterFSv1 is composed of services, and the nature
of a service is such that it exists for the lifecycle of the application.
The class for a particular service can be re-used and registered with
multiple names (creating multiple services with the same implementation
but perhaps different configuration), but that's only a clean scenario when
there is just one service. PuterFSv1, on the other hand, is like an
imaginary service composed of other services.

The following possibilities then should be discussed:
- CompositeService base class for a service that is composed of
  more than one service.
- Refactor filesystem to not use service architecture.
- Each filesystem service can manage state and configuration
  for multiple mountpoints
  (I don't like this idea; it feels messy. I wonder what software
   principles this violates)

We can take advantage of traits/interfaces here.
PuterFSv1 depends on two interfaces:
- An S3-like data storage implementation
- An fsentry storage implementation

Counterintuitively from what I first thought, "Refactor the filesystem"
actually looks like the best solution, and it doens't even look like it
will be that difficult. In fact, it'll likely make the filesystem easier
to maintain and more robust as a result.

Additionally, we can introduce PuterFSv2, which will introduce storing
data in chunks identified by their hashes, and associated hashes with
fsentries.

PuterFSService will be a new service which registers 'PuterFSv1' with
FilesystemService.

An instance of a filesystem needs to be separate from a mountpoint.
For example, PuterFSv1 will usually have only one instance but it may
be mounted several different times. `/some-user` on Puter's VFS could
be a mountpoint for `/some-user` in the instance of PuterFSv1.
