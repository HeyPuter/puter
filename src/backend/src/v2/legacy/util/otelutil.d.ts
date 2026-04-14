/**
 * Type declaration for otelutil.js — provides stage-3 decorator signatures
 * so .ts consumers (e.g., DynamoKVStore) typecheck correctly after the
 * removal of `experimentalDecorators`.
 */

export declare function Span (
    label: string,
    options?: unknown,
    tracer?: unknown,
): <This, Args extends unknown[], Return>(
    value: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
) => (this: This, ...args: Args) => Return;

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export declare function spanify (
    label: string,
    fn: Function,
    options?: unknown,
    tracer?: unknown,
): Function;
