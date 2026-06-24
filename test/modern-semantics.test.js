import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import toildefender from "../build/toildefender.js";

const optionalRequire = createRequire(import.meta.url);

const FEATURES = {
    dead_code: true,
    scope: true,
    control_flow: true,
    identifiers: true,
    numeric_vm: false,
    object_packing: true,
    literals: true,
    mangle: true,
    compress: true
};

const INSPECTABLE_FEATURES = {
    dead_code: false,
    scope: true,
    control_flow: false,
    identifiers: true,
    numeric_vm: false,
    object_packing: true,
    literals: false,
    mangle: false,
    compress: false
};

const VM_FEATURES = {
    dead_code: false,
    scope: false,
    control_flow: false,
    identifiers: false,
    numeric_vm: true,
    object_packing: false,
    literals: false,
    mangle: false,
    compress: false
};

function run(code) {
    const context = createRunContext();
    vm.runInContext(code, context, { timeout: 1_000 });
    return JSON.parse(JSON.stringify(context.__result));
}

async function runAsync(code) {
    const context = createRunContext();
    vm.runInContext(code, context, { timeout: 1_000 });
    await new Promise((resolve) => setImmediate(resolve));
    return JSON.parse(JSON.stringify(context.__result));
}

function createRunContext() {
    const context = vm.createContext({
        console,
        globalThis: {},
        window: {},
        setTimeout,
        clearTimeout,
        setImmediate,
        Promise
    });
    context.globalThis = context;
    context.window = context;
    return context;
}

function hasOptionalBabelTransform() {
    try {
        optionalRequire.resolve("@babel/core");
        optionalRequire.resolve("@babel/preset-env");
        return true;
    } catch (error) {
        return false;
    }
}

function runStrict(code) {
    return run(`"use strict";\n${code}`);
}

function defendCode(code, options = {}) {
    const result = toildefender.do({
        code,
        modulesCode: {},
        features: FEATURES,
        logLevel: "error",
        ...options
    });
    return result.code;
}

function defendInspectableCode(code, features = INSPECTABLE_FEATURES) {
    const result = toildefender.do({
        code,
        modulesCode: {},
        forceFeatures: features,
        logLevel: "error"
    });
    return result.code;
}

function defendVmCode(code, numericVm = {}) {
    const result = toildefender.do({
        code,
        modulesCode: {},
        forceFeatures: VM_FEATURES,
        numericVm: {
            enabled: true,
            maxFunctionSize: 120,
            minFunctionSize: 1,
            seed: "numeric-vm-test",
            virtualize: "all-supported",
            ...numericVm
        },
        logLevel: "error"
    });
    return result.code;
}

function defendHashMeshCode(code, hashMesh = {}) {
    return defendVmCode(code, {
        hashMesh: {
            bindToVmState: true,
            chaffRatio: 0.55,
            deriveDialectFromMesh: true,
            enabled: true,
            encodeChaff: true,
            mode: "aggressive",
            unlock: "per-function",
            ...hashMesh
        }
    });
}

function assertSameRuntimeResult(code, options) {
    const defended = defendCode(code, options);
    assert.equal(defended.includes("$$defend"), false);
    assert.equal(defended.includes("defendjs"), false);
    assert.deepEqual(run(defended), run(code));
}

test("mangle supports block-scoped declarations without producing redeclarations", () => {
    const code = `
        "use strict";
        function foldBytes(bytes, seed) {
            let hash = seed ^ bytes.length;
            for (let index = 0; index < bytes.length; index += 1) {
                hash = (hash + bytes[index]) >>> 0;
            }
            return hash;
        }
        globalThis.__result = foldBytes([1, 2, 3], 9);
    `;
    const disabled = Object.fromEntries(Object.keys(FEATURES).map((name) => [name, false]));
    const defended = toildefender.do({
        code,
        modulesCode: {},
        features: {
            ...disabled,
            compress: true
        },
        logLevel: "error",
        runtimeHelpers: false
    }).code;

    assert.deepEqual(run(defended), run(code));
});

test("mangle preserves shorthand object property keys", () => {
    const code = `
        "use strict";
        function makeReport(checks) {
            const report = { checks };
            return {
                rows: report.checks.length,
                first: report.checks[0]
            };
        }
        globalThis.__result = makeReport(["a", "b"]);
    `;
    const disabled = Object.fromEntries(Object.keys(FEATURES).map((name) => [name, false]));
    const defended = toildefender.do({
        code,
        modulesCode: {},
        features: {
            ...disabled,
            compress: true
        },
        logLevel: "error",
        runtimeHelpers: false
    }).code;

    assert.deepEqual(run(defended), run(code));
});

test("mangle handles class super without disabling the whole pass", () => {
    const code = `
        "use strict";
        class LocalProblem extends Error {
            constructor(longMessage) {
                super(longMessage);
                this.name = "LocalProblem";
            }
        }
        function makeProblem(longInputValue) {
            const longSuffixValue = "-ok";
            return new LocalProblem(longInputValue + longSuffixValue).message;
        }
        globalThis.__result = makeProblem("x");
    `;
    const disabled = Object.fromEntries(Object.keys(FEATURES).map((name) => [name, false]));
    const defended = toildefender.do({
        code,
        modulesCode: {},
        features: {
            ...disabled,
            mangle: true,
            compress: true
        },
        logLevel: "error",
        runtimeHelpers: false
    }).code;

    assert.equal(defended.includes("longInputValue"), false);
    assert.equal(defended.includes("longSuffixValue"), false);
    assert.deepEqual(run(defended), run(code));
});

test("literal protection encodes object property values", () => {
    const code = `
        function normalize(error) {
            return {
                NotAllowedError: "user_cancelled",
                InvalidStateError: "credential_excluded"
            }[error.name] || "unknown";
        }
        globalThis.__result = normalize({ name: "NotAllowedError" });
    `;
    const defended = defendInspectableCode(code, {
        ...INSPECTABLE_FEATURES,
        literals: true,
        mangle: true,
        compress: true
    });

    assert.equal(defended.includes("user_cancelled"), false);
    assert.equal(defended.includes("credential_excluded"), false);
    assert.deepEqual(run(defended), run(code));
});

