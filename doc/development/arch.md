# System Architecture

## General

Puter's system goals is to provide an internet operating system, providing (as brief):

1. **User management:** (User) Account and session CrUD, Permissions...
2. **Desktop environment use:** (User) Use apps in interactive mode through GUIs, CrUD symbolic links and icons...
3. **System deployment:** (Developers) build a web app, or web service, on puter.

and ensuring:

  1. **Extensibility:** you should be able to create your own Kernel Modules, user-oriented applications, and so.
  2. **Debuggability:** given this is opensource-driven, you'll find loggers and monitoring tools aiming to make development easier.
  3. **Deployability:** you, and other users, should be able to deploy this system at least both self host and public hosting.
  4. **Securability:** you, and other users, should be able to trust on puter as a personal cloud, a remote desktop for servers and workstations, and as a software development platform.

In order to achieve those requirements, Puter is following (tl;dr):

1. **A client-server style Architecture:** Allow user to interact with system GUI through a Web Browser (as an external system).
2. **Micro-kernel pattern:** Allow backend (in which heavy processing occurs) to extend system's functionality, keeping the core of the system and the other additions decoupled each other.

In in a nutshell:
```
  Puter is Puter, whatever you think it might be useful for
  you can use it for. You can think of it as a high-level
  operating system where the "hardware" is external services or
  resources provided by the host OS; if you develop apps on
  this platform you have higher-level primitives, like how
  using AI services is considered a "driver", or how Puter's
  filesystem can use a database to store the directory tree and
  file metadata.
```

## Deployment

### Local dev

Get the [monorepo](https://github.com/HeyPuter/puter/), and then run `install` and `start` [npm scripts](https://github.com/HeyPuter/puter/blob/main/package.json)

```
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

You get in error? then you can [check our first run issues checklist.](../self-hosters/first-run-issues.md)

Also, if you get "Cannot write to path" error, it usually happens when /var/puter isn\'t chown\'d to the right UID. You can check the [issue number 645.](https://github.com/HeyPuter/puter/issues/645)
### Docker

On linux/macOS run:

```
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```

On Windows run:

```
mkdir -p puter
cd puter
New-Item -Path "puter\config" -ItemType Directory -Force
New-Item -Path "puter\data" -ItemType Directory -Force
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml" -OutFile "docker-compose.yml"
docker compose up
```

## Main modules traits

### service

- **Concern:** to extend core functionality.
- **Class:** BaseService (extends concepts.Service)
- **Public interface:**

```
/**
* Creates the service's data structures and initial values.
* This method sets up logging and error handling, and calls a custom `_construct` method if defined.
* 
* @returns {Promise<void>} A promise that resolves when construction is complete.
*/
async construct () => void
```

```
/**
* Constructs service class using Service Resources list
* Service Resources properties: services, config, my_config, name, args, context.
*/
constructor (service_resources, ...a)
```


```
/**
* Performs service lifecycle's initialization phase
*/
async init () => void
```

### Kernel

                       
- **Concern:** To orchestrate core modules for system to load up, following [**Backend Boot Sequence**.](../../src/backend/doc/contributors/boot-sequence.md) 
- **Class:** Kernel (extends AdvancedBase)
- **Public interface:**

```
/**
* Construct kernel module configuring its useapi and entry path
*/
constructor (entry_path) =>
```
                       

```
/**
* Adds a module into kernel's modules list
*/
add_module (module) => void
```

```
/**
* Boots backend
*/
boot () => void
```

## System entry points

### Testing
Mocha is being used for this.
There are 2 main **test directories:**
1. src/phoenix/test -> testing phoenix emulator.
2. src/backend/tools/test -> a set of tools for backend testing. [Read more about backend tools.](../../src/backend/doc/contributors/testing_tools.md ) 

### Use cases
For **self hosting** deployment, there is a _tool_ called "run-selfhosted.js" which you can run with ```npm run start``` command. That tool is going to:

1. Get all required _kernel modules_ from the **@heyputer/backend npm package**
2. Configure kernel's entry path as the directory path of the current file (so, the  run-selfhosted tool's directory).
3. Add all required _kernel modules_ to kernel's modules list.
4. Start kernel by its ```boots()``` public method.

**Monitoring:** The ```SelfHostedModule``` is responsible for load 3 project's module watching tools (for GUI, TERMINAL, EMULATOR, GIT, PHOENIX, and PUTER-JS)

---

If you find any bug or error in this documentation, do not hesitate to send your complaint to **jose.s.contacto@gmail.com**, or **colaborate** with the documentation yourself.
