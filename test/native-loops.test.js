import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { protect } from '../build/toildefender.js';

const nativeFeatures = {
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
    ['for-of lexical bindings', 'let sum=0; for(const value of [1,2,3]) sum+=value; globalThis.result=sum;'],
    ['loop closure bindings', 'const functions=[];for(let i=0;i<3;i++) functions.push(()=>i);globalThis.result=functions.map(fn=>fn());'],
    ['continue executes update', 'let sum=0;for(let i=0;i<5;i++){if(i===2)continue;sum+=i;}globalThis.result=sum;'],
    ['omitted condition', 'let i=0;for(;;){if(++i===3)break;}globalThis.result=i;'],
    ['Set and Map iteration', 'let sum=0;for(const n of new Set([2,3]))sum+=n;for(const [key,n] of new Map([["a",4]]))sum+=n;globalThis.result=sum;'],
    ['inherited enumerable properties', 'const value=Object.create({inherited:2});value.own=3;let sum=0;for(const key in value)sum+=value[key];globalThis.result=sum;'],
    ['iterator close on break', 'let closed=false;function* values(){try{yield 1;yield 2;}finally{closed=true;}}for(const n of values())break;globalThis.result=closed;'],
]) {
    test(`native protection preserves ${name}`, () => {
        const expected = execute(code);
        for (let iteration = 0; iteration < 3; iteration++) {
            const output = protect({ code, forceFeatures: nativeFeatures, logLevel: 'error' }).code;
            assert.equal(execute(output), expected);
        }
    });
}

test('default protection supports for loops with omitted conditions', () => {
    const code = 'var i=0;for(;;){if(++i===3)break;}globalThis.result=i;';
    assert.equal(execute(protect({ code, logLevel: 'error' }).code), execute(code));
});
