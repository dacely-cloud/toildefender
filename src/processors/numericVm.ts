import assert from "assert";
import crypto from "crypto";
import * as esprima from "esprima";
import estest from "../estest.js";
import traverser from "../traverser.js";
import type { AstNode, AstStackFrame, LoggerLike } from "../types.js";

const RUNTIME = `
function toildefender$numericVmString(program, length, salt) {
    var out = "";
    var i = 0;
    var base = BigInt(65537);
    while (i < length) {
        var encoded = Number(program % base);
        program = program / base;
        out += String.fromCharCode(encoded ^ ((salt + i * 97) & 65535));
        i += 1;
    }
    return out;
}

function toildefender$numericVmPow(a, b) {
    if (typeof a === "bigint" && typeof b === "bigint") {
        if (b < BigInt(0)) throw new RangeError("BigInt exponent must be positive");
        var out = BigInt(1);
        var base = a;
        var exp = b;
        while (exp > BigInt(0)) {
            if (exp % BigInt(2) === BigInt(1)) out *= base;
            base *= base;
            exp = exp / BigInt(2);
        }
        return out;
    }
    return Math.pow(a, b);
}

function toildefender$numericVmDigit(program, baseBig, index, powers) {
    if (powers) {
        while (powers.length <= index) {
            powers[powers.length] = powers[powers.length - 1] * baseBig;
        }
        return Number((program / powers[index]) % baseBig);
    }
    var pow = BigInt(1);
    while (index > 0) {
        pow *= baseBig;
        index -= 1;
    }
    return Number((program / pow) % baseBig);
}

function toildefender$hashMeshMix(current, value) {
    var h = (current ^ value) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

function toildefender$hashMeshValue(hash, value) {
    if (typeof value === "number") return toildefender$hashMeshMix(hash, value >>> 0);
    if (typeof value === "string") {
        hash = toildefender$hashMeshMix(hash, value.length >>> 0);
        var j = 0;
        while (j < value.length) {
            hash = toildefender$hashMeshMix(hash, value.charCodeAt(j));
            j += 1;
        }
        return hash;
    }
    if (value && typeof value.length === "number") {
        hash = toildefender$hashMeshMix(hash, value.length >>> 0);
        var i = 0;
        while (i < value.length) {
            hash = toildefender$hashMeshValue(hash, value[i]);
            i += 1;
        }
        return hash;
    }
    return toildefender$hashMeshMix(hash, 3735928559);
}

function toildefender$hashMeshKey(mesh, base, tokenCount, seed, tag, ops) {
    var hash = 2166136261;
    hash = toildefender$hashMeshMix(hash, 1145713480);
    hash = toildefender$hashMeshMix(hash, 1296388936);
    hash = toildefender$hashMeshValue(hash, mesh);
    hash = toildefender$hashMeshMix(hash, base >>> 0);
    hash = toildefender$hashMeshMix(hash, tokenCount >>> 0);
    hash = toildefender$hashMeshMix(hash, seed >>> 0);
    hash = toildefender$hashMeshMix(hash, tag >>> 0);
    hash = toildefender$hashMeshValue(hash, ops);
    return hash >>> 0;
}

function toildefender$hashMeshStream(key, index, base, salt) {
    var hash = toildefender$hashMeshMix(key >>> 0, 1398035796);
    hash = toildefender$hashMeshMix(hash, salt >>> 0);
    hash = toildefender$hashMeshMix(hash, index >>> 0);
    hash = toildefender$hashMeshMix(hash, Math.imul(index + 1, 2654435761) >>> 0);
    return hash % base;
}

function toildefender$hashMeshUnlock(program, base, baseBig, index, key, salt, powers) {
    var cipher = toildefender$numericVmDigit(program, baseBig, index, powers);
    return (cipher - toildefender$hashMeshStream(key, index, base, salt) + base) % base;
}

function toildefender$numericVmRun(program, base, tokenCount, seed, tag, constants, argsLike, self, ops, mesh, refs, cache) {
    var baseBig = BigInt(base);
    var meshKey = 0;
    var meshSalt = 0;
    if (mesh) {
        meshKey = toildefender$hashMeshKey(mesh, base, tokenCount, seed, tag, ops);
        meshSalt = mesh[5] >>> 0;
    }
    var encryptedCache = cache && cache[0] || null;
    var stateCache = [seed >>> 0];
    var plainCache = new Array(tokenCount);
    var inverseCache = cache && cache[1] || null;
    if (inverseCache === null) {
        inverseCache = [];
        if (cache) cache[1] = inverseCache;
    }

    function inverse(value, modulo) {
        if (inverseCache[value] !== undefined) return inverseCache[value];
        var t = 0, nt = 1;
        var r = modulo, nr = value % modulo;
        while (nr !== 0) {
            var q = Math.floor(r / nr);
            var ot = t;
            t = nt;
            nt = ot - q * nt;
            var or = r;
            r = nr;
            nr = or - q * nr;
        }
        var out = t < 0 ? t + modulo : t;
        inverseCache[value] = out;
        return out;
    }

    function mix(current, encrypted, index) {
        var mixed = (current ^ (encrypted + 2654435769 + ((current << 6) >>> 0) + (current >>> 2) + index)) >>> 0;
        mixed = Math.imul(mixed ^ (mixed >>> 16), 2246822507) >>> 0;
        return (mixed ^ (mixed >>> 13)) >>> 0;
    }

    function unpackEncrypted() {
        if (encryptedCache !== null) return;
        encryptedCache = new Array(tokenCount);
        var work = program;
        var index = 0;
        while (index < tokenCount) {
            var cipher = Number(work % baseBig);
            work = work / baseBig;
            encryptedCache[index] = mesh ? (cipher - toildefender$hashMeshStream(meshKey, index, base, meshSalt) + base) % base : cipher;
            index += 1;
        }
        if (cache) cache[0] = encryptedCache;
    }

    function encryptedAt(index) {
        unpackEncrypted();
        return encryptedCache[index];
    }

    var i = 0;
    var seen = seed >>> 0;
    while (i < tokenCount) {
        var encrypted = encryptedAt(i);
        seen = mix(seen, encrypted, i);
        stateCache[i + 1] = seen;
        i += 1;
    }

    if ((seen >>> 0) !== (tag >>> 0)) throw new Error("invalid numeric vm program");

    function stateBefore(index) {
        if (stateCache[index] !== undefined) return stateCache[index];
        var cursor = index - 1;
        while (cursor > 0 && stateCache[cursor] === undefined) cursor -= 1;
        var current = stateCache[cursor] === undefined ? seed >>> 0 : stateCache[cursor];
        while (cursor < index) {
            current = mix(current, encryptedAt(cursor), cursor);
            cursor += 1;
            stateCache[cursor] = current;
        }
        return current;
    }

    function decodeAt(index) {
        if (plainCache[index] !== undefined) return plainCache[index];
        var state = stateBefore(index);
        var encrypted = encryptedAt(index);
        var mul = 1 + ((state >>> 5) % (base - 1));
        var add = state % base;
        var plain = (((encrypted - add + base) % base) * inverse(mul, base)) % base;
        plainCache[index] = plain;
        return plain;
    }

    var layout = seed & 1;
    var stack = layout ? null : [];
    var locals = layout ? null : [];
    var cells = layout ? { s: [], l: Object.create(null) } : null;
    var frameArgs = Array.prototype.slice.call(argsLike);
    var ip = 0;

    function push(value) {
        if (layout) cells.s[cells.s.length] = value;
        else stack.push(value);
    }

    function pop() {
        return layout ? cells.s.pop() : stack.pop();
    }

    function peek() {
        var current = layout ? cells.s : stack;
        return current[current.length - 1];
    }

    function loadLocal(slot) {
        return layout ? cells.l["$" + slot] : locals[slot];
    }

    function storeLocal(slot, value) {
        if (layout) cells.l["$" + slot] = value;
        else locals[slot] = value;
        return value;
    }

    function readConstant(index) {
        var cell = constants[index];
        if (cell && cell[0] === 0 && typeof cell[1] === "function") {
            cell[1] = cell[1]();
            cell[0] = 1;
        }
        if (cell && cell[0] === 2 && typeof cell[1] === "function") return cell[1]();
        if (cell && cell[0] === 3) return refs[cell[1]];
        return cell && cell[0] === 1 ? cell[1] : cell;
    }

    function read() {
        if (ip < 0 || ip >= tokenCount) throw new Error("invalid virtual opcode");
        var value = decodeAt(ip);
        ip += 1;
        return value;
    }

    function readUnsigned() {
        var shift = 0;
        var value = 0;
        for (;;) {
            var part = read();
            value += (part & 127) * Math.pow(2, shift);
            if ((part & 128) === 0) return value;
            shift += 7;
        }
    }

    function readSigned() {
        var raw = readUnsigned();
        return (raw & 1) === 0 ? raw / 2 : -((raw + 1) / 2);
    }

    function popArgs(count) {
        var out = new Array(count);
        var i = count;
        while (i > 0) {
            i -= 1;
            out[i] = pop();
        }
        return out;
    }

    while (true) {
        var op = read();
        if (op === ops[0]) continue;
        if (op === ops[1]) { push(undefined); continue; }
        if (op === ops[2]) { push(null); continue; }
        if (op === ops[3]) { push(true); continue; }
        if (op === ops[4]) { push(false); continue; }
        if (op === ops[5]) { push(readUnsigned()); continue; }
        if (op === ops[6]) { push(readConstant(readUnsigned())); continue; }
        if (op === ops[7]) { push(frameArgs[readUnsigned()]); continue; }
        if (op === ops[8]) { push(loadLocal(readUnsigned())); continue; }
        if (op === ops[9]) { storeLocal(readUnsigned(), pop()); continue; }
        if (op === ops[10]) { push(peek()); continue; }
        if (op === ops[11]) { pop(); continue; }
        if (op === ops[12]) { var addB = pop(); var addA = pop(); push(addA + addB); continue; }
        if (op === ops[13]) { var subB = pop(); var subA = pop(); push(subA - subB); continue; }
        if (op === ops[14]) { var mulB = pop(); var mulA = pop(); push(mulA * mulB); continue; }
        if (op === ops[15]) { var divB = pop(); var divA = pop(); push(divA / divB); continue; }
        if (op === ops[16]) { var modB = pop(); var modA = pop(); push(modA % modB); continue; }
        if (op === ops[17]) { var powB = pop(); var powA = pop(); push(toildefender$numericVmPow(powA, powB)); continue; }
        if (op === ops[18]) { push(-pop()); continue; }
        if (op === ops[19]) { push(!pop()); continue; }
        if (op === ops[20]) { push(~pop()); continue; }
        if (op === ops[21]) { var eqB = pop(); var eqA = pop(); push(eqA == eqB); continue; }
        if (op === ops[22]) { var neqB = pop(); var neqA = pop(); push(neqA != neqB); continue; }
        if (op === ops[23]) { var seqB = pop(); var seqA = pop(); push(seqA === seqB); continue; }
        if (op === ops[24]) { var sneB = pop(); var sneA = pop(); push(sneA !== sneB); continue; }
        if (op === ops[25]) { var ltB = pop(); var ltA = pop(); push(ltA < ltB); continue; }
        if (op === ops[26]) { var lteB = pop(); var lteA = pop(); push(lteA <= lteB); continue; }
        if (op === ops[27]) { var gtB = pop(); var gtA = pop(); push(gtA > gtB); continue; }
        if (op === ops[28]) { var gteB = pop(); var gteA = pop(); push(gteA >= gteB); continue; }
        if (op === ops[29]) { var jmp = readSigned(); ip += jmp; continue; }
        if (op === ops[30]) { var jf = readSigned(); if (!pop()) ip += jf; continue; }
        if (op === ops[31]) { var jt = readSigned(); if (pop()) ip += jt; continue; }
        if (op === ops[32]) { readUnsigned(); var argc = readUnsigned(); var ca = popArgs(argc); var fn = pop(); push(fn.apply(undefined, ca)); continue; }
        if (op === ops[33]) { readUnsigned(); var largc = readUnsigned(); var la = popArgs(largc); var lfn = readConstant(readUnsigned()); push(lfn.apply(undefined, la)); continue; }
        if (op === ops[34]) { var gpKey = pop(); var gpObj = pop(); push(gpObj[gpKey]); continue; }
        if (op === ops[35]) { var spValue = pop(); var spKey = pop(); var spObj = pop(); spObj[spKey] = spValue; push(spValue); continue; }
        if (op === ops[36]) { var ac = readUnsigned(); var arr = new Array(ac); var ai = ac; while (ai > 0) { ai -= 1; arr[ai] = pop(); } push(arr); continue; }
        if (op === ops[37]) { var oc = readUnsigned(); var pairs = new Array(oc); var oi = oc; while (oi > 0) { oi -= 1; var ov = pop(); var ok = pop(); pairs[oi] = [ok, ov]; } var obj = {}; var pi = 0; while (pi < oc) { obj[pairs[pi][0]] = pairs[pi][1]; pi += 1; } push(obj); continue; }
        if (op === ops[38]) return pop();
        if (op === ops[39]) throw pop();
        if (op === ops[40]) { push(self); continue; }
        if (op === ops[41]) { push(argsLike); continue; }
        if (op === ops[42]) { push(typeof pop()); continue; }
        if (op === ops[43]) { var mc = readUnsigned(); var ma = popArgs(mc); var mk = pop(); var mo = pop(); push(mo[mk].apply(mo, ma)); continue; }
        if (op === ops[44]) { var cgpKey = readConstant(readUnsigned()); var cgpObj = pop(); push(cgpObj[cgpKey]); continue; }
        if (op === ops[45]) { storeLocal(readUnsigned(), pop()); continue; }
        if (op === ops[46]) { var jn = readSigned(); var nv = pop(); if (nv === null || nv === undefined) ip += jn; continue; }
        if (op === ops[47]) { push(Number(pop())); continue; }
        throw new Error("invalid virtual opcode");
    }
}
`;

