---
name: Driver Request
about: Request a driver on Puter
title: ''
labels: ''
assignees: ''

---

## Name of Driver

Description of driver

### What is a Puter Driver?

Let's call the operating system on your computer/phone/etc a "Low-Level Device Operating System" or LLDOS. Puter is a "High-Level Distributed Operating System" or HLDOS. Where an LLDOS coordinates access to hardware, an HLDOS coordinates access to services and network resources. In Puter, **drivers** are integrations with third-party services, network devices, or even the underlying LLDOS where a Puter node is hosted.

Puter drivers have two parts:
- a driver interface
- a driver implementation

Driver interfaces are the "types" of drivers. For example, an LLDOS may have multiple different drivers that are recognized as "printers". "printer" is the interface or type. Some examples of driver interfaces on Puter include:
- Chat completion interface for AI / LLMs (`puter-chat-completion`)
- Providers of OCR (optical character recognition) (`puter-ocr`)
- Providers of voice synthesis / text-to-speech (`puter-tts`)
- Key-value storage (`puter-kv`)
- CRUD (+ Query) interface for Puter-native data types (`crud-q`)
- Execute code on external interpreters/compilers (`puter-exec`)

Driver implementations are [backend services](https://github.com/HeyPuter/puter/wiki/src-backend-contributors-modules) that define a static member called `IMPLEMENTS`, where this member contains an entry for a registered interface. (this may sound confusing at first - it will be more clear after reading the resources below)

### Building Drivers

- [Written documentation on building drivers](https://github.com/HeyPuter/puter/wiki/src-backend-howto_make_driver)
- [Video tutorial on building drivers](https://www.youtube.com/watch?v=8znQmrKgNxA&t=78s)

Note: some of this documentation may tell you to add an interface to `interfaces.js` inside the drivers directory. Don't do this; instead register interfaces as is done [here](https://github.com/HeyPuter/puter/blob/f0434435c4c12ba70bb86437428f82c72bb35bd0/src/backend/src/modules/puterai/AIInterfaceService.js), [here](https://github.com/HeyPuter/puter/blob/ce0ab02f39f16cbb99f4b7e8ee90196d443040ff/src/backend/src/modules/convert/ConvertAPIService.js#L14), [here](https://github.com/HeyPuter/puter/blob/feb2ca126f50d9642c08ce7800259b49b9ecb0db/src/backend/src/modules/mail/UserSendMailService.js#L12), and [here](https://github.com/HeyPuter/puter/blob/81ee52b00fea4b58b5e97ccec59b049a251c440a/src/backend/src/modules/puterexec/ExecInterfaceService.js).

### Examples of Drivers

- The [puterai module](https://github.com/HeyPuter/puter/blob/ec0a72114382a78d82bc7d0156daf1a2a003d567/src/backend/src/modules/puterai) registers a number of driver interfaces and implementations.
- The [`hello-world` service](https://github.com/HeyPuter/puter/blob/6a184d52b47d80f23babaa94f9ccc32ed6ea14be/src/backend/src/services/HelloWorldService.js) implements the `hello-world` driver interface as an example. This is a little outdated because:
  - HelloWorldService should probably be in a separate module. (ex: a module called `examples`)
  - The `hello-world` interface is defined in this legacy [interfaces.js](https://github.com/HeyPuter/puter/blob/6a184d52b47d80f23babaa94f9ccc32ed6ea14be/src/backend/src/services/drivers/interfaces.js) file, but it should be registered by HelloWorldService instead like we do in [AIInterfaceService](https://github.com/HeyPuter/puter/blob/f0434435c4c12ba70bb86437428f82c72bb35bd0/src/backend/src/modules/puterai/AIInterfaceService.js).
- For some drivers it makes sense to put them in a separate module. [here is a template for modules](https://github.com/HeyPuter/puter/blob/6a184d52b47d80f23babaa94f9ccc32ed6ea14be/src/backend/src/modules/template).
  - Driver interfaces of a similar nature are often placed in the same module. For example, the `puterai` module has interfaces for LLMs, TTS, etc. It is assumed that AI service providers will often provide multiple of these types of services, so if you already have an API key you should be able to access all the provider's services with just this module.