test("literal protection encodes untagged template text", () => {
    const code = `
        function format(value) {
            return \`hello \${value.message}\`;
        }
        globalThis.__result = format({ message: "world" });
    `;
    const defended = defendInspectableCode(code, {
        ...INSPECTABLE_FEATURES,
        literals: true,
        mangle: true,
        compress: true
    });

    assert.equal(defended.includes("hello "), false);
    assert.deepEqual(run(defended), run(code));
});

test("literal protection encodes regular expression pattern and flags", () => {
    const code = `
        const nativeSource = /\\{\\s*\\[native code\\]\\s*\\}/i;
        globalThis.__result = {
            native: nativeSource.test("function x() { [native code] }"),
            fake: nativeSource.test("function x() { nope }"),
            source: nativeSource.source,
            flags: nativeSource.flags
        };
    `;
    const defended = defendInspectableCode(code, {
        ...INSPECTABLE_FEATURES,
        literals: true,
        mangle: true,
        compress: true
    });

    assert.equal(defended.includes("[native code]"), false);
    assert.equal(defended.includes("\\\\s"), false);
    assert.deepEqual(run(defended), run(code));
});

test("regex obfuscation preserves fresh literal state", () => {
    const code = `
        function hit(value) {
            return /a/g.test(value);
        }
        globalThis.__result = [hit("a"), hit("a")];
    `;
    const defended = defendInspectableCode(code, {
        ...INSPECTABLE_FEATURES,
        literals: true,
        mangle: true,
        compress: true
    });

    assert.deepEqual(run(defended), run(code));
});

test("normalizer preserves single-statement for-of bodies", () => {
    const code = `
        var kit = {
            isArray: Array.isArray,
            keys: Object.keys,
            seal: Object.seal,
            freeze: Object.freeze,
            proxy: null
        };
        function guard(e, n = kit) {
            let seen = new WeakMap(), trap = {}, lock = e => {
                if (typeof e != "object" || !e) return e;
                if (seen.has(e)) return seen.get(e);
                let out = n.isArray(e) ? [] : {}, guarded = out;
                seen.set(e, guarded);
                let record = e;
                for (let e of n.keys(record)) out[e] = lock(record[e]);
                return n.seal(out), n.freeze(out), guarded;
            };
            return lock(e);
        }
        globalThis.__result = guard({ c: [1, 2], r: { a: 1 } });
    `;
    const disabled = Object.fromEntries(Object.keys(FEATURES).map((name) => [name, false]));
    const defended = toildefender.do({
        code,
        modulesCode: {},
        features: {
            ...disabled,
            compress: true
        },
        logLevel: "error",
        runtimeHelpers: false
    }).code;

    assert.deepEqual(run(defended), run(code));
});

test("identifier literal table preserves regular expression literals", () => {
    const code = `
        const nativeSource = /\\{\\s*\\[native code\\]\\s*\\}/;
        globalThis.__result = {
            native: nativeSource.test("function x() { [native code] }"),
            fake: nativeSource.test("function x() { nope }")
        };
    `;
    const defended = defendInspectableCode(code, {
        dead_code: false,
        scope: false,
        control_flow: false,
        identifiers: true,
        numeric_vm: false,
        object_packing: false,
        literals: false,
        mangle: false,
        compress: false
    });

    assert.equal(defended.includes("[object Object]"), false);
    assert.deepEqual(run(defended), run(code));
});

test("identifier literal table leaves hot numeric literals direct", () => {
    const code = `
        let total = 0;
        for (let i = 0; i < 8; i += 1) {
            total += i * 128;
        }
        globalThis.__result = total;
    `;
    const defended = defendInspectableCode(code, {
        dead_code: false,
        scope: false,
        control_flow: false,
        identifiers: true,
        numeric_vm: false,
        object_packing: false,
        literals: false,
        mangle: false,
        compress: false
    });

    assert.match(defended, /total = 0/);
    assert.match(defended, /i < 8/);
    assert.match(defended, /i \* 128/);
    assert.deepEqual(run(defended), run(code));
});

test("scope flattening preserves default parameter initialization", () => {
    const code = `
        function makeKit(root = globalThis) {
            const objectCtor = root.Object ?? Object;
            return objectCtor.keys({ a: 1, b: 2 }).join(",");
        }
        globalThis.__result = {
            omitted: makeKit(),
            explicit: makeKit({ Object })
        };
    `;
    const defended = defendInspectableCode(code, {
        dead_code: false,
        scope: true,
        control_flow: false,
        identifiers: true,
        numeric_vm: false,
        object_packing: true,
        literals: false,
        mangle: true,
        compress: false
    });

    assert.deepEqual(run(defended), run(code));
});

test("scope flattening rewrites shorthand object property values", () => {
    const code = `
        function deriveSeeds(salt) {
            let a = 0x12345678;
            let b = 0x9abcdef0;
            let c = 0x10203040;
            let d = 0x50607080;
            for (let i = 0; i < salt.length; i += 1) {
                a = (a ^ salt[i]) >>> 0;
                b = (b + a + i) >>> 0;
                c = (a ^ b ^ c) >>> 0;
                d = (d + c) >>> 0;
            }
            return { a, b, c, d };
        }
        globalThis.__result = deriveSeeds([3, 5, 8, 13]);
    `;
    const defended = defendInspectableCode(code, {
        dead_code: false,
        scope: true,
        control_flow: false,
        identifiers: false,
        numeric_vm: false,
        object_packing: false,
        literals: false,
        mangle: false,
        compress: false
    });

    assert.deepEqual(run(defended), run(code));
});

test("scope flattening lowers plain object destructuring before bitwise math", () => {
    const code = `
        function words(value) {
            return { lo: value ^ 0x12345678, hi: value ^ 0x9abcdef0 };
        }
        function digest(value) {
            const { lo, hi } = words(value);
            return [(lo ^ 0x243f6a88) >>> 0, (hi ^ 0x85a308d3) >>> 0];
        }
        globalThis.__result = digest(0x0f0f0f0f);
    `;
    const defended = defendInspectableCode(code, {
        dead_code: false,
        scope: true,
        control_flow: false,
        identifiers: false,
        numeric_vm: false,
        object_packing: false,
        literals: false,
        mangle: false,
        compress: false
    });

    assert.deepEqual(run(defended), run(code));
});