const OP_NAMES = [
    "NOP", "PUSH_UNDEFINED", "PUSH_NULL", "PUSH_TRUE", "PUSH_FALSE", "PUSH_SMALL",
    "PUSH_CONST", "LOAD_ARG", "LOAD_LOCAL", "STORE_LOCAL", "DUP", "POP", "ADD",
    "SUB", "MUL", "DIV", "MOD", "POW", "NEG", "NOT", "BIT_NOT", "EQ", "NEQ",
    "STRICT_EQ", "STRICT_NEQ", "LT", "LTE", "GT", "GTE", "JMP", "JMP_FALSE",
    "JMP_TRUE", "CALL_EXT", "CALL_LOCAL", "GET_PROP", "SET_PROP", "MAKE_ARRAY",
    "MAKE_OBJECT", "RETURN", "THROW", "PUSH_THIS", "PUSH_ARGUMENTS", "TYPEOF",
    "CALL_METHOD", "GET_CONST_PROP", "STORE_LOCAL_POP", "JMP_NULLISH", "TO_NUMBER"
] as const;

type OpName = typeof OP_NAMES[number];
type MeshValue = number | MeshValue[];
type ScopeMap = Record<string, number>;

interface Dialect {
    base: number;
    next: () => number;
    opcodes: Record<OpName, number>;
    seed: number;
}

