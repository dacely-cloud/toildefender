// A class method must keep its receiver (`this`) after obfuscation when it
// threads `this` into module-level helpers that the obfuscator extracts and/or
// virtualizes. This is the SHAPE downlevelers (oxc/esbuild) emit for `#private`
// fields: module-scoped WeakMaps + brand-check + get/set helpers (comma-sequence
// returns) called from class methods with `this`.
//
// NOTE: this guards the reducible case. The full-bundle regression that motivated
// it (numeric_vm × dead_code dropping `this` inside a method on a large bundle)
// could not be minimized into a synthetic input; it only reproduces on the real
// ToilGate bundle. See CHANGELOG / numeric_vm × dead_code notes.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import toildefender from "../build/toildefender.js";

function run(code) {
    const context = vm.createContext({ Object, String, WeakMap, TypeError, Error, console });
    context.globalThis = context;
    vm.runInContext(code, context, { timeout: 2000 });
    return JSON.parse(JSON.stringify(context.__result));
}

const CAPTCHA = {
    dead_code: false, scope: true, control_flow: true, identifiers: true,
    numeric_vm: true, object_packing: true, literals: true, mangle: true, compress: true,
};

function defend(code, features) {
    return toildefender.do({
        code, modulesCode: {}, logLevel: "error", runtimeHelpers: true, simplify: true, features,
        controlFlow: { ratio: 0.05, seed: "t-cf" },
        scope: { ratio: 0.8, seed: "t-scope" },
        protections: {
            virtualMachine: {
                enabled: features.numeric_vm, mode: "aggressive", bigintBytecode: true,
                randomizedOpcodes: true, encodeConstants: true, perFunctionDialect: true,
                virtualize: "all-supported", minFunctionSize: 1, maxFunctionSize: 80,
                maxFunctions: 512, ratio: 1, seed: "t-vm",
            },
            hashMesh: {
                enabled: features.numeric_vm, mode: "aggressive", unlock: "per-function",
                deriveDialectFromMesh: true, bindToVmState: true, encodeChaff: true,
                chaffRatio: 0.55, serverBound: false,
            },
        },
    }).code;
}

const PRIVATE_FIELD_SHAPE = `
"use strict";
var S0 = new WeakMap(), S1 = new WeakMap();
function brand(map, obj) { if (!map.has(obj)) throw new TypeError("private"); return obj; }
function padd(map, obj, val) { if (map.has(obj)) throw new TypeError("dup"); return map.set(obj, val), val; }
function pget(map, obj) { return map.get(brand(map, obj)); }
function pset(map, obj, val) { return map.set(brand(map, obj), val), val; }
function spread(base, extra, tail) { var out = Object.assign({}, base, extra); for (var k in tail) out[k] = tail[k]; return out; }
function decode(v) { return String(v); }
var DEF = "/api";
var Klass = class K {
    constructor() { padd(S0, this, 7); padd(S1, this, null); }
    setup(o) { return pset(S1, this, spread({ base: DEF, theme: "auto" }, o, { sitekey: decode(o.sitekey) })), this; }
    require() { if (pget(S1, this) === null) throw new Error("not setup"); return pget(S1, this); }
    init() { var s = this.require(); return s.base + s.sitekey; }
    run() { var s = this.require(); return s.theme + pget(S0, this); }
};
globalThis.K = Klass;
globalThis.__result = (function () {
    var k = new Klass();
    var self = k.setup({ sitekey: "X", extra: 9 });
    return { same: self === k, init: k.init(), run: k.run() };
})();
`;

test("class method keeps `this` through virtualized private-field helpers (full captcha)", () => {
    const expected = run(PRIVATE_FIELD_SHAPE);
    assert.deepEqual(expected, { same: true, init: "/apiX", run: "auto7" });
    assert.deepEqual(run(defend(PRIVATE_FIELD_SHAPE, CAPTCHA)), expected);
});

test("class method keeps `this` with the VM disabled", () => {
    assert.deepEqual(run(defend(PRIVATE_FIELD_SHAPE, { ...CAPTCHA, numeric_vm: false })), run(PRIVATE_FIELD_SHAPE));
});