test("scope flattening skips empty loop block scope objects", () => {
    const code = `
        function countTo(limit) {
            let x = 0;
            while (x < limit) {
                x += 1;
            }
            return x;
        }
        globalThis.__result = countTo(5);
    `;
    const defended = defendInspectableCode(code, {
        dead_code: false,
        scope: true,
        control_flow: false,
        identifiers: false,
        numeric_vm: false,
        object_packing: false,
        literals: false,
        mangle: false,
        compress: false
    });

    assert.doesNotMatch(defended, /while\s*\([^)]*\)\s*\{\s*var \$\$scope\$[A-Za-z0-9]+\s*=\s*\[\];/);
    assert.deepEqual(run(defended), run(code));
});

test("scope ratio can avoid scope object flattening", () => {
    const code = `
        function total(input) {
            var localValue = input + 1;
            return localValue * 3;
        }
        globalThis.__result = total(4);
    `;
    const features = {
        ...INSPECTABLE_FEATURES,
        identifiers: false,
        mangle: false,
        compress: false
    };
    const flattened = toildefender.do({
        code,
        modulesCode: {},
        forceFeatures: features,
        scope: {
            ratio: 1,
            seed: "scope-ratio-test"
        },
        logLevel: "error"
    }).code;
    const retained = toildefender.do({
        code,
        modulesCode: {},
        forceFeatures: features,
        scope: {
            ratio: 0,
            seed: "scope-ratio-test"
        },
        logLevel: "error"
    }).code;

    assert.match(flattened, /\$\$scope\$/);
    assert.doesNotMatch(retained, /\$\$scope\$/);
    assert.deepEqual(run(flattened), run(code));
    assert.deepEqual(run(retained), run(code));
});

test("scope ratio is respected for program scope when control flow is enabled", () => {
    const code = `
        var topLevel = 7;
        var localValue = topLevel + 3;
        globalThis.__result = localValue * 2;
    `;
    const features = {
        dead_code: false,
        scope: true,
        control_flow: true,
        identifiers: false,
        numeric_vm: false,
        object_packing: false,
        literals: false,
        mangle: false,
        compress: false
    };
    const defended = toildefender.do({
        code,
        modulesCode: {},
        forceFeatures: features,
        scope: {
            ratio: 0,
            seed: "scope-control-flow-program-ratio-test"
        },
        controlFlow: {
            ratio: 0.5,
            seed: "scope-control-flow-program-ratio-test"
        },
        logLevel: "error"
    }).code;

    assert.doesNotMatch(defended, /\$\$scope\$/);
    assert.deepEqual(run(defended), run(code));
});

test("scope flattening keeps loop block locals separate from function helpers", () => {
    const code = `
        function collectRows(globals) {
            const rows = [];
            let index = 0;

            const next = () => {
                index += 1;
                return "n" + String(index).padStart(2, "0");
            };

            const push = (value) => {
                rows.push(next() + ":" + value);
            };

            for (const name of Object.keys(globals)) {
                const value = globals[name];
                push(value.kind);

                const prototype = value.prototype;
                if (prototype) {
                    push(prototype.kind);
                }
            }

            return rows;
        }

        globalThis.__result = collectRows({
            A: { kind: "ctor", prototype: { kind: "proto" } }
        });
    `;
    const defended = defendInspectableCode(code, {
        dead_code: false,
        scope: true,
        control_flow: false,
        identifiers: true,
        numeric_vm: false,
        object_packing: true,
        literals: false,
        mangle: true,
        compress: false
    });

    assert.deepEqual(run(defended), run(code));
});

test("scope flattening lowers array destructuring before moving closure readers", () => {
    const code = `
        function createReader() {
            let pos = 0;
            const readByte = () => {
                pos += 1;
                return pos;
            };
            const readBool = () => readByte() !== 0;
            const readCount = () => readByte() + 10;
            const readString = () => "skip";
            const readBytes = () => [readByte(), readByte()];
            const done = () => pos > 4;
            return [readByte, readBool, readCount, readString, readBytes, done];
        }

        function decode() {
            let [readByte, readBool, readCount, , readBytes, done] = createReader();
            return [
                readByte(),
                readBool(),
                readCount(),
                readBytes(),
                done()
            ];
        }

        globalThis.__result = decode();
    `;
    const defended = defendInspectableCode(code, {
        dead_code: false,
        scope: true,
        control_flow: false,
        identifiers: true,
        numeric_vm: false,
        object_packing: true,
        literals: false,
        mangle: true,
        compress: false
    });

    assert.deepEqual(run(defended), run(code));
});

test("scope flattening keeps returned reader locals separate from module defaults", () => {
    const code = `
        class DecodeFault extends Error {}

        const BOOT = makeKit(globalThis);
        function bootKit() {
            return BOOT;
        }
        function makeKit(root = globalThis) {
            return { root };
        }
        function guardPlainData(value, kit = BOOT) {
            return kit.root ? value : null;
        }

        const MAGIC = [86, 77, 82, 49];

        function createReader(bytes) {
            let offset = 0;
            const readByte = () => {
                if (offset >= bytes.length) throw new DecodeFault("unexpected end");
                const byte = bytes[offset];
                offset += 1;
                return byte ?? 0;
            };
            const readBool = () => readByte() !== 0;
            const done = () => offset === bytes.length;
            return [readByte, readBool, done];
        }

        function open(bytes) {
            let reader = createReader(bytes), [readByte] = reader;
            for (let i = 0; i < MAGIC.length; i += 1) readByte();
            if (readByte() !== 1) throw new DecodeFault("unsupported response version");
            return reader;
        }

        function decode(bytes) {
            const [readByte, readBool, done] = open(bytes);
            const value = {
                bot: readBool(),
                allowed: readBool(),
                mode: readByte() === 1 ? "interactive" : "hidden",
                complete: done()
            };
            return guardPlainData(value, bootKit());
        }

        globalThis.__result = decode([86, 77, 82, 49, 1, 0, 1, 1]);
    `;
    const defended = defendInspectableCode(code, {
        dead_code: false,
        scope: true,
        control_flow: false,
        identifiers: true,
        numeric_vm: false,
        object_packing: true,
        literals: false,
        mangle: true,
        compress: false
    });

    assert.deepEqual(run(defended), run(code));
});