interface HashMeshOptions {
    bindToVmState?: boolean;
    chaffRatio?: number;
    deriveDialectFromMesh?: boolean;
    enabled?: boolean;
    encodeChaff?: boolean;
    mode?: string;
    serverBound?: boolean;
    unlock?: string;
}

interface NumericVmResolvedOptions {
    enabled: boolean;
    excludeNames: string[];
    hashMesh: HashMeshOptions;
    maxFunctionSize: number;
    maxFunctions: number;
    minFunctionSize: number;
    mode: string;
    ratio: number;
    seed: string;
    virtualize: string;
}

interface ConstantEntry {
    kind: string;
    value: unknown;
}

interface Instruction {
    args: Array<number | string>;
    label?: string;
    op?: OpName;
}

interface EncryptedStream {
    encrypted: number[];
    tag: number;
}

interface ProgramRecord {
    base: number;
    blob: bigint;
    constants: AstNode[];
    mesh?: MeshValue[];
    opValues: AstNode[];
    references: AstNode[];
    seed: number;
    tag: number;
    tokenCount: number;
}

interface VmCallRefs {
    cache?: AstNode;
    constants?: AstNode;
    mesh?: AstNode;
    ops?: AstNode;
}

const BASES = [257, 263, 269, 521, 1031, 4099, 65537];
const SMALL_LIMIT = 128;

function nodeFields(node: AstNode): Record<string, unknown> {
    return node as unknown as Record<string, unknown>;
}

function nodeArray(value: unknown): AstNode[] {
    return Array.isArray(value) ? (value as AstNode[]) : [];
}

function childNode(node: AstNode, key: string): AstNode | null {
    const value = nodeFields(node)[key];
    return estest.isNode(value) ? value : null;
}

function requiredChild(node: AstNode, key: string): AstNode {
    const child = childNode(node, key);
    assert.ok(child, `Missing ${node.type}.${key}`);
    return child;
}

function setNodeField(node: AstNode, key: string, value: unknown): void {
    nodeFields(node)[key] = value;
}

function nodeName(node: AstNode | null): string | null {
    const name = (node as { name?: unknown } | null)?.name;
    return typeof name == "string" ? name : null;
}

function nodeValue(node: AstNode | null): unknown {
    return (node as { value?: unknown } | null)?.value;
}

function nodeOperator(node: AstNode): string | null {
    const operator = (node as { operator?: unknown }).operator;
    return typeof operator == "string" ? operator : null;
}

function nodeKind(node: AstNode): string | null {
    const kind = (node as { kind?: unknown }).kind;
    return typeof kind == "string" ? kind : null;
}

function nodeFlag(node: AstNode, key: "async" | "computed" | "generator" | "toildefender$noNumericVm" | "toildefender$numericVmInternal"): boolean {
    return (node as Record<string, unknown>)[key] === true;
}

function bodyArray(node: AstNode): AstNode[] {
    return nodeArray(nodeFields(node).body);
}

function nodeParams(node: AstNode): AstNode[] {
    return nodeArray(nodeFields(node).params);
}

function nodeDeclarations(node: AstNode): AstNode[] {
    return nodeArray(nodeFields(node).declarations);
}

function nodeElements(node: AstNode): Array<AstNode | null> {
    const elements = nodeFields(node).elements;
    return Array.isArray(elements) ? elements.map((element: unknown) => estest.isNode(element) ? element : null) : [];
}

function nodeProperties(node: AstNode): AstNode[] {
    return nodeArray(nodeFields(node).properties);
}

function nodeExpressions(node: AstNode): AstNode[] {
    return nodeArray(nodeFields(node).expressions);
}

function nodeArguments(node: AstNode): AstNode[] {
    return nodeArray(nodeFields(node).arguments);
}

function literal(value: unknown): AstNode { return { type: "Literal", value: value }; }
function identifier(name: string): AstNode { return { type: "Identifier", name: name }; }
function call(callee: AstNode, args: AstNode[]): AstNode { return { type: "CallExpression", callee: callee, arguments: args }; }
function binary(operator: string, left: AstNode, right: AstNode): AstNode { return { type: "BinaryExpression", operator: operator, left: left, right: right }; }
function unary(operator: string, argument: AstNode): AstNode { return { type: "UnaryExpression", operator: operator, prefix: true, argument: argument }; }
function member(object: AstNode, property: AstNode): AstNode { return { type: "MemberExpression", object: object, property: property, computed: true }; }
function arrayExpression(values: AstNode[]): AstNode { return { type: "ArrayExpression", elements: values }; }
function returnStatement(argument: AstNode): AstNode { return { type: "ReturnStatement", argument: argument }; }
function functionExpression(body: AstNode[]): AstNode { return { type: "FunctionExpression", id: null, params: [], body: { type: "BlockStatement", body: body }, generator: false, expression: false, async: false }; }
function variableDeclaration(name: string, init: AstNode): AstNode {
    return {
        type: "VariableDeclaration",
        kind: "var",
        declarations: [
            {
                type: "VariableDeclarator",
                id: identifier(name),
                init: init
            }
        ]
    };
}

function functionName(node: AstNode): string {
    return nodeName(childNode(node, "id")) || "";
}

function markNumericVmInternal(ast: AstNode): AstNode {
    return traverser.traverse(ast, [], function (node: AstNode) {
        if (estest.isFunction(node)) {
            setNodeField(node, "toildefender$numericVmInternal", true);
        }
        return node;
    });
}

function hashSeed(seed: unknown): number {
    return crypto.createHash("sha256").update(String(seed)).digest().readUInt32LE(0) || 1;
}

function makeRng(seed: number): () => number {
    let state = seed >>> 0;
    return function () {
        state ^= state << 13; state >>>= 0;
        state ^= state >>> 17; state >>>= 0;
        state ^= state << 5; state >>>= 0;
        return state >>> 0;
    };
}

function shuffle<T>(values: T[], next: () => number): T[] {
    const copy = values.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = next() % (i + 1);
        const tmp = copy[i];
        copy[i] = copy[j];
        copy[j] = tmp;
    }
    return copy;
}

function bigintLiteral(value: bigint | number): AstNode {
    const bigint = typeof value === "bigint" ? value : BigInt(value);
    const raw = bigint.toString();
    return { type: "Literal", value: bigint, bigint: raw, raw: raw + "n" };
}

