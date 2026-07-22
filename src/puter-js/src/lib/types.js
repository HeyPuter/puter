// Shared JSDoc-only utility types. No runtime exports.

/**
 * Constructor of `Class` whose instances omit the `Keys` members. Cast a
 * class to this to keep implementation-only fields (like the owning Puter
 * instance) off the public type without wrapping the class at runtime.
 *
 * The constraint must be `any[]`, not `unknown[]`: a constructor with typed
 * parameters isn't assignable to `new (...args: unknown[])`.
 *
 * @template {new (...args: any[]) => any} Class
 * @template {keyof InstanceType<Class>} Keys
 * @typedef {new (...args: ConstructorParameters<Class>) => Omit<InstanceType<Class>, Keys>} OmitMembers
 */

export {};
