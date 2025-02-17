# Puter's glosary

## General

1. **Puter:** Puter is an advanced, open-source internet operating system designed to be feature-rich, exceptionally fast, and highly extensible.

2. **Self hosting:** Means running and managing the app on your infrastructure instead of using thid-party hosting service.
You can learn more on how to self host your Puter instance [here](./deployment/self_host.md)

3. **Kernel:** It is a simple module which is in charge of orchestrating the initialization of the system, following the boot sequence. Following the [Microkernel pattern](https://www.oreilly.com/library/view/software-architecture-patterns/9781098134280/ch04.html), this module corresponds to the Core of Puter backend.

4. **Monorepo:** A centralised source code repository made of several interrelated packages.

5. **npm workspace:** An NPM workspace is a NPM feature that allows you to **manage multiple related packages** (like a monorepo) within a single repository.

## Backend components

1. **BasicBase:** Abstract class with inheritance tracking for composite the system using shared configuration and behaviors.
2. **FeatureBase:** Extending BasicBase, allows defining and install features (classes and modules) as TopicsFeature, MariMethodsfeature, and others.
3. **AdvancedBase:** Extending FeatureBase, Defines features to be installed by Its FeatureBase parent instance.

> As you can see, components follows an inheritance chain which starts in BasicBase.

4. **KernelModule:** Extending AdvancedBase, orchestrate system boot sequence.

---

If you find any bug or error in this documentation, do not hesitate to send your complaint to **jose.s.contacto@gmail.com**, or **colaborate** with the documentation yourself.
