import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { protect } from '../build/toildefender.js';

const features = {
    dead_code: false, scope: false, control_flow: false,
    identifiers: true, numeric_vm: false, object_packing: true,
    literals: true, mangle: true, compress: true,
};

function execute(code) {
    const context = vm.createContext({});
    vm.runInContext(code, context, { timeout: 2000 });
    return JSON.stringify(context.result);
}

for (const [name, code] of [
    ['private methods, fields and brands', `class Counter { #value=2; #read(){return this.#value;} read(){return this.#read();} has(value){return #value in value;} } const c=new Counter();globalThis.result=[c.read(),c.has(c),c.has({})];`],
    ['static initialization and class self references', `class Counter { static #value=1; static { this.#value++; } static read(){return Counter.#value;} }globalThis.result=Counter.read();`],
    ['private names in nested classes', `class Outer { #value=1; create(){return new class { #value=2; read(){return this.#value;} }();} read(){return this.#value;} }const o=new Outer();globalThis.result=[o.read(),o.create().read()];`],
    ['class inheritance', `class Parent { #value=3; read(){return this.#value;} }class Child extends Parent { #value=4; read(){return super.read()+this.#value;} }globalThis.result=new Child().read();`],
    ['optional chains and nullish defaults', `const value={item:{count:2}};globalThis.result=[value?.item?.count,null?.item??5];`],
    ['default parameters and destructuring', `const fallback=7;function read({value=fallback}={}){const fallback=9;return value;}globalThis.result=read();`],
    ['iterator cleanup and lexical captures', `let closed=false;function* values(){try{yield 2;yield 3;}finally{closed=true;}}const callbacks=[];for(const value of values()){callbacks.push(()=>value);break;}globalThis.result=[closed,callbacks[0]()];`],
    ['BigInts and object spreads', `const first={a:2n};const second={...first,b:3n};globalThis.result=String(second.a+second.b);`],
]) {
    test(`native syntax preserves ${name}`, () => {
        for (let iteration = 0; iteration < 3; iteration++) {
            const result = protect({ code, nativeSyntax: true, forceFeatures: features, logLevel: 'error' });
            assert.equal(execute(result.code), execute(code));
            if (code.includes('#value')) {
                assert.ok(result.code.includes('#'));
                assert.ok(!result.code.includes('#value'));
                assert.ok(!result.code.includes('new WeakMap'));
            }
        }
    });
}

test('native syntax rejects incompatible scope and VM passes', () => {
    assert.throws(() => protect({ code: 'globalThis.result=1;', nativeSyntax: true }), /requires scope/u);
});

test('native string encoding handles large UTF-16 values without argument overflow', () => {
    const text = 'a😀\u0000'.repeat(40000);
    const code = `globalThis.result = ${JSON.stringify(text)};`;
    const output = protect({ code, nativeSyntax: true, forceFeatures: features, logLevel: 'error' }).code;
    assert.equal(execute(output), execute(code));
});

test('native templates preserve tag raw strings and substitution coercion', () => {
    const code = 'const item={toString(){return "string";},valueOf(){return 2;}};function tag(parts,...values){return [parts.raw,values];}globalThis.result=[`${item}`,tag`line\\n${item}`];';
    assert.equal(execute(protect({ code, nativeSyntax: true, forceFeatures: features, logLevel: 'error' }).code), execute(code));
});

test('native module metadata survives script-body wrapping', async () => {
    const code = 'globalThis.__toilNativeUrl = import.meta.url;';
    const output = protect({ code, nativeSyntax: true, forceFeatures: features, logLevel: 'error' }).code;
    try {
        await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
        assert.match(globalThis.__toilNativeUrl, /^data:/u);
    } finally {
        delete globalThis.__toilNativeUrl;
    }
});
