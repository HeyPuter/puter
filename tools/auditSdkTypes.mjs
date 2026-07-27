//
// Compare the hand-maintained puter.js declarations in src/puter-js/types
// against the types TypeScript infers from the JSDoc in src/puter-js/src.
//
// The SDK is migrating its source of truth from the hand-written .d.ts tree to
// JSDoc on the implementations. This reports, per module member, whether the
// JSDoc already carries enough type information to stand in for the
// declaration — so a module's .d.ts can be deleted with proof rather than hope.
//
// Statuses, worst first:
//
//   MISSING_IMPL  declared but no matching member on the implementation
//   UNTYPED       JSDoc yields `any`
//   NOT_CALLABLE  declared as a method, inferred as a plain property
//   MISMATCH      JSDoc type does not satisfy the declaration
//   PARTIAL       some parameter or the return type is `any`
//   OVERLOADS     declaration has overloads the JSDoc does not express
//   DIVERGES      JSDoc satisfies the declaration but is not interchangeable
//                 with it, so promoting it would change the published type
//   OK            JSDoc and declaration agree
//
//   node ./tools/auditSdkTypes.mjs [--module <key>] [--json] [--strict]
//
// --module limits the run to one module, --json prints machine-readable
// output, and --strict exits non-zero when any gap remains (for CI).
//
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);
const sdkRoot = path.join(repoRoot, 'src/puter-js');
const implDir = 'src/modules';
const declDir = 'types/modules';

// [key, implementation file, its export, declaration file, declared type].
// Names differ on both sides often enough that an explicit map is clearer
// than deriving one; keep it in sync when adding a module.
//
// `net` is absent deliberately: it has no implementation module, being an
// object literal built in the Puter constructor, so the root pass covers it.
const MODULES = [
    ['ai', 'ai/index.js', 'AI', 'ai.d.ts', 'AI'],
    ['apps', 'apps/index.js', 'Apps', 'apps.d.ts', 'Apps'],
    ['auth', 'Auth.js', 'default', 'auth.d.ts', 'Auth'],
    ['debug', 'Debug.js', 'Debug', 'debug.d.ts', 'Debug'],
    ['drivers', 'Drivers.js', 'default', 'drivers.d.ts', 'Drivers'],
    ['email', 'Email.js', 'default', 'email.d.ts', 'Email'],
    ['fsitem', 'FSItem.js', 'default', 'fs-item.d.ts', 'FSItem'],
    ['hosting', 'hosting/index.js', 'Hosting', 'hosting.d.ts', 'Hosting'],
    ['kv', 'kv/index.js', 'KV', 'kv.d.ts', 'KV'],
    ['os', 'os/index.js', 'OS', 'os.d.ts', 'OS'],
    ['peer', 'Peer.js', 'default', 'peer.d.ts', 'default'],
    ['perms', 'perms/index.js', 'Perms', 'perms.d.ts', 'Perms'],
    ['ui', 'UI.js', 'default', 'ui.d.ts', 'UI'],
    ['util', 'Util.js', 'default', 'util.d.ts', 'default'],
    [
        'workers',
        'Workers.js',
        'WorkersHandler',
        'workers.d.ts',
        'WorkersHandler',
    ],
    [
        'fs',
        'FileSystem/index.js',
        'PuterJSFileSystemModule',
        'filesystem.d.ts',
        'FS',
    ],
];

const ROOT_ENTRY = 'src/index.js';
const ROOT_DECL_FILE = 'types/puter.d.ts';
const ROOT_DECL_TYPE = 'Puter';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const strict = args.includes('--strict');
const onlyModule = args.includes('--module')
    ? args[args.indexOf('--module') + 1]
    : null;

const modules = onlyModule
    ? MODULES.filter((m) => m[0] === onlyModule)
    : MODULES;
if (onlyModule && modules.length === 0) {
    console.error(
        `Unknown module '${onlyModule}'. Known: ${MODULES.map((m) => m[0]).join(', ')}`,
    );
    process.exit(2);
}

const implPath = (rel) => path.join(sdkRoot, implDir, rel);
const declPath = (rel) => path.join(sdkRoot, declDir, rel);

const program = ts.createProgram(
    [
        ...modules.map((m) => implPath(m[1])),
        ...new Set(modules.map((m) => declPath(m[3]))),
        path.join(sdkRoot, ROOT_ENTRY),
        path.join(sdkRoot, ROOT_DECL_FILE),
    ],
    {
        allowJs: true,
        checkJs: false,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
    },
);
const checker = program.getTypeChecker();

const isAny = (type) => !!(type.flags & ts.TypeFlags.Any);

const assignable = (from, to) => {
    try {
        return checker.isTypeAssignableTo(from, to);
    } catch {
        return null;
    }
};