function replaceStaticBigIntCalls(ast: AstNode): AstNode {
    return traverser.traverse(ast, [], function (node: AstNode) {
        const callee = childNode(node, "callee");
        const args = nodeArguments(node);
        const firstArg = args[0];
        const firstValue = nodeValue(firstArg);
        if (node.type === "CallExpression"
            && callee?.type === "Identifier"
            && nodeName(callee) === "BigInt"
            && args.length === 1
            && firstArg?.type === "Literal"
            && typeof firstValue === "number"
            && Number.isInteger(firstValue)
        ) {
            return bigintLiteral(firstValue);
        }
        return node;
    });
}

function bigintExpression(value: bigint, next: () => number): AstNode {
    const radixBits = 26n;
    const radix = 1n << radixBits;
    const chunks: bigint[] = [];
    let work = value < 0n ? -value : value;
    if (work === 0n) chunks.push(0n);
    while (work > 0n) {
        chunks.push(work % radix);
        work = work / radix;
    }

    let expr = bigintLiteral(chunks[chunks.length - 1]);
    for (let i = chunks.length - 2; i >= 0; i -= 1) {
        expr = binary("+", binary("<<", expr, bigintLiteral(radixBits)), bigintLiteral(chunks[i]));
    }
    if (value < 0n) expr = { type: "UnaryExpression", operator: "-", prefix: true, argument: expr };

    const xorKey = BigInt((next() & 65535) + 1);
    const addKey = BigInt((next() & 65535) + 1);
    return binary("^", binary("-", binary("+", binary("^", expr, bigintLiteral(xorKey)), bigintLiteral(addKey)), bigintLiteral(addKey)), bigintLiteral(xorKey));
}

function stringBlob(value: string, salt: number): bigint {
    const base = 65537n;
    let pow = 1n;
    let out = 0n;
    for (let i = 0; i < value.length; i += 1) {
        out += BigInt(value.charCodeAt(i) ^ ((salt + i * 97) & 65535)) * pow;
        pow *= base;
    }
    return out;
}

function encodeUnsigned(value: number): number[] {
    const out: number[] = [];
    let current = value >>> 0;
    do {
        const part = current & 127;
        current = Math.floor(current / 128);
        out.push(current > 0 ? part | 128 : part);
    } while (current > 0);
    return out;
}

function encodeSigned(value: number): number[] {
    return encodeUnsigned(value >= 0 ? value * 2 : (-value * 2) - 1);
}

function signedLengthFor(target: number, start: number, beforeOperand: number): number {
    let len = 1;
    for (;;) {
        const next = encodeSigned(target - (start + beforeOperand + len)).length;
        if (next === len) return len;
        len = next;
    }
}

function mix(current: number, encrypted: number, index: number): number {
    let mixed = (current ^ (encrypted + 2654435769 + ((current << 6) >>> 0) + (current >>> 2) + index)) >>> 0;
    mixed = Math.imul(mixed ^ (mixed >>> 16), 2246822507) >>> 0;
    return (mixed ^ (mixed >>> 13)) >>> 0;
}

function meshMix(current: number, value: number): number {
    let h = (current ^ value) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

function meshValue(hash: number, value: unknown): number {
    if (typeof value === "number") return meshMix(hash, value >>> 0);
    if (Array.isArray(value)) {
        hash = meshMix(hash, value.length >>> 0);
        for (let i = 0; i < value.length; i += 1) {
            hash = meshValue(hash, value[i]);
        }
        return hash;
    }
    return meshMix(hash, 3735928559);
}

function meshKey(mesh: MeshValue[], base: number, tokenCount: number, seed: number, tag: number, ops: number[]): number {
    let hash = 2166136261;
    hash = meshMix(hash, 1145713480);
    hash = meshMix(hash, 1296388936);
    hash = meshValue(hash, mesh);
    hash = meshMix(hash, base >>> 0);
    hash = meshMix(hash, tokenCount >>> 0);
    hash = meshMix(hash, seed >>> 0);
    hash = meshMix(hash, tag >>> 0);
    hash = meshValue(hash, ops);
    return hash >>> 0;
}

function meshStream(key: number, index: number, base: number, salt: number): number {
    let hash = meshMix(key >>> 0, 1398035796);
    hash = meshMix(hash, salt >>> 0);
    hash = meshMix(hash, index >>> 0);
    hash = meshMix(hash, Math.imul(index + 1, 2654435761) >>> 0);
    return hash % base;
}

function textDigest(value: string): number {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
        hash = meshMix(hash, value.charCodeAt(i));
    }
    return hash >>> 0;
}

function normalizeRatio(value: unknown): number {
    const ratio = Number(value);
    if (!Number.isFinite(ratio)) return 1;
    if (ratio < 0) return 0;
    if (ratio > 1) return 1;
    return ratio;
}

function normalizeMaxFunctions(value: unknown): number {
    if (value === undefined || value === null) return Infinity;
    const max = Number(value);
    if (!Number.isFinite(max)) return Infinity;
    return Math.max(0, Math.floor(max));
}

function selectionScore(options: NumericVmResolvedOptions, node: AstNode, index: number): number {
    const name = functionName(node);
    const body = childNode(node, "body");
    const bodySize = body ? bodyArray(body).length : 0;
    return textDigest(`${options.seed}:${index}:${name}:${bodySize}`) / 0x100000000;
}

function constantDigest(constants: ConstantEntry[]): number {
    let hash = textDigest("DJS-HMESH/constants/v1");
    for (let i = 0; i < constants.length; i += 1) {
        const constant = constants[i];
        hash = meshMix(hash, textDigest(constant.kind));
        hash = meshMix(hash, textDigest(String(constant.value)));
    }
    return hash >>> 0;
}

function meshExpression(value: MeshValue): AstNode {
    if (Array.isArray(value)) {
        return arrayExpression(value.map(meshExpression));
    }
    return literal(value >>> 0);
}

function encryptedStream(tokens: number[], base: number, seed: number): EncryptedStream {
    let state = seed >>> 0;
    let tag = seed >>> 0;
    const encrypted: number[] = [];
    for (let i = 0; i < tokens.length; i += 1) {
        const mul = 1 + ((state >>> 5) % (base - 1));
        const add = state % base;
        const value = (tokens[i] * mul + add) % base;
        encrypted.push(value);
        state = mix(state, value, i);
        tag = mix(tag, value, i);
    }
    return { encrypted: encrypted, tag: tag >>> 0 };
}

function packTokens(tokens: number[], base: number): bigint {
    let out = 0n;
    let pow = 1n;
    const bigBase = BigInt(base);
    tokens.forEach(function (token: number) {
        out += BigInt(token) * pow;
        pow *= bigBase;
    });
    return out;
}

function makeChaff(next: () => number, tokenCount: number, ratio: number): number[] {
    const length = Math.max(4, Math.min(32, Math.ceil(tokenCount * ratio / 16)));
    const chaff: number[] = [];
    for (let i = 0; i < length; i += 1) {
        chaff.push(next() >>> 0);
    }
    return chaff;
}