test("normalizer lowers array destructuring in for-of loop declarations", () => {
    const code = `
        function collect(entries) {
            const out = [];
            for (const [key, value] of entries) {
                out.push(key + ":" + value);
            }
            return out;
        }
        globalThis.__result = collect([["a", 1], ["b", 2]]);
    `;
    const defended = defendInspectableCode(code, {
        dead_code: false,
        scope: true,
        control_flow: false,
        identifiers: true,
        numeric_vm: false,
        object_packing: true,
        literals: false,
        mangle: true,
        compress: false
    });

    assert.deepEqual(run(defended), run(code));
});

test("normalizer lowers rest parameters before callback extraction", () => {
    const code = `
        function firstBoolean(...values) {
            return values.find((value) => typeof value === "boolean") ?? null;
        }
        function firstString(...values) {
            return values.find((value) => value.length > 0) ?? "";
        }
        globalThis.__result = {
            bool: firstBoolean(null, undefined, false, true),
            text: firstString("", "ok")
        };
    `;
    const defended = defendInspectableCode(code, {
        dead_code: false,
        scope: true,
        control_flow: false,
        identifiers: true,
        numeric_vm: false,
        object_packing: true,
        literals: false,
        mangle: true,
        compress: false
    });

    assert.deepEqual(run(defended), run(code));
});

async function assertSameAsyncRuntimeResult(code, options) {
    const defended = defendCode(code, options);
    assert.equal(defended.includes("$$defend"), false);
    assert.equal(defended.includes("defendjs"), false);
    assert.deepEqual(await runAsync(defended), await runAsync(code));
}

test("control-flow flattening declares throw sentinel for strict module output", () => {
    const code = `
        try {
            throw new Error("module-strict-sentinel");
        } catch (error) {
            globalThis.__result = {
                message: error.message,
                name: error.name
            };
        }
    `;
    const defended = defendInspectableCode(code, {
        dead_code: false,
        scope: true,
        control_flow: true,
        identifiers: false,
        numeric_vm: false,
        object_packing: false,
        literals: false,
        mangle: false,
        compress: false
    });

    assert.match(defended, /toildefender\$tobethrown/);
    assert.deepEqual(runStrict(defended), run(code));
});

test("control-flow ratio can avoid dispatcher flattening", () => {
    const code = `
        function add(a, b) {
            return a + b;
        }
        function mul(a, b) {
            return a * b;
        }
        globalThis.__result = {
            a: add(2, 3),
            b: mul(4, 5)
        };
    `;
    const features = {
        dead_code: false,
        scope: true,
        control_flow: true,
        identifiers: false,
        numeric_vm: false,
        object_packing: false,
        literals: false,
        mangle: false,
        compress: false
    };
    const full = defendCode(code, {
        forceFeatures: features,
        controlFlow: {
            ratio: 1,
            seed: "ratio-test"
        }
    });
    const skipped = defendCode(code, {
        forceFeatures: features,
        controlFlow: {
            ratio: 0,
            seed: "ratio-test"
        }
    });

    assert.match(full, /function main/);
    assert.doesNotMatch(skipped, /function main/);
    assert.deepEqual(run(full), run(code));
    assert.deepEqual(run(skipped), run(code));
});

test("control-flow call replacement leaves generated declaration identifiers intact", () => {
    const code = `
        function outer(seed) {
            const make = function (value) {
                return function (extra) {
                    return seed + value + extra;
                };
            };
            return make(4);
        }
        const fn = outer(3);
        globalThis.__result = [fn(5), (function (x) { return x * 2; })(6)];
    `;
    const defended = defendCode(code, {
        forceFeatures: {
            dead_code: false,
            scope: true,
            control_flow: true,
            identifiers: true,
            numeric_vm: false,
            object_packing: false,
            literals: true,
            mangle: true,
            compress: true
        },
        controlFlow: {
            ratio: 1,
            seed: "generated-declaration-reference-test"
        },
        scope: {
            ratio: 1,
            seed: "generated-declaration-reference-test"
        }
    });

    assert.deepEqual(run(defended), run(code));
});