// Render a pair of types for a report line. Where both print the same text --
// which happens when the JSDoc points at a class the implementation defines
// itself while the declaration keeps its own same-named copy -- each side is
// qualified with the file it came from, so the difference is visible.
function describePair(implType, declaredType) {
    const implText = checker.typeToString(implType);
    const declaredText = checker.typeToString(declaredType);
    if (implText !== declaredText) return [implText, declaredText];

    const origin = (type) => {
        const file = type
            .getSymbol()
            ?.declarations?.[0]?.getSourceFile()?.fileName;
        return file ? ` (${path.relative(sdkRoot, file)})` : '';
    };
    return [implText + origin(implType), declaredText + origin(declaredType)];
}

// Resolve an exported class or value to the type describing its instances.
function exportedType(file, name) {
    const sourceFile = program.getSourceFile(file);
    const rel = path.relative(sdkRoot, file);
    if (!sourceFile) return { err: `source file not found: ${rel}` };

    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) return { err: `no module symbol: ${rel}` };

    const exported = checker
        .getExportsOfModule(moduleSymbol)
        .find((e) => e.getName() === name);
    if (!exported) return { err: `export '${name}' not found in ${rel}` };

    const symbol =
        exported.flags & ts.SymbolFlags.Alias
            ? checker.getAliasedSymbol(exported)
            : exported;
    const node = symbol.declarations?.[0];
    if (!node) return { err: `no declaration for '${name}' in ${rel}` };

    const declared = checker.getDeclaredTypeOfSymbol(symbol);
    if (
        declared &&
        !isAny(declared) &&
        checker.getPropertiesOfType(declared).length > 0
    ) {
        return { type: declared, node };
    }

    const valueType = checker.getTypeOfSymbolAtLocation(symbol, node);
    const ctors = valueType.getConstructSignatures?.() ?? [];
    if (ctors.length > 0) return { type: ctors[0].getReturnType(), node };
    return { type: valueType, node };
}

// The inferred root object, reached through `export const puter = puterInit()`.
function inferredRootType() {
    const sourceFile = program.getSourceFile(path.join(sdkRoot, ROOT_ENTRY));
    if (!sourceFile) return { err: `${ROOT_ENTRY} not found` };

    let node = null;
    ts.forEachChild(sourceFile, (child) => {
        if (!ts.isVariableStatement(child)) return;
        for (const d of child.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && d.name.text === 'puter')
                node = d.name;
        }
    });
    if (!node) return { err: 'could not locate the exported `puter` binding' };
    return { type: checker.getTypeAtLocation(node), node };
}

function publicProperties(type) {
    return checker
        .getPropertiesOfType(type)
        .filter(
            (sym) =>
                !sym.getName().startsWith('_') &&
                !sym.getName().startsWith('#'),
        );
}

function typeOfMember(symbol, fallbackNode) {
    const node =
        symbol.valueDeclaration ?? symbol.declarations?.[0] ?? fallbackNode;
    return checker.getTypeOfSymbolAtLocation(symbol, node);
}

function anyParameters(signature) {
    return signature.parameters
        .filter((p) => {
            const decl = p.valueDeclaration ?? p.declarations?.[0];
            return decl
                ? isAny(checker.getTypeOfSymbolAtLocation(p, decl))
                : true;
        })
        .map((p) => p.getName());
}

function compareMember(declaredType, implType) {
    const declaredSigs = declaredType.getCallSignatures();
    const implSigs = implType.getCallSignatures();

    if (isAny(implType))
        return { status: 'UNTYPED', detail: 'JSDoc yields any' };

    if (declaredSigs.length > 0 && implSigs.length === 0) {
        return {
            status: 'NOT_CALLABLE',
            detail: 'declared as a method, inferred as a property',
        };
    }

    if (declaredSigs.length > 1 && implSigs.length < declaredSigs.length) {
        return {
            status: 'OVERLOADS',
            detail: `declaration has ${declaredSigs.length} overloads, JSDoc expresses ${implSigs.length}`,
        };
    }

    if (implSigs.length > 0) {
        const bad = anyParameters(implSigs[0]);
        const anyReturn = isAny(implSigs[0].getReturnType());
        if (bad.length > 0 || anyReturn) {
            const parts = [];
            if (bad.length > 0) parts.push(`any parameters: ${bad.join(', ')}`);
            if (anyReturn) parts.push('any return type');
            return { status: 'PARTIAL', detail: parts.join('; ') };
        }
    }

    const satisfies = assignable(implType, declaredType);
    if (satisfies === null) {
        return {
            status: 'MISMATCH',
            detail: 'assignability could not be determined',
        };
    }
    if (satisfies === false) {
        const [impl, declared] = describePair(implType, declaredType);
        return {
            status: 'MISMATCH',
            detail: `JSDoc \`${impl}\` does not satisfy \`${declared}\``,
        };
    }

    if (assignable(declaredType, implType) === false) {
        const [impl, declared] = describePair(implType, declaredType);
        return {
            status: 'DIVERGES',
            detail: `JSDoc \`${impl}\` is not interchangeable with \`${declared}\``,
        };
    }
    return { status: 'OK', detail: '' };
}