function buildHashMeshRecord(record: ProgramRecord, encryptedTokens: number[], opValues: number[], constants: ConstantEntry[], dialect: Dialect, options: HashMeshOptions & { seed?: string }): void {
    const ratio = typeof options.chaffRatio === "number" ? options.chaffRatio : 0.55;
    const buildSalt = hashSeed(`${options.seed || "toildefender-hmesh"}:DJS-HMESH/build/v1`);
    const functionId = meshMix(buildSalt, dialect.seed);
    const chunkId = dialect.next() >>> 0;
    const constDigest = constantDigest(constants);
    const previousDigest = meshMix(meshMix(buildSalt, functionId), chunkId);
    const streamSalt = dialect.next() >>> 0;
    let flags = 0;
    if (options.bindToVmState !== false) flags |= 1;
    if (options.deriveDialectFromMesh) flags |= 2;
    if (options.encodeChaff !== false) flags |= 4;
    const chaff = options.encodeChaff === false ? [] : makeChaff(dialect.next, record.tokenCount, ratio);
    const mesh: MeshValue[] = [
        buildSalt >>> 0,
        functionId >>> 0,
        chunkId >>> 0,
        constDigest >>> 0,
        previousDigest >>> 0,
        streamSalt >>> 0,
        flags >>> 0,
        textDigest("DJS-HMESH/chunk-key/v1") >>> 0,
        chaff
    ];
    const key = meshKey(mesh, record.base, record.tokenCount, record.seed, record.tag, opValues);
    const cipher = encryptedTokens.map(function (token: number, index: number) {
        return (token + meshStream(key, index, record.base, streamSalt)) % record.base;
    });
    record.blob = packTokens(cipher, record.base);
    record.mesh = mesh;
}

function isSimplePattern(node: AstNode | null): boolean {
    return node?.type === "Identifier";
}

function containsNestedFunction(node: AstNode): boolean {
    let found = false;
    traverser.traverseEx(node, [], function (this: { abort(): void }, child: AstNode) {
        if (child !== node && estest.isFunction(child)) {
            found = true;
            this.abort();
        }
        return child;
    });
    return found;
}

class Compiler {
    fn: AstNode;
    dialect: Dialect;
    options: NumericVmResolvedOptions;
    instructions: Instruction[] = [];
    labelId = 0;
    params: Record<string, number> = {};
    functionScope: ScopeMap = Object.create(null) as ScopeMap;
    scopeStack: ScopeMap[] = [];
    localCount = 0;
    constants: ConstantEntry[] = [];
    constantKeys: Record<string, number> = Object.create(null) as Record<string, number>;
    references: string[] = [];
    referenceKeys: Record<string, number> = Object.create(null) as Record<string, number>;

    constructor(fn: AstNode, dialect: Dialect, options: NumericVmResolvedOptions) {
        this.fn = fn;
        this.dialect = dialect;
        this.options = options;
    }

    label(): string { return `L${this.labelId++}`; }
    mark(name: string): void { this.instructions.push({ label: name, args: [] }); }
    emit(op: OpName, ...args: Array<number | string>): void { this.instructions.push({ op: op, args: args }); }

    pushScope(): ScopeMap {
        const scope = Object.create(null) as ScopeMap;
        this.scopeStack.push(scope);
        return scope;
    }

    popScope(): void {
        this.scopeStack.pop();
    }

    currentScope(): ScopeMap {
        if (this.scopeStack.length === 0) return this.pushScope();
        return this.scopeStack[this.scopeStack.length - 1];
    }

    declareLocal(name: string, functionScoped: boolean): number {
        const scope = functionScoped ? this.functionScope : this.currentScope();
        if (!Object.prototype.hasOwnProperty.call(scope, name)) scope[name] = this.localCount++;
        return scope[name];
    }

    resolveLocal(name: string): number | null {
        for (let i = this.scopeStack.length - 1; i >= 0; i -= 1) {
            const scope = this.scopeStack[i];
            if (Object.prototype.hasOwnProperty.call(scope, name)) return scope[name];
        }
        if (Object.prototype.hasOwnProperty.call(this.functionScope, name)) return this.functionScope[name];
        return null;
    }

    addConstant(kind: string, value: unknown): number {
        const key = kind + ":" + String(value);
        if (Object.prototype.hasOwnProperty.call(this.constantKeys, key)) return this.constantKeys[key];
        const index = this.constants.length;
        this.constantKeys[key] = index;
        this.constants.push({ kind: kind, value: value });
        return index;
    }

    addReference(value: unknown): number {
        const key = String(value);
        if (Object.prototype.hasOwnProperty.call(this.referenceKeys, key)) return this.referenceKeys[key];
        const index = this.references.length;
        this.referenceKeys[key] = index;
        this.references.push(key);
        return index;
    }

    validateBindings(): void {
        nodeParams(this.fn).forEach((param: AstNode, index: number) => {
            if (!isSimplePattern(param)) throw new Error("unsupported parameter pattern");
            this.params[nodeName(param) || ""] = index;
        });
        const body = requiredChild(this.fn, "body");
        traverser.traverseEx(body, [], function (this: { abort(): void }, node: AstNode) {
            if (node !== body && estest.isFunction(node)) {
                this.abort();
                return node;
            }
            if (node.type === "VariableDeclarator" && !isSimplePattern(childNode(node, "id"))) {
                throw new Error("unsupported declaration pattern");
            }
            return node;
        });
    }

    compile(): ProgramRecord {
        const body = requiredChild(this.fn, "body");
        if (body.type !== "BlockStatement") throw new Error("unsupported function body");
        if (containsNestedFunction(body)) throw new Error("nested functions are not virtualized");
        this.validateBindings();
        this.pushScope();
        this.compileBlock(body, false);
        this.popScope();
        this.emit("PUSH_UNDEFINED");
        this.emit("RETURN");
        return this.finish();
    }

    compileBlock(block: AstNode, createScope: boolean): void {
        if (createScope) this.pushScope();
        bodyArray(block).forEach((stmt: AstNode) => { this.compileStatement(stmt); });
        if (createScope) this.popScope();
    }

    compileStatement(stmt: AstNode): void {
        switch (stmt.type) {
            case "BlockStatement": this.compileBlock(stmt, true); return;
            case "VariableDeclaration":
                for (let i = 0; i < nodeDeclarations(stmt).length; i += 1) {
                    const decl = nodeDeclarations(stmt)[i];
                    const id = requiredChild(decl, "id");
                    const slot = this.declareLocal(nodeName(id) || "", nodeKind(stmt) === "var");
                    const init = childNode(decl, "init");
                    if (init) this.compileExpression(init); else this.emit("PUSH_UNDEFINED");
                    this.emit("STORE_LOCAL", slot);
                }
                return;
            case "ExpressionStatement": this.compileExpression(requiredChild(stmt, "expression")); this.emit("POP"); return;
            case "ReturnStatement": {
                const argument = childNode(stmt, "argument");
                if (argument) this.compileExpression(argument); else this.emit("PUSH_UNDEFINED");
                this.emit("RETURN");
                return;
            }
            case "IfStatement": {
                const elseLabel = this.label();
                const endLabel = this.label();
                this.compileExpression(requiredChild(stmt, "test"));
                this.emit("JMP_FALSE", elseLabel);
                this.compileStatement(requiredChild(stmt, "consequent"));
                this.emit("JMP", endLabel);
                this.mark(elseLabel);
                const alternate = childNode(stmt, "alternate");
                if (alternate) this.compileStatement(alternate);
                this.mark(endLabel);
                return;
            }
            case "WhileStatement": {
                const start = this.label();
                const end = this.label();
                this.mark(start);
                this.compileExpression(requiredChild(stmt, "test"));
                this.emit("JMP_FALSE", end);
                this.compileStatement(requiredChild(stmt, "body"));
                this.emit("JMP", start);
                this.mark(end);
                return;
            }
            case "EmptyStatement": return;
            default: throw new Error("unsupported statement " + stmt.type);
        }
    }