test("control-flow emits direct dispatcher calls for immediate calls", () => {
    const code = `
        function add(a, b) {
            return a + b;
        }
        function invoke(fn, value) {
            return fn(value);
        }
        globalThis.__result = [add(2, 3), invoke(function (x) { return x * 2; }, 6)];
    `;
    const defended = defendCode(code, {
        forceFeatures: {
            dead_code: false,
            scope: true,
            control_flow: true,
            identifiers: false,
            numeric_vm: false,
            object_packing: false,
            literals: false,
            mangle: false,
            compress: false
        },
        controlFlow: {
            ratio: 1,
            seed: "direct-dispatch-call-test"
        }
    });

    assert.doesNotMatch(defended, /toildefender\$bind\(main,\s*\d+\)\(/);
    assert.deepEqual(run(defended), run(code));
});

test("method extraction keeps immediately invoked function expressions dispatchable", () => {
    const code = `
        globalThis.__result = (function (x) {
            return x * 2;
        })(6);
    `;
    const defended = defendCode(code, {
        forceFeatures: {
            dead_code: false,
            scope: true,
            control_flow: true,
            identifiers: false,
            numeric_vm: false,
            object_packing: false,
            literals: false,
            mangle: false,
            compress: false
        },
        controlFlow: {
            ratio: 1,
            seed: "iife-direct-dispatch-test"
        }
    });

    assert.doesNotMatch(defended, /toildefender\$bind\(main/);
    assert.deepEqual(run(defended), run(code));
});

test("scope ratio keeps generated literal table reachable under control flow", () => {
    const code = `
        function readValue() {
            return { a: "hello" }.a + " world";
        }
        globalThis.__result = readValue();
    `;
    const defended = toildefender.do({
        code,
        modulesCode: {},
        features: {
            ...FEATURES,
            dead_code: false,
            numeric_vm: false
        },
        scope: {
            ratio: 0,
            seed: "scope-control-flow-literal-test"
        },
        controlFlow: {
            ratio: 0.5,
            seed: "scope-control-flow-literal-test"
        },
        logLevel: "error"
    }).code;

    assert.equal(defended.includes("toildefender$literals"), false);
    assert.deepEqual(run(defended), run(code));
});

test("scope ratio keeps closure-captured locals reachable under control flow", () => {
    const code = `
        function outer(seed) {
            var localValue = seed + 7;
            function inner(input) {
                return localValue + input;
            }
            return inner(3);
        }
        globalThis.__result = outer(11);
    `;
    const defended = toildefender.do({
        code,
        modulesCode: {},
        features: {
            ...FEATURES,
            dead_code: false,
            numeric_vm: false
        },
        scope: {
            ratio: 0,
            seed: "scope-control-flow-closure-test"
        },
        controlFlow: {
            ratio: 0.5,
            seed: "scope-control-flow-closure-test"
        },
        logLevel: "error"
    }).code;

    assert.deepEqual(run(defended), run(code));
});

test("preserves optional chaining and nullish coalescing semantics", () => {
    assertSameRuntimeResult(`
        const rows = [
            { a: { b: 3 } },
            { a: null },
            {},
            { a: { b: 0 } }
        ];
        globalThis.__result = rows.map((row) => row.a?.b ?? 11);
    `);
});

test("preserves class fields, inheritance, spread, and rest semantics", () => {
    assertSameRuntimeResult(`
        class Base {
            base = 4;
            get value() {
                return this.base;
            }
        }
        class Child extends Base {
            extra = 9;
            add(...values) {
                return values.reduce((acc, value) => acc + value, this.value + this.extra);
            }
        }
        const child = new Child();
        const clone = { ...child, total: child.add(1, 2, 3) };
        globalThis.__result = [clone.base, clone.extra, clone.total, child instanceof Base];
    `);
});

test("preserves try/finally return behavior", () => {
    assertSameRuntimeResult(`
        function probe(value) {
            try {
                if (value > 2) return value * 3;
                return value + 1;
            } finally {
                globalThis.side = (globalThis.side ?? 0) + value;
            }
        }
        globalThis.__result = [probe(1), probe(4), globalThis.side];
    `);
});

test("preserves try/finally break and continue behavior", () => {
    assertSameRuntimeResult(`
        const events = [];
        let i = 0;
        while (i < 4) {
            try {
                i++;
                if (i === 1) continue;
                if (i === 3) break;
                events.push("body:" + i);
            } finally {
                events.push("finally:" + i);
            }
        }
        events.push("after:" + i);
        globalThis.__result = events;
    `);
});

test("flattens native async functions with an async dispatcher", async () => {
    const code = `
        async function load(value) {
            const next = await Promise.resolve(value + 2);
            return next * 3;
        }
        load(4).then((value) => {
            globalThis.__result = value;
        });
    `;
    const defended = defendCode(code);

    assert.equal(/_regenerator|asyncGeneratorStep|Generator is already running/.test(defended), false);
    assert.deepEqual(await runAsync(defended), await runAsync(code));
});

test("preserves Babel async regenerator callee bindings when async lowering is requested", {
    skip: hasOptionalBabelTransform() ? false : "optional Babel transform packages are not installed"
}, async () => {
    await assertSameAsyncRuntimeResult(`
        async function load(value) {
            const next = await Promise.resolve(value + 2);
            return next * 3;
        }
        load(4).then((value) => {
            globalThis.__result = value;
        });
    `, {
        babel: true,
        babelPreserveAsync: false
    });
});

test("flattens native generator functions with a generator dispatcher", () => {
    assertSameRuntimeResult(`
        function* values() {
            yield 1;
            return 2;
        }
        const iterator = values();
        globalThis.__result = [
            iterator.next().value,
            iterator.next().value
        ];
    `);
});

test("lowers spread append calls without relying on Babel", () => {
    const code = `
        function collect(moduleRows) {
            var signals = [];
            signals.push(...moduleRows);
            return {
                count: signals.length,
                first: signals[0].id,
                last: signals[signals.length - 1].id
            };
        }
        globalThis.__result = collect([{ id: 1 }, { id: 2 }, { id: 3 }]);
    `;
    const defended = defendCode(code, { babel: false });

    assert.equal(defended.includes("..."), false);
    assert.deepEqual(run(defended), run(code));
});

test("supports common modern AST islands without Babel", () => {
    assertSameRuntimeResult(`
        class Box {
            constructor(value) {
                this.value = value;
            }
            read() {
                const pick = () => this.value + 1;
                return pick();
            }
        }

        const rows = [];
        for (const value of [1, 2, 3]) {
            rows.push(new Box(value).read());
        }

        globalThis.__result = rows;
    `, {
        babel: false
    });
});

test("lowers modern expressions without Babel", () => {
    assertSameRuntimeResult(`
        const obj = {
            x: 2,
            inc(value) {
                return this.x + value;
            }
        };
        const missing = null;
        const source = { a: 1, b: 2, c: 3 };
        const { a, z = 8, ...rest } = source;
        const spread = { ...rest, d: 4 };

        globalThis.__result = [
            obj?.inc?.(3) ?? -1,
            missing?.inc?.(3) ?? "none",
            a,
            z,
            spread.b,
            spread.c,
            spread.d
        ];
    `, {
        babel: false
    });
});

test("lowers class fields and private fields without Babel", () => {
    assertSameRuntimeResult(`
        class Counter {
            #value = 1;
            step = 2;
            static #base = 10;
            static offset = 3;

            set(value) {
                this.#value = value;
            }

            read() {
                return this.#value + this.step + Counter.#base + Counter.offset;
            }
        }

        const counter = new Counter();
        counter.set(5);
        globalThis.__result = counter.read();
    `, {
        babel: false
    });
});

test("control-flow flattener emits declared tobethrown sentinel", () => {
    const code = `
        function probe() {
            try {
                throw new Error("caught");
            } catch (error) {
                return error.message;
            }
        }
        globalThis.__result = probe();
    `;
    const defended = defendInspectableCode(code, {
        dead_code: false,
        scope: true,
        control_flow: true,
        identifiers: false,
        numeric_vm: false,
        object_packing: false,
        literals: false,
        mangle: false,
        compress: false
    });

    assert.match(defended, /var toildefender\$tobethrown(?: = null)?/);
    assert.deepEqual(runStrict(`${defended}
        globalThis.__result = {
            value: globalThis.__result,
            leaked: Object.prototype.hasOwnProperty.call(globalThis, "toildefender$tobethrown")
        };
    `), {
        value: run(code),
        leaked: false
    });
});

test("preserves named function expression self references", () => {
    assertSameRuntimeResult(`
        function use(fn) {
            return fn();
        }
        const value = use(function _callee() {
            return typeof _callee;
        });
        globalThis.__result = value;
    `);
});

test("preserves uncurried prototype method receivers", () => {
    assertSameRuntimeResult(`
        class Target {
            constructor() {
                this.rows = [];
            }
            addEventListener(type, listener, options) {
                if (!(this instanceof Target)) {
                    throw new TypeError("bad receiver");
                }
                this.rows.push([type, typeof listener, options.capture === true]);
            }
        }
        const functionProto = Function.prototype;
        const bind = functionProto.bind;
        const call = functionProto.call;
        const uncurry = (fn) => bind.call(call, fn);
        const add = uncurry(Target.prototype.addEventListener);
        const target = new Target();
        add(target, "click", function handler() {}, { capture: true });
        globalThis.__result = target.rows;
    `);
});

test("preserves browser-global UMD-style script semantics", () => {
    assertSameRuntimeResult(`
        (function (root, factory) {
            root.ToilDefenderTest = factory();
        })(globalThis, function () {
            const registry = [
                function (value) {
                    return value + 1;
                },
                function (value) {
                    return value * 3;
                },
                function (value) {
                    return registry[0](value) + registry[1](value);
                }
            ];

            const api = {
                run: function (value) {
                    return registry.map(function (fn) {
                        return fn(value);
                    });
                },
                nested: function (value) {
                    return registry[2](value);
                }
            };

            return api;
        });

        globalThis.__result = [
            globalThis.ToilDefenderTest.run(4),
            globalThis.ToilDefenderTest.nested(5),
            window.ToilDefenderTest === globalThis.ToilDefenderTest
        ];
    `);
});

test("packs object literal keys into a numeric schema instead of alternating key value pairs", () => {
    const code = `
        globalThis.__result = {
            alpha: 1,
            beta: 2,
            nested: { gamma: 3 }
        };
    `;
    const defended = defendInspectableCode(code);

    assert.match(defended, /toildefender\$toObject\([^,]+,\s*\[[\s\S]*?\]\s*,\s*\[/);
    assert.match(defended, /toildefender\$objectKeys/);
    assert.equal(defended.includes("alpha"), false);
    assert.equal(defended.includes("beta"), false);
    assert.equal(defended.includes("gamma"), false);
    assert.deepEqual(run(defended), run(code));
});

test("can disable object literal arrayization with the object_packing feature flag", () => {
    const code = `
        globalThis.__result = {
            alpha: 1,
            beta: 2
        };
    `;
    const defended = defendInspectableCode(code, {
        ...INSPECTABLE_FEATURES,
        object_packing: false
    });

    assert.doesNotMatch(defended, /toildefender\$toObject\(\s*\[/);
    assert.equal(defended.includes("alpha"), true);
    assert.equal(defended.includes("beta"), true);
    assert.deepEqual(run(defended), run(code));
});

test("object packing injects runtime helper when scope flattening is disabled", () => {
    const code = `
        const packet = {
            count: 2,
            rows: [{ id: 1 }, { id: 2 }]
        };
        globalThis.__result = packet;
    `;
    const defended = defendInspectableCode(code, {
        dead_code: false,
        scope: false,
        control_flow: false,
        identifiers: true,
        numeric_vm: false,
        object_packing: true,
        literals: false,
        mangle: false,
        compress: false
    });

    assert.match(defended, /function toildefender\$toObject/);
    assert.deepEqual(run(defended), run(code));
});

test("object packing helpers are visible from async dispatchers", async () => {
    await assertSameAsyncRuntimeResult(`
        async function collect() {
            await Promise.resolve(1);
            const rows = [
                { id: "alpha", value: 2 },
                { id: "beta", value: 3 }
            ];
            globalThis.__result = rows.map((row) => row.id + ":" + row.value).join("|");
        }

        collect();
    `);
});

test("virtual machine protection emits BigInt literal bytecode and removes source body", () => {
    const code = `
        function bob() {
            return 1 + 1;
        }
        globalThis.__result = bob();
    `;
    const defended = defendVmCode(code);

    assert.match(defended, /\d+n/);
    assert.equal(defended.includes("return 1 + 1"), false);
    assert.equal(defended.includes("BigInt(65537)"), false);
    assert.equal(defended.includes("BigInt(0)"), false);
    assert.deepEqual(run(defended), run(code));
});

test("virtual machine runtime caches encrypted bytecode without emitting decoded tokens", () => {
    const code = `
        function bob(value) {
            var total = value + 4;
            return total * 3;
        }
        globalThis.__result = bob(9);
    `;
    const defended = defendVmCode(code);

    assert.equal(defended.includes("var tokens = []"), false);
    assert.equal(defended.includes("tokens.push"), false);
    assert.doesNotMatch(defended, /toildefender\$numericVm/);
    assert.doesNotMatch(defended, /toildefender\$hashMesh/);
    assert.doesNotMatch(defended, /invalid numeric vm program|invalid virtual opcode/);
    assert.match(defended, /Object\.create\(null\)/);
    assert.deepEqual(run(defended), run(code));
});

test("virtual machine runtime emits computed switch dispatch instead of a linear opcode chain", () => {
    const code = `
        function bob(value) {
            var total = value + 4;
            if (total > 10) return total * 3;
            return total - 2;
        }
        globalThis.__result = [bob(9), bob(1)];
    `;
    const defended = defendVmCode(code);
    const switchIndex = defended.indexOf("switch");
    const dispatchChunk = defended.slice(switchIndex, switchIndex + 8_000);

    assert.notEqual(switchIndex, -1);
    assert.match(dispatchChunk, /case\s+[$_\w]+\[\d+\]:/);
    assert.doesNotMatch(dispatchChunk, /if\s*\([^)]*===\s*[$_\w]+\[\d+\][^)]*\)/);
    assert.deepEqual(run(defended), run(code));
});

test("virtual machine protection preserves nullish coalescing semantics", () => {
    const code = `
        function choose(value) {
            return value ?? "fallback";
        }
        globalThis.__result = [
            choose(0),
            choose(false),
            choose(""),
            choose(null),
            choose(undefined)
        ];
    `;
    const defended = defendVmCode(code);

    assert.match(defended, /\d+n/);
    assert.deepEqual(run(defended), run(code));
});

test("virtual machine protection preserves unary plus coercion", () => {
    const code = `
        function coerce(value) {
            return +value;
        }
        globalThis.__result = [
            coerce("7"),
            Number.isNaN(coerce("nope")),
            Object.is(coerce("-0"), -0)
        ];
    `;
    const defended = defendVmCode(code);

    assert.match(defended, /\d+n/);
    assert.deepEqual(run(defended), run(code));
});

test("virtual machine protection preserves block-local shadowing of parameters", () => {
    const code = `
        function write(out, value) {
            var row = value;
            for (let value = 0; value < 4; value += 1) {
                out.push(row[value] ?? null);
            }
            return out.length;
        }
        var bucket = [];
        globalThis.__result = [write(bucket, [3, 4, 5]), bucket];
    `;
    const defended = defendVmCode(code);

    assert.match(defended, /\d+n/);
    assert.deepEqual(run(defended), run(code));
});

test("virtual machine protection preserves same-name locals in separate blocks", () => {
    const code = `
        function pick(flag) {
            var out = [];
            if (flag) {
                let value = "left";
                out.push(value);
            }
            {
                let value = "right";
                out.push(value);
            }
            return out.join("|");
        }
        globalThis.__result = [pick(true), pick(false)];
    `;
    const defended = defendVmCode(code);

    assert.match(defended, /\d+n/);
    assert.deepEqual(run(defended), run(code));
});

test("virtual machine protection emits fused superinstructions", () => {
    const code = `
        function read(input) {
            var total = input.length;
            total = total + input.value;
            return input.nested.score + total;
        }
        globalThis.__result = read({
            length: 2,
            value: 5,
            nested: { score: 7 }
        });
    `;
    const defended = defendVmCode(code);

    assert.match(defended, /\d+n/);
    assert.doesNotMatch(defended, /ops\[44\].*cgpObj|ops\[45\].*storeLocal/s);
    assert.doesNotMatch(defended, /toildefender\$numericVm/);
    assert.equal(defended.includes("input.nested.score + total"), false);
    assert.deepEqual(run(defended), run(code));
});

test("virtual machine constants decode lazily at access sites", () => {
    const hidden = "unused branch sentinel constant";
    const code = `
        function choose(flag) {
            if (flag) {
                return "${hidden}";
            }
            return "visible";
        }
        globalThis.__result = choose(false);
    `;
    const activeCode = code.replace("choose(false)", "choose(true)");
    const defended = defendVmCode(code);
    const activeDefended = defendVmCode(activeCode);

    assert.match(defended, /\d+n/);
    assert.doesNotMatch(defended, /unused branch sentinel constant/);
    assert.doesNotMatch(defended, /function readConstant|toildefender\$numericVm/);
    assert.deepEqual(run(defended), run(code));
    assert.deepEqual(run(activeDefended), run(activeCode));
});

test("virtual machine protection preserves loops, method calls, arrays, and objects", () => {
    const code = `
        function check(input) {
            var total = 0;
            var i = 0;
            while (i < input.length) {
                total += input.charCodeAt(i);
                i += 1;
            }
            if (input.length > 3 && input.charCodeAt(0) === 70) {
                return { ok: true, total: total, tags: ["vm", input.length] };
            }
            return { ok: false, total: total - 1 };
        }
        globalThis.__result = [check("Felix"), check("bad")];
    `;
    const defended = defendVmCode(code);

    assert.match(defended, /\d+n/);
    assert.deepEqual(run(defended), run(code));
});

test("virtual machine protection preserves closure helper references", () => {
    const code = `
        function helper(value) {
            return value + 3;
        }
        function wrapped(value) {
            return helper(value) * 2;
        }
        globalThis.__result = wrapped(11);
    `;
    const defended = defendHashMeshCode(code);

    assert.match(defended, /\d+n/);
    assert.deepEqual(run(defended), run(code));
});

test("virtual machine protection can be enabled with protections.virtualMachine config", () => {
    const code = `
        function add(a, b) {
            return a + b;
        }
        globalThis.__result = add(4, 5);
    `;
    const result = toildefender.do({
        code,
        modulesCode: {},
        features: {
            ...VM_FEATURES,
            numeric_vm: false
        },
        protections: {
            virtualMachine: {
                enabled: true,
                maxFunctionSize: 30,
                minFunctionSize: 1,
                seed: "public-vm-config",
                virtualize: "all-supported"
            }
        },
        logLevel: "error"
    });

    assert.match(result.code, /\d+n/);
    assert.doesNotMatch(result.code, /toildefender\$numericVm/);
    assert.deepEqual(run(result.code), run(code));
});

test("virtual machine protection can limit selected functions", () => {
    const code = `
        function one(value) {
            return value + 1;
        }
        function two(value) {
            return value * 2;
        }
        globalThis.__result = [one(4), two(5)];
    `;
    const result = toildefender.do({
        code,
        modulesCode: {},
        forceFeatures: VM_FEATURES,
        numericVm: {
            enabled: true,
            maxFunctionSize: 20,
            maxFunctions: 1,
            minFunctionSize: 1,
            seed: "numeric-vm-limit-test",
            virtualize: "all-supported"
        },
        logLevel: "error"
    });

    assert.equal(result.code.includes("return value + 1"), false);
    assert.match(result.code, /return value \* 2/);
    assert.deepEqual(run(result.code), run(code));
});

test("virtual machine protection honors no-vm directive on hot helpers", () => {
    const code = `
        function hot(value) {
            'toildefender:no-numeric-vm';
            var total = 0;
            var i = 0;
            while (i < value.length) {
                total += value.charCodeAt(i);
                i += 1;
            }
            return total;
        }
        function cold(value) {
            return value * 3;
        }
        globalThis.__result = [hot("abc"), cold(7)];
    `;
    const defended = defendVmCode(code);

    assert.match(defended, /function hot/);
    assert.equal(defended.includes("return value * 3"), false);
    assert.deepEqual(run(defended), run(code));
});

test("scope extraction does not bind-wrap numeric VM runtime internals", () => {
    const code = `
        function add(value) {
            return value + 7;
        }
        globalThis.__result = add(5);
    `;
    const result = toildefender.do({
        code,
        modulesCode: {},
        forceFeatures: {
            ...VM_FEATURES,
            scope: true,
            mangle: false,
            compress: false,
            literals: false
        },
        numericVm: {
            enabled: true,
            maxFunctionSize: 20,
            minFunctionSize: 1,
            seed: "numeric-vm-no-runtime-bind",
            virtualize: "all-supported"
        },
        logLevel: "error"
    });

    assert.doesNotMatch(result.code, /toildefender\$numericVm/);
    assert.doesNotMatch(result.code, /toildefender\$hashMesh/);
    assert.deepEqual(run(result.code), run(code));
});

test("hash-mesh unlock encrypts VM bytecode and preserves behavior", () => {
    const code = `
        function locked(input) {
            var score = input.length * 7;
            if (input.charCodeAt(0) === 86) {
                score += 13;
            }
            return score;
        }
        globalThis.__result = [locked("ToilDefender"), locked("bot")];
    `;
    const defended = defendHashMeshCode(code);

    assert.match(defended, /\d+n/);
    assert.doesNotMatch(defended, /toildefender\$hashMesh/);
    assert.equal(defended.includes("score += 13"), false);
    assert.deepEqual(run(defended), run(code));
});

test("hash-mesh unlock makes VM bytecode fail when mesh unlock logic is changed", () => {
    const code = `
        function locked(a, b) {
            return a * 7 + b;
        }
        globalThis.__result = locked(8, 5);
    `;
    const defended = defendHashMeshCode(code);
    const tampered = defended.replace("1398035796", "1398035797");

    assert.notEqual(tampered, defended);
    assert.deepEqual(run(defended), run(code));
    assert.throws(() => run(tampered));
});

test("hash-mesh unlock can be enabled with protections.hashMesh config", () => {
    const code = `
        function locked(value) {
            return value > 4 ? value + 9 : value - 9;
        }
        globalThis.__result = [locked(6), locked(2)];
    `;
    const result = toildefender.do({
        code,
        modulesCode: {},
        features: {
            ...VM_FEATURES,
            numeric_vm: false
        },
        protections: {
            hashMesh: {
                enabled: true,
                mode: "aggressive",
                unlock: "per-function"
            },
            virtualMachine: {
                enabled: true,
                maxFunctionSize: 30,
                minFunctionSize: 1,
                seed: "public-hmesh-config",
                virtualize: "all-supported"
            }
        },
        logLevel: "error"
    });

    assert.doesNotMatch(result.code, /toildefender\$hashMesh/);
    assert.deepEqual(run(result.code), run(code));
});

test("virtual machine protection survives full obfuscation pipeline", () => {
    const code = `
        function packed(input) {
            var rows = [];
            var i = 0;
            while (i < input.length) {
                rows.push(input.charCodeAt(i) + i + 7);
                i += 1;
            }
            return {
                ok: rows.length > 2,
                value: rows[0] + rows[rows.length - 1]
            };
        }
        globalThis.__result = packed("ToilDefender");
    `;
    const result = toildefender.do({
        code,
        modulesCode: {},
        features: {
            ...FEATURES,
            dead_code: false,
            numeric_vm: true
        },
        protections: {
            hashMesh: {
                enabled: true,
                mode: "aggressive",
                unlock: "per-function"
            },
            virtualMachine: {
                enabled: true,
                maxFunctionSize: 400,
                minFunctionSize: 1,
                seed: "full-pipeline-vm",
                virtualize: "all-supported"
            }
        },
        logLevel: "error"
    });

    assert.match(result.code, /\d+n/);
    assert.deepEqual(run(result.code), run(code));
});

test("virtual machine runtime helper names mangle consistently in final mangle", () => {
    const code = `
        class Runner {
            static run(input) {
                return packed(input);
            }
        }
        function packed(input) {
            let value = input.length;
            value += input.charCodeAt(0);
            return value;
        }
        globalThis.__result = Runner.run("ToilDefender");
    `;
    const result = toildefender.do({
        code,
        modulesCode: {},
        features: {
            ...FEATURES,
            dead_code: false,
            numeric_vm: true
        },
        protections: {
            hashMesh: {
                enabled: true,
                mode: "aggressive",
                unlock: "per-function"
            },
            virtualMachine: {
                enabled: true,
                maxFunctionSize: 400,
                minFunctionSize: 1,
                seed: "modern-mangle-vm-runtime-name",
                virtualize: "all-supported"
            }
        },
        logLevel: "error"
    });

    assert.doesNotMatch(result.code, /toildefender\$numericVmString/);
    assert.doesNotMatch(result.code, /toildefender\$numericVmRun/);
    assert.deepEqual(run(result.code), run(code));
});

test("virtual machine runtime helpers stay visible when scope runs without control flow", () => {
    const code = `
        function packed(input) {
            return input.length + input.charCodeAt(0);
        }
        globalThis.__result = packed("ToilDefender");
    `;
    const result = toildefender.do({
        code,
        modulesCode: {},
        features: {
            dead_code: false,
            scope: true,
            control_flow: false,
            identifiers: false,
            numeric_vm: true,
            object_packing: false,
            literals: true,
            mangle: true,
            compress: true
        },
        protections: {
            hashMesh: {
                enabled: true,
                mode: "aggressive",
                unlock: "per-function"
            },
            virtualMachine: {
                enabled: true,
                maxFunctionSize: 400,
                minFunctionSize: 1,
                seed: "scope-no-control-flow-vm-runtime",
                virtualize: "all-supported"
            }
        },
        logLevel: "error"
    });

    assert.deepEqual(run(result.code), run(code));
});
