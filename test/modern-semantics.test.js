"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const toildefender = require("../toildefender");

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

function runStrict(code) {
    return run(`"use strict";\n${code}`);
}

function defendCode(code) {
    const result = toildefender.do({
        code,
        modulesCode: {},
        features: FEATURES,
        logLevel: "error"
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

function assertSameRuntimeResult(code) {
    const defended = defendCode(code);
    assert.equal(defended.includes("$$defend"), false);
    assert.equal(defended.includes("defendjs"), false);
    assert.deepEqual(run(defended), run(code));
}

async function assertSameAsyncRuntimeResult(code) {
    const defended = defendCode(code);
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

    assert.match(defended, /veilmark\$tobethrown/);
    assert.deepEqual(runStrict(defended), run(code));
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

test("preserves Babel async regenerator callee bindings", async () => {
    await assertSameAsyncRuntimeResult(`
        async function load(value) {
            const next = await Promise.resolve(value + 2);
            return next * 3;
        }
        load(4).then((value) => {
            globalThis.__result = value;
        });
    `);
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

    assert.match(defended, /var veilmark\$tobethrown(?: = null)?/);
    assert.deepEqual(runStrict(`${defended}
        globalThis.__result = {
            value: globalThis.__result,
            leaked: Object.prototype.hasOwnProperty.call(globalThis, "veilmark$tobethrown")
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
            root.VeilmarkTest = factory();
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
            globalThis.VeilmarkTest.run(4),
            globalThis.VeilmarkTest.nested(5),
            window.VeilmarkTest === globalThis.VeilmarkTest
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

    assert.match(defended, /veilmark\$toObject\(\s*\[[\s\S]*?\]\s*,\s*\[/);
    assert.equal(defended.includes("alpha"), false);
    assert.equal(defended.includes("beta"), false);
    assert.equal(defended.includes("gamma"), false);
    assert.deepEqual(run(defended), run(code));
});

test("can disable object key packing with the object_packing feature flag", () => {
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

    assert.match(defended, /veilmark\$toObject\(\s*\[/);
    assert.equal(defended.includes("alpha"), true);
    assert.equal(defended.includes("beta"), true);
    assert.deepEqual(run(defended), run(code));
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

test("virtual machine runtime streams bytecode instead of materializing decoded tokens", () => {
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
    assert.match(defended, /function veilmark\$numericVmDigit/);
    assert.match(defended, /var layout = seed & 1/);
    assert.match(defended, /Object\.create\(null\)/);
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
    const getConstProp = /if \(op === ops\[44\]\) \{[\s\S]*?continue;\n        \}/;
    const storeLocalPop = /if \(op === ops\[45\]\) \{[\s\S]*?continue;\n        \}/;
    const brokenGetConstProp = defended.replace(
        getConstProp,
        "if (op === ops[44]) { throw new Error('fused get const prop'); }"
    );
    const brokenStoreLocalPop = defended.replace(
        storeLocalPop,
        "if (op === ops[45]) { throw new Error('fused store local pop'); }"
    );

    assert.match(defended, getConstProp);
    assert.match(defended, storeLocalPop);
    assert.notEqual(brokenGetConstProp, defended);
    assert.notEqual(brokenStoreLocalPop, defended);
    assert.deepEqual(run(defended), run(code));
    assert.throws(() => run(brokenGetConstProp), /fused get const prop/);
    assert.throws(() => run(brokenStoreLocalPop), /fused store local pop/);
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
    const marker = "    return out;\n}\nfunction veilmark$numericVmPow";
    const guard = "    if (out === " + JSON.stringify(hidden) + ") throw new Error(\"unused constant decoded\");\n    return out;\n}\nfunction veilmark$numericVmPow";
    const defended = defendVmCode(code);
    const activeDefended = defendVmCode(activeCode);
    const guarded = defended.replace(marker, guard);
    const activeGuarded = activeDefended.replace(marker, guard);

    assert.notEqual(guarded, defended);
    assert.notEqual(activeGuarded, activeDefended);
    assert.match(defended, /function readConstant/);
    assert.deepEqual(run(guarded), run(code));
    assert.throws(() => run(activeGuarded), /unused constant decoded/);
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
        globalThis.__result = [locked("Veilmark"), locked("bot")];
    `;
    const defended = defendHashMeshCode(code);

    assert.match(defended, /veilmark\$hashMeshUnlock/);
    assert.match(defended, /\d+n/);
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
    const tampered = defended.replace(
        "function veilmark$hashMeshStream(key, index, base, salt) {",
        "function veilmark$hashMeshStream(key, index, base, salt) { key = (key + 1) >>> 0;"
    );

    assert.deepEqual(run(defended), run(code));
    assert.throws(() => run(tampered), /invalid numeric vm program|invalid virtual opcode/);
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

    assert.match(result.code, /veilmark\$hashMeshUnlock/);
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
        globalThis.__result = packed("Veilmark");
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