    compileExpression(expr: AstNode): void {
        switch (expr.type) {
            case "Literal": this.compileLiteral(expr); return;
            case "Identifier": this.compileIdentifier(nodeName(expr) || ""); return;
            case "ThisExpression": this.emit("PUSH_THIS"); return;
            case "ArrayExpression": this.compileArray(expr); return;
            case "ObjectExpression": this.compileObject(expr); return;
            case "UnaryExpression": this.compileUnary(expr); return;
            case "BinaryExpression": this.compileBinary(expr); return;
            case "LogicalExpression": this.compileLogical(expr); return;
            case "AssignmentExpression": this.compileAssignment(expr); return;
            case "MemberExpression": this.compileMember(expr); return;
            case "CallExpression": this.compileCall(expr); return;
            case "ConditionalExpression": this.compileConditional(expr); return;
            case "SequenceExpression":
                for (let i = 0; i < nodeExpressions(expr).length; i += 1) {
                    this.compileExpression(nodeExpressions(expr)[i]);
                    if (i + 1 < nodeExpressions(expr).length) this.emit("POP");
                }
                return;
            default: throw new Error("unsupported expression " + expr.type);
        }
    }

    compileLiteral(expr: AstNode): void {
        const value = nodeValue(expr);
        if (nodeFields(expr).regex) throw new Error("regex literals are unsupported");
        if (value === null) this.emit("PUSH_NULL");
        else if (value === true) this.emit("PUSH_TRUE");
        else if (value === false) this.emit("PUSH_FALSE");
        else if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < SMALL_LIMIT) this.emit("PUSH_SMALL", value);
        else this.emit("PUSH_CONST", this.addConstant(typeof value, value));
    }

    compileIdentifier(name: string): void {
        if (name === "undefined") this.emit("PUSH_UNDEFINED");
        else if (name === "arguments") this.emit("PUSH_ARGUMENTS");
        else {
            const slot = this.resolveLocal(name);
            if (slot !== null) this.emit("LOAD_LOCAL", slot);
            else if (Object.prototype.hasOwnProperty.call(this.params, name)) this.emit("LOAD_ARG", this.params[name]);
            else this.emit("PUSH_CONST", this.addConstant("reference", name));
        }
    }

    compileArray(expr: AstNode): void {
        const elements = nodeElements(expr);
        for (let i = 0; i < elements.length; i += 1) {
            const element = elements[i];
            if (element === null) this.emit("PUSH_UNDEFINED");
            else this.compileExpression(element);
        }
        this.emit("MAKE_ARRAY", elements.length);
    }

    compileObject(expr: AstNode): void {
        const properties = nodeProperties(expr);
        for (let i = 0; i < properties.length; i += 1) {
            const prop = properties[i];
            const kind = nodeKind(prop);
            if (kind && kind !== "init") throw new Error("unsupported object property kind");
            if (prop.type === "SpreadElement") throw new Error("unsupported object spread");
            const keyNode = requiredChild(prop, "key");
            const key = nodeFlag(prop, "computed") ? null : nodeName(keyNode) || nodeValue(keyNode);
            if (key === null) this.compileExpression(keyNode); else this.emit("PUSH_CONST", this.addConstant("string", String(key)));
            this.compileExpression(requiredChild(prop, "value"));
        }
        this.emit("MAKE_OBJECT", properties.length);
    }

    compileUnary(expr: AstNode): void {
        const operator = nodeOperator(expr);
        if (operator === "void") {
            this.compileExpression(requiredChild(expr, "argument"));
            this.emit("POP");
            this.emit("PUSH_UNDEFINED");
            return;
        }
        this.compileExpression(requiredChild(expr, "argument"));
        if (operator === "-") this.emit("NEG");
        else if (operator === "!") this.emit("NOT");
        else if (operator === "~") this.emit("BIT_NOT");
        else if (operator === "typeof") this.emit("TYPEOF");
        else if (operator === "+") this.emit("TO_NUMBER");
        else throw new Error("unsupported unary operator " + String(operator));
    }

    compileBinary(expr: AstNode): void {
        this.compileExpression(requiredChild(expr, "left"));
        this.compileExpression(requiredChild(expr, "right"));
        const map: Record<string, OpName> = { "+": "ADD", "-": "SUB", "*": "MUL", "/": "DIV", "%": "MOD", "**": "POW", "==": "EQ", "!=": "NEQ", "===": "STRICT_EQ", "!==": "STRICT_NEQ", "<": "LT", "<=": "LTE", ">": "GT", ">=": "GTE" };
        const operator = nodeOperator(expr) || "";
        if (!map[operator]) throw new Error("unsupported binary operator " + operator);
        this.emit(map[operator]);
    }

    compileLogical(expr: AstNode): void {
        const end = this.label();
        const operator = nodeOperator(expr);
        if (operator === "??") {
            const right = this.label();
            this.compileExpression(requiredChild(expr, "left"));
            this.emit("DUP");
            this.emit("JMP_NULLISH", right);
            this.emit("JMP", end);
            this.mark(right);
            this.emit("POP");
            this.compileExpression(requiredChild(expr, "right"));
            this.mark(end);
            return;
        }
        if (operator !== "&&" && operator !== "||") throw new Error("unsupported logical operator " + String(operator));
        this.compileExpression(requiredChild(expr, "left"));
        this.emit("DUP");
        this.emit(operator === "&&" ? "JMP_FALSE" : "JMP_TRUE", end);
        this.emit("POP");
        this.compileExpression(requiredChild(expr, "right"));
        this.mark(end);
    }

    compileAssignment(expr: AstNode): void {
        const left = requiredChild(expr, "left");
        const operator = nodeOperator(expr);
        if (left.type === "Identifier") {
            const name = nodeName(left) || "";
            const slot = this.resolveLocal(name);
            if (slot === null) throw new Error("unsupported assignment target " + name);
            if (operator === "=") this.compileExpression(requiredChild(expr, "right"));
            else {
                const map: Record<string, OpName> = { "+=": "ADD", "-=": "SUB", "*=": "MUL", "/=": "DIV", "%=": "MOD" };
                if (!operator || !map[operator]) throw new Error("unsupported assignment operator " + String(operator));
                this.compileIdentifier(name);
                this.compileExpression(requiredChild(expr, "right"));
                this.emit(map[operator]);
            }
            this.emit("DUP");
            this.emit("STORE_LOCAL", slot);
            return;
        }
        if (left.type === "MemberExpression" && operator === "=") {
            this.compileExpression(requiredChild(left, "object"));
            this.compilePropertyKey(left);
            this.compileExpression(requiredChild(expr, "right"));
            this.emit("SET_PROP");
            return;
        }
        throw new Error("unsupported assignment expression");
    }

    compilePropertyKey(expr: AstNode): void {
        if (nodeFlag(expr, "computed")) this.compileExpression(requiredChild(expr, "property"));
        else this.emit("PUSH_CONST", this.addConstant("string", nodeName(requiredChild(expr, "property")) || ""));
    }

    compileMember(expr: AstNode): void {
        this.compileExpression(requiredChild(expr, "object"));
        this.compilePropertyKey(expr);
        this.emit("GET_PROP");
    }

    compileCall(expr: AstNode): void {
        const callee = requiredChild(expr, "callee");
        const args = nodeArguments(expr);
        if (callee.type === "MemberExpression") {
            this.compileExpression(requiredChild(callee, "object"));
            this.compilePropertyKey(callee);
            for (let i = 0; i < args.length; i += 1) this.compileExpression(args[i]);
            this.emit("CALL_METHOD", args.length);
            return;
        }
        this.compileExpression(callee);
        for (let j = 0; j < args.length; j += 1) this.compileExpression(args[j]);
        this.emit("CALL_EXT", 0, args.length);
    }

    compileConditional(expr: AstNode): void {
        const alternate = this.label();
        const end = this.label();
        this.compileExpression(requiredChild(expr, "test"));
        this.emit("JMP_FALSE", alternate);
        this.compileExpression(requiredChild(expr, "consequent"));
        this.emit("JMP", end);
        this.mark(alternate);
        this.compileExpression(requiredChild(expr, "alternate"));
        this.mark(end);
    }

    instructionSize(instr: Instruction, positions: Map<Instruction | string, number>): number {
        if (instr.label) return 0;
        const start = positions.get(instr) || 0;
        let size = 1;
        for (let i = 0; i < instr.args.length; i += 1) {
            const arg = instr.args[i];
            if (typeof arg === "string") size += signedLengthFor(positions.get(arg) || 0, start, size);
            else size += encodeUnsigned(arg).length;
        }
        return size;
    }

    isInstruction(instr: Instruction | undefined, op: OpName): instr is Instruction & { op: OpName } {
        return Boolean(instr && !instr.label && instr.op === op);
    }

    fuseSuperinstructions(): void {
        const out: Instruction[] = [];
        for (let i = 0; i < this.instructions.length; i += 1) {
            const one = this.instructions[i];
            const two = this.instructions[i + 1];
            const three = this.instructions[i + 2];
            if (this.isInstruction(one, "PUSH_CONST") && this.isInstruction(two, "GET_PROP")) {
                out.push({ op: "GET_CONST_PROP", args: [ one.args[0] ] });
                i += 1;
                continue;
            }
            if (this.isInstruction(one, "DUP") && this.isInstruction(two, "STORE_LOCAL") && this.isInstruction(three, "POP")) {
                out.push({ op: "STORE_LOCAL_POP", args: [ two.args[0] ] });
                i += 2;
                continue;
            }
            out.push(one);
        }
        this.instructions = out;
    }

    assemble(): number[] {
        const positions = new Map<Instruction | string, number>();
        let stable = false;
        while (!stable) {
            stable = true;
            let cursor = 0;
            for (let i = 0; i < this.instructions.length; i += 1) {
                const instr = this.instructions[i];
                if (instr.label) {
                    if (positions.get(instr.label) !== cursor) stable = false;
                    positions.set(instr.label, cursor);
                } else {
                    positions.set(instr, cursor);
                    cursor += this.instructionSize(instr, positions);
                }
            }
        }
        const tokens: number[] = [];
        for (let j = 0; j < this.instructions.length; j += 1) {
            const op = this.instructions[j];
            if (op.label) continue;
            assert.ok(op.op);
            const start = tokens.length;
            tokens.push(this.dialect.opcodes[op.op]);
            for (let k = 0; k < op.args.length; k += 1) {
                const arg = op.args[k];
                if (typeof arg === "string") {
                    const before = tokens.length - start;
                    const target = positions.get(arg) || 0;
                    const len = signedLengthFor(target, start, before);
                    const rel = target - (start + before + len);
                    encodeSigned(rel).forEach(function (value: number) { tokens.push(value); });
                } else {
                    encodeUnsigned(arg).forEach(function (value: number) { tokens.push(value); });
                }
            }
        }
        return tokens;
    }

    constantExpression(constant: ConstantEntry): AstNode {
        const next = this.dialect.next;
        if (constant.kind === "number") {
            const value = Number(constant.value);
            if (Number.isNaN(value)) return binary("/", literal(0), literal(0));
            if (value === Infinity) return binary("/", literal(1), literal(0));
            if (value === -Infinity) return { type: "UnaryExpression", operator: "-", prefix: true, argument: binary("/", literal(1), literal(0)) };
            return literal(value);
        }
        if (constant.kind === "string" || constant.kind === "reference") {
            const value = String(constant.value);
            const salt = (next() & 65535) || 1;
            const decoded = call(identifier("toildefender$numericVmString"), [ bigintExpression(stringBlob(value, salt), next), literal(value.length), literal(salt) ]);
            if (constant.kind === "reference") {
                return {
                    type: "ConditionalExpression",
                    test: binary("===", unary("typeof", identifier(value)), literal("undefined")),
                    consequent: member(identifier("globalThis"), decoded),
                    alternate: identifier(value)
                };
            }
            return decoded;
        }
        if (constant.kind === "boolean") return literal(Boolean(constant.value));
        if (constant.kind === "undefined") return { type: "UnaryExpression", operator: "void", prefix: true, argument: literal(0) };
        throw new Error("unsupported constant " + constant.kind);
    }

    referenceExpression(value: unknown): AstNode {
        const next = this.dialect.next;
        const name = String(value);
        const salt = (next() & 65535) || 1;
        const decoded = call(identifier("toildefender$numericVmString"), [ bigintExpression(stringBlob(name, salt), next), literal(name.length), literal(salt) ]);
        return {
            type: "ConditionalExpression",
            test: binary("===", unary("typeof", identifier(name)), literal("undefined")),
            consequent: member(identifier("globalThis"), decoded),
            alternate: identifier(name)
        };
    }

    constantCellExpression(constant: ConstantEntry): AstNode {
        if (constant.kind === "reference") {
            return arrayExpression([
                literal(3),
                literal(this.addReference(constant.value))
            ]);
        }
        if (constant.kind !== "string" && constant.kind !== "reference") {
            return this.constantExpression(constant);
        }
        const lazy = functionExpression([ returnStatement(this.constantExpression(constant)) ]);
        setNodeField(lazy, "toildefender$numericVmInternal", true);
        return arrayExpression([
            literal(constant.kind === "reference" ? 2 : 0),
            lazy
        ]);
    }

    finish(): ProgramRecord {
        this.fuseSuperinstructions();
        const tokens = this.assemble();
        const encrypted = encryptedStream(tokens, this.dialect.base, this.dialect.seed);
        const opValues = OP_NAMES.map((name: OpName) => this.dialect.opcodes[name]);
        const record: ProgramRecord = {
            base: this.dialect.base,
            blob: packTokens(encrypted.encrypted, this.dialect.base),
            constants: this.constants.map(this.constantCellExpression.bind(this)),
            opValues: opValues.map(literal),
            references: this.references.map(this.referenceExpression.bind(this)),
            seed: this.dialect.seed,
            tag: encrypted.tag,
            tokenCount: tokens.length
        };
        if (this.options.hashMesh.enabled) {
            buildHashMeshRecord(record, encrypted.encrypted, opValues, this.constants, this.dialect, Object.assign({}, this.options.hashMesh, {
                seed: this.options.seed
            }));
        }
        return record;
    }
}