function auditSurface(key, declared, impl) {
    const implProps = new Map(
        publicProperties(impl.type).map((p) => [p.getName(), p]),
    );
    const members = [];

    for (const declaredProp of publicProperties(declared.type)) {
        const name = declaredProp.getName();
        const declaredType = typeOfMember(declaredProp, declared.node);
        const implProp = implProps.get(name);

        if (!implProp) {
            members.push({
                module: key,
                name,
                status: 'MISSING_IMPL',
                detail: `declared as \`${checker.typeToString(declaredType)}\``,
            });
            continue;
        }

        const { status, detail } = compareMember(
            declaredType,
            typeOfMember(implProp, impl.node),
        );
        members.push({ module: key, name, status, detail });
    }

    const undeclared = [...implProps.keys()].filter(
        (n) => !members.some((m) => m.name === n),
    );
    return { members, undeclared };
}

const results = [];
const errors = [];

for (const [key, implRel, implName, declRel, declName] of modules) {
    const impl = exportedType(implPath(implRel), implName);
    const declared = exportedType(declPath(declRel), declName);
    if (impl.err || declared.err) {
        errors.push({ module: key, error: impl.err ?? declared.err });
        continue;
    }
    results.push({ module: key, ...auditSurface(key, declared, impl) });
}

if (!onlyModule) {
    const declaredRoot = exportedType(
        path.join(sdkRoot, ROOT_DECL_FILE),
        ROOT_DECL_TYPE,
    );
    const implRoot = inferredRootType();
    if (declaredRoot.err || implRoot.err) {
        errors.push({
            module: 'puter',
            error: declaredRoot.err ?? implRoot.err,
        });
    } else {
        // Modules are audited against their own implementations above, so the
        // root pass only covers what lives directly on the Puter object.
        const moduleKeys = new Set(MODULES.map((m) => m[0]));
        const { members, undeclared } = auditSurface(
            'puter',
            declaredRoot,
            implRoot,
        );
        results.push({
            module: 'puter',
            members: members.filter((m) => !moduleKeys.has(m.name)),
            undeclared,
        });
    }
}

const ORDER = [
    'MISSING_IMPL',
    'UNTYPED',
    'NOT_CALLABLE',
    'MISMATCH',
    'PARTIAL',
    'OVERLOADS',
    'DIVERGES',
    'OK',
];

const allMembers = results.flatMap((r) => r.members);
const gaps = allMembers.filter((m) => m.status !== 'OK');

if (asJson) {
    console.log(
        JSON.stringify(
            {
                results,
                errors,
                summary: { total: allMembers.length, gaps: gaps.length },
            },
            null,
            2,
        ),
    );
} else {
    for (const e of errors) console.error(`! ${e.module}: ${e.error}`);

    const row = (label, total, tally) =>
        [
            label.padEnd(9),
            String(total).padEnd(6),
            ...ORDER.map((s) => String(tally[s] ?? '.').padEnd(8)),
        ].join('');

    const header = [
        'module'.padEnd(9),
        'total'.padEnd(6),
        ...ORDER.map((s) => s.slice(0, 7).padEnd(8)),
    ].join('');
    console.log(header);
    console.log('-'.repeat(header.length));

    for (const r of results) {
        const tally = {};
        for (const m of r.members) tally[m.status] = (tally[m.status] ?? 0) + 1;
        console.log(row(r.module, r.members.length, tally));
    }

    const grand = {};
    for (const m of allMembers) grand[m.status] = (grand[m.status] ?? 0) + 1;
    console.log('-'.repeat(header.length));
    console.log(row('TOTAL', allMembers.length, grand));

    if (gaps.length === 0) {
        console.log(
            '\nNo gaps: JSDoc satisfies every declared member in scope.',
        );
    } else {
        console.log(`\n${gaps.length} gap(s):`);
        for (const status of ORDER.filter((s) => s !== 'OK')) {
            const forStatus = gaps.filter((m) => m.status === status);
            if (forStatus.length === 0) continue;
            console.log(`\n  ${status} (${forStatus.length})`);
            for (const m of forStatus) {
                console.log(
                    `    ${`${m.module}.${m.name}`.padEnd(30)} ${m.detail}`,
                );
            }
        }
    }
}

if (errors.length > 0) process.exit(2);
if (strict && gaps.length > 0) process.exit(1);
