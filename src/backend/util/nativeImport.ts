export const nativeImport = new Function(
    'specifier',
    'return import(specifier)',
) as <TModule = unknown>(specifier: string) => Promise<TModule>;