function makeDialect(seedText: string): Dialect {
    const seed = hashSeed(seedText);
    const next = makeRng(seed);
    const values = shuffle(Array.from({ length: OP_NAMES.length }, function (_: unknown, index: number) { return index + 1; }), next);
    const opcodes = Object.create(null) as Record<OpName, number>;
    OP_NAMES.forEach(function (name: OpName, index: number) { opcodes[name] = values[index]; });
    return { base: BASES[next() % BASES.length], next: next, opcodes: opcodes, seed: seed };
}

function vmCall(record: ProgramRecord, next: () => number, refs: VmCallRefs = {}): AstNode {
    return call(identifier("toildefender$numericVmRun"), [
        bigintExpression(record.blob, next),
        literal(record.base),
        literal(record.tokenCount),
        literal(record.seed),
        literal(record.tag),
        refs.constants || arrayExpression(record.constants),
        identifier("arguments"),
        { type: "ThisExpression" },
        refs.ops || arrayExpression(record.opValues),
        refs.mesh || (record.mesh ? meshExpression(record.mesh) : literal(null)),
        arrayExpression(record.references || []),
        refs.cache || arrayExpression([])
    ]);
}

function objectOptions(value: unknown): Record<string, unknown> {
    return typeof value == "object" && value !== null ? value as Record<string, unknown> : {};
}

function resolveOptions(options: unknown): NumericVmResolvedOptions {
    const input = objectOptions(options);
    const hashMeshInput = objectOptions(input.hashMesh);
    return {
        enabled: input.enabled === true,
        excludeNames: Array.isArray(input.excludeNames) ? input.excludeNames.map(String) : [],
        maxFunctionSize: typeof input.maxFunctionSize == "number" ? input.maxFunctionSize : 120,
        maxFunctions: normalizeMaxFunctions(input.maxFunctions ?? Infinity),
        minFunctionSize: typeof input.minFunctionSize == "number" ? input.minFunctionSize : 1,
        mode: typeof input.mode == "string" ? input.mode : "balanced",
        ratio: normalizeRatio(input.ratio ?? 1),
        seed: typeof input.seed == "string" ? input.seed : "toildefender-numeric-vm",
        hashMesh: {
            bindToVmState: hashMeshInput.bindToVmState !== false,
            chaffRatio: typeof hashMeshInput.chaffRatio == "number" ? hashMeshInput.chaffRatio : 0.55,
            deriveDialectFromMesh: hashMeshInput.deriveDialectFromMesh === true,
            enabled: hashMeshInput.enabled === true,
            encodeChaff: hashMeshInput.encodeChaff !== false,
            mode: typeof hashMeshInput.mode == "string" ? hashMeshInput.mode : "balanced",
            serverBound: hashMeshInput.serverBound === true,
            unlock: typeof hashMeshInput.unlock == "string" ? hashMeshInput.unlock : "per-function"
        },
        virtualize: typeof input.virtualize == "string" ? input.virtualize : "marked"
    };
}

export default class NumericVm {
    logger: LoggerLike;
    options: NumericVmResolvedOptions;
    count: number;

    constructor(logger: LoggerLike, options: unknown) {
        this.logger = logger;
        this.options = resolveOptions(options);
        this.count = 0;
    }

    shouldTry(node: AstNode): boolean {
        if (!this.options.enabled || !estest.isFunction(node) || nodeFlag(node, "generator") || nodeFlag(node, "async")) return false;
        const body = childNode(node, "body");
        if (!body || body.type !== "BlockStatement") return false;
        if (nodeFlag(node, "toildefender$noNumericVm")) return false;
        const name = functionName(node);
        if (name.indexOf("toildefender$numericVm") === 0) return false;
        if (this.options.excludeNames.indexOf(name) >= 0) return false;
        const bodySize = bodyArray(body).length;
        if (bodySize < this.options.minFunctionSize || bodySize > this.options.maxFunctionSize) return false;
        if (this.options.virtualize === "all-supported") return true;
        if (this.options.virtualize === "heuristic") return bodySize >= this.options.minFunctionSize;
        return false;
    }

    apply(ast: AstNode): AstNode {
        assert.ok(estest.isNode(ast));
        if (!this.options.enabled) return ast;

        const runtime = markNumericVmInternal(replaceStaticBigIntCalls(esprima.parseScript(RUNTIME) as unknown as AstNode));
        let transformed = 0;
        let candidateIndex = 0;
        const dataDeclarations: AstNode[] = [];
        const trace = typeof process !== "undefined" && process.env && process.env.TOILDEFENDER_NUMERIC_VM_TRACE === "1";

        ast = traverser.traverse(ast, [], (node: AstNode) => {
            if (!this.shouldTry(node)) return node;
            const currentIndex = candidateIndex;
            candidateIndex += 1;
            if (transformed >= this.options.maxFunctions) return node;
            if (this.options.ratio <= 0 || selectionScore(this.options, node, currentIndex) >= this.options.ratio) return node;
            try {
                const body = childNode(node, "body");
                const originalBodySize = body ? bodyArray(body).length : 0;
                const dialect = makeDialect(`${this.options.seed}:${transformed}:${functionName(node)}`);
                const record = new Compiler(node, dialect, this.options).compile();
                const dataName = `toildefender$numericVmData$${transformed}`;
                const opsName = `toildefender$numericVmOps$${transformed}`;
                const meshName = `toildefender$numericVmMesh$${transformed}`;
                const cacheName = `toildefender$numericVmCache$${transformed}`;
                const declarations = [
                    variableDeclaration(dataName, arrayExpression(record.constants)),
                    variableDeclaration(opsName, arrayExpression(record.opValues)),
                    variableDeclaration(meshName, record.mesh ? meshExpression(record.mesh) : literal(null)),
                    variableDeclaration(cacheName, arrayExpression([]))
                ];
                declarations.forEach(function (declaration: AstNode) {
                    setNodeField(declaration, "toildefender$numericVmInternal", true);
                    dataDeclarations.push(declaration);
                });
                setNodeField(node, "body", { type: "BlockStatement", body: [ returnStatement(vmCall(record, dialect.next, {
                    cache: identifier(cacheName),
                    constants: identifier(dataName),
                    mesh: identifier(meshName),
                    ops: identifier(opsName)
                })) ] });
                transformed += 1;
                if (trace) {
                    console.error(JSON.stringify({
                        event: "numeric_vm_transformed",
                        index: transformed,
                        candidateIndex: currentIndex,
                        name: functionName(node),
                        bodySize: originalBodySize
                    }));
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (this.options.virtualize === "all-supported") this.logger.warn("numeric_vm skipped " + functionName(node) + ": " + message);
            }
            return node;
        });

        if (transformed > 0) {
            setNodeField(ast, "body", bodyArray(runtime).concat(dataDeclarations).concat(bodyArray(ast)));
        }
        this.count = transformed;
        return ast;
    }
}
