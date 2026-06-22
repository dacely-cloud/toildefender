import assert from "assert";
import crypto from "crypto";
import esprima from "esprima";
import estest from "../estest.js";
import traverser from "../traverser.js";

var RUNTIME = `
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

var OP_NAMES = [
    "NOP", "PUSH_UNDEFINED", "PUSH_NULL", "PUSH_TRUE", "PUSH_FALSE", "PUSH_SMALL",
    "PUSH_CONST", "LOAD_ARG", "LOAD_LOCAL", "STORE_LOCAL", "DUP", "POP", "ADD",
    "SUB", "MUL", "DIV", "MOD", "POW", "NEG", "NOT", "BIT_NOT", "EQ", "NEQ",
    "STRICT_EQ", "STRICT_NEQ", "LT", "LTE", "GT", "GTE", "JMP", "JMP_FALSE",
    "JMP_TRUE", "CALL_EXT", "CALL_LOCAL", "GET_PROP", "SET_PROP", "MAKE_ARRAY",
    "MAKE_OBJECT", "RETURN", "THROW", "PUSH_THIS", "PUSH_ARGUMENTS", "TYPEOF",
    "CALL_METHOD", "GET_CONST_PROP", "STORE_LOCAL_POP", "JMP_NULLISH", "TO_NUMBER"
];

var BASES = [257, 263, 269, 521, 1031, 4099, 65537];
var SMALL_LIMIT = 128;

function literal(value) { return { type: "Literal", value: value }; }
function identifier(name) { return { type: "Identifier", name: name }; }
function call(callee, args) { return { type: "CallExpression", callee: callee, arguments: args }; }
function binary(operator, left, right) { return { type: "BinaryExpression", operator: operator, left: left, right: right }; }
function unary(operator, argument) { return { type: "UnaryExpression", operator: operator, prefix: true, argument: argument }; }
function member(object, property) { return { type: "MemberExpression", object: object, property: property, computed: true }; }
function arrayExpression(values) { return { type: "ArrayExpression", elements: values }; }
function returnStatement(argument) { return { type: "ReturnStatement", argument: argument }; }
function functionExpression(body) { return { type: "FunctionExpression", id: null, params: [], body: { type: "BlockStatement", body: body }, generator: false, expression: false, async: false }; }
function variableDeclaration(name, init) {
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
function functionName(node) { return node.id && node.id.name ? node.id.name : ""; }

function markNumericVmInternal(ast) {
    return traverser.traverse(ast, [], function (node) {
        if (estest.isFunction(node)) {
            node.toildefender$numericVmInternal = true;
        }
        return node;
    });
}

function hashSeed(seed) {
    return crypto.createHash("sha256").update(String(seed)).digest().readUInt32LE(0) || 1;
}

function makeRng(seed) {
    var state = seed >>> 0;
    return function () {
        state ^= state << 13; state >>>= 0;
        state ^= state >>> 17; state >>>= 0;
        state ^= state << 5; state >>>= 0;
        return state >>> 0;
    };
}

function shuffle(values, next) {
    var copy = values.slice();
    for (var i = copy.length - 1; i > 0; i -= 1) {
        var j = next() % (i + 1);
        var tmp = copy[i];
        copy[i] = copy[j];
        copy[j] = tmp;
    }
    return copy;
}

function bigintLiteral(value) {
    var bigint = typeof value === "bigint" ? value : BigInt(value);
    var raw = bigint.toString();
    return { type: "Literal", value: bigint, bigint: raw, raw: raw + "n" };
}

function replaceStaticBigIntCalls(ast) {
    return traverser.traverse(ast, [], function (node) {
        if (node.type === "CallExpression"
            && node.callee.type === "Identifier"
            && node.callee.name === "BigInt"
            && node.arguments.length === 1
            && node.arguments[0].type === "Literal"
            && typeof node.arguments[0].value === "number"
            && Number.isInteger(node.arguments[0].value)
        ) {
            return bigintLiteral(node.arguments[0].value);
        }
        return node;
    });
}

function bigintExpression(value, next) {
    var radixBits = 26n;
    var radix = 1n << radixBits;
    var chunks = [];
    var work = value < 0n ? -value : value;
    if (work === 0n) chunks.push(0n);
    while (work > 0n) {
        chunks.push(work % radix);
        work = work / radix;
    }

    var expr = bigintLiteral(chunks[chunks.length - 1]);
    for (var i = chunks.length - 2; i >= 0; i -= 1) {
        expr = binary("+", binary("<<", expr, bigintLiteral(radixBits)), bigintLiteral(chunks[i]));
    }
    if (value < 0n) expr = { type: "UnaryExpression", operator: "-", prefix: true, argument: expr };

    var xorKey = BigInt((next() & 65535) + 1);
    var addKey = BigInt((next() & 65535) + 1);
    return binary("^", binary("-", binary("+", binary("^", expr, bigintLiteral(xorKey)), bigintLiteral(addKey)), bigintLiteral(addKey)), bigintLiteral(xorKey));
}

function stringBlob(value, salt) {
    var base = 65537n;
    var pow = 1n;
    var out = 0n;
    for (var i = 0; i < value.length; i += 1) {
        out += BigInt(value.charCodeAt(i) ^ ((salt + i * 97) & 65535)) * pow;
        pow *= base;
    }
    return out;
}

function encodeUnsigned(value) {
    var out = [];
    var current = value >>> 0;
    do {
        var part = current & 127;
        current = Math.floor(current / 128);
        out.push(current > 0 ? part | 128 : part);
    } while (current > 0);
    return out;
}

function encodeSigned(value) {
    return encodeUnsigned(value >= 0 ? value * 2 : (-value * 2) - 1);
}

function signedLengthFor(target, start, beforeOperand) {
    var len = 1;
    for (;;) {
        var next = encodeSigned(target - (start + beforeOperand + len)).length;
        if (next === len) return len;
        len = next;
    }
}

function mix(current, encrypted, index) {
    var mixed = (current ^ (encrypted + 2654435769 + ((current << 6) >>> 0) + (current >>> 2) + index)) >>> 0;
    mixed = Math.imul(mixed ^ (mixed >>> 16), 2246822507) >>> 0;
    return (mixed ^ (mixed >>> 13)) >>> 0;
}

function meshMix(current, value) {
    var h = (current ^ value) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

function meshValue(hash, value) {
    if (typeof value === "number") return meshMix(hash, value >>> 0);
    if (Array.isArray(value)) {
        hash = meshMix(hash, value.length >>> 0);
        for (var i = 0; i < value.length; i += 1) {
            hash = meshValue(hash, value[i]);
        }
        return hash;
    }
    return meshMix(hash, 3735928559);
}

function meshKey(mesh, base, tokenCount, seed, tag, ops) {
    var hash = 2166136261;
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

function meshStream(key, index, base, salt) {
    var hash = meshMix(key >>> 0, 1398035796);
    hash = meshMix(hash, salt >>> 0);
    hash = meshMix(hash, index >>> 0);
    hash = meshMix(hash, Math.imul(index + 1, 2654435761) >>> 0);
    return hash % base;
}

function textDigest(value) {
    var hash = 2166136261;
    for (var i = 0; i < value.length; i += 1) {
        hash = meshMix(hash, value.charCodeAt(i));
    }
    return hash >>> 0;
}

function normalizeRatio(value) {
    var ratio = Number(value);
    if (!Number.isFinite(ratio)) return 1;
    if (ratio < 0) return 0;
    if (ratio > 1) return 1;
    return ratio;
}

function normalizeMaxFunctions(value) {
    if (value === undefined || value === null) return Infinity;
    var max = Number(value);
    if (!Number.isFinite(max)) return Infinity;
    return Math.max(0, Math.floor(max));
}

function selectionScore(options, node, index) {
    var name = functionName(node);
    var bodySize = node && node.body && node.body.body ? node.body.body.length : 0;
    return textDigest(String(options.seed) + ":" + index + ":" + name + ":" + bodySize) / 0x100000000;
}

function constantDigest(constants) {
    var hash = textDigest("DJS-HMESH/constants/v1");
    for (var i = 0; i < constants.length; i += 1) {
        var constant = constants[i];
        hash = meshMix(hash, textDigest(constant.kind));
        hash = meshMix(hash, textDigest(String(constant.value)));
    }
    return hash >>> 0;
}

function meshExpression(value) {
    if (Array.isArray(value)) {
        return arrayExpression(value.map(meshExpression));
    }
    return literal(value >>> 0);
}

function encryptedStream(tokens, base, seed) {
    var state = seed >>> 0;
    var tag = seed >>> 0;
    var encrypted = [];
    for (var i = 0; i < tokens.length; i += 1) {
        var mul = 1 + ((state >>> 5) % (base - 1));
        var add = state % base;
        var value = (tokens[i] * mul + add) % base;
        encrypted.push(value);
        state = mix(state, value, i);
        tag = mix(tag, value, i);
    }
    return { encrypted: encrypted, tag: tag >>> 0 };
}

function packTokens(tokens, base) {
    var out = 0n;
    var pow = 1n;
    var bigBase = BigInt(base);
    tokens.forEach(function (token) {
        out += BigInt(token) * pow;
        pow *= bigBase;
    });
    return out;
}

function makeChaff(next, tokenCount, ratio) {
    var length = Math.max(4, Math.min(32, Math.ceil(tokenCount * ratio / 16)));
    var chaff = [];
    for (var i = 0; i < length; i += 1) {
        chaff.push(next() >>> 0);
    }
    return chaff;
}

function buildHashMeshRecord(record, encryptedTokens, opValues, constants, dialect, options) {
    var ratio = typeof options.chaffRatio === "number" ? options.chaffRatio : 0.55;
    var buildSalt = hashSeed(String(options.seed || "toildefender-hmesh") + ":DJS-HMESH/build/v1");
    var functionId = meshMix(buildSalt, dialect.seed);
    var chunkId = dialect.next() >>> 0;
    var constDigest = constantDigest(constants);
    var previousDigest = meshMix(meshMix(buildSalt, functionId), chunkId);
    var streamSalt = dialect.next() >>> 0;
    var flags = 0;
    if (options.bindToVmState !== false) flags |= 1;
    if (options.deriveDialectFromMesh) flags |= 2;
    if (options.encodeChaff !== false) flags |= 4;
    var chaff = options.encodeChaff === false ? [] : makeChaff(dialect.next, record.tokenCount, ratio);
    var mesh = [
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
    var key = meshKey(mesh, record.base, record.tokenCount, record.seed, record.tag, opValues);
    var cipher = encryptedTokens.map(function (token, index) {
        return (token + meshStream(key, index, record.base, streamSalt)) % record.base;
    });
    record.blob = packTokens(cipher, record.base);
    record.mesh = mesh;
}

function isSimplePattern(node) {
    return node && node.type === "Identifier";
}

function containsNestedFunction(node) {
    var found = false;
    traverser.traverseEx(node, [], function (child) {
        if (child !== node && estest.isFunction(child)) {
            found = true;
            this.abort();
        }
        return child;
    });
    return found;
}

function Compiler(fn, dialect, options) {
    this.fn = fn;
    this.dialect = dialect;
    this.options = options || {};
    this.instructions = [];
    this.labelId = 0;
    this.params = {};
    this.functionScope = Object.create(null);
    this.scopeStack = [];
    this.localCount = 0;
    this.constants = [];
    this.constantKeys = {};
    this.references = [];
    this.referenceKeys = {};
}

Compiler.prototype.label = function () { return "L" + this.labelId++; };
Compiler.prototype.mark = function (name) { this.instructions.push({ label: name }); };
Compiler.prototype.emit = function (op) { this.instructions.push({ op: op, args: Array.prototype.slice.call(arguments, 1) }); };
Compiler.prototype.pushScope = function () {
    var scope = Object.create(null);
    this.scopeStack.push(scope);
    return scope;
};
Compiler.prototype.popScope = function () {
    this.scopeStack.pop();
};
Compiler.prototype.currentScope = function () {
    if (this.scopeStack.length === 0) return this.pushScope();
    return this.scopeStack[this.scopeStack.length - 1];
};
Compiler.prototype.declareLocal = function (name, functionScoped) {
    var scope = functionScoped ? this.functionScope : this.currentScope();
    if (!Object.prototype.hasOwnProperty.call(scope, name)) scope[name] = this.localCount++;
    return scope[name];
};
Compiler.prototype.resolveLocal = function (name) {
    for (var i = this.scopeStack.length - 1; i >= 0; i -= 1) {
        var scope = this.scopeStack[i];
        if (Object.prototype.hasOwnProperty.call(scope, name)) return scope[name];
    }
    if (Object.prototype.hasOwnProperty.call(this.functionScope, name)) return this.functionScope[name];
    return null;
};
Compiler.prototype.addConstant = function (kind, value) {
    var key = kind + ":" + String(value);
    if (Object.prototype.hasOwnProperty.call(this.constantKeys, key)) return this.constantKeys[key];
    var index = this.constants.length;
    this.constantKeys[key] = index;
    this.constants.push({ kind: kind, value: value });
    return index;
};
Compiler.prototype.addReference = function (value) {
    var key = String(value);
    if (Object.prototype.hasOwnProperty.call(this.referenceKeys, key)) return this.referenceKeys[key];
    var index = this.references.length;
    this.referenceKeys[key] = index;
    this.references.push(key);
    return index;
};
Compiler.prototype.validateBindings = function () {
    var self = this;
    this.fn.params.forEach(function (param, index) {
        if (!isSimplePattern(param)) throw new Error("unsupported parameter pattern");
        self.params[param.name] = index;
    });
    traverser.traverseEx(this.fn.body, [], function (node) {
        if (node !== self.fn.body && estest.isFunction(node)) {
            this.abort();
            return node;
        }
        if (node.type === "VariableDeclarator") {
            if (!isSimplePattern(node.id)) throw new Error("unsupported declaration pattern");
        }
        return node;
    });
};
Compiler.prototype.compile = function () {
    if (!this.fn.body || this.fn.body.type !== "BlockStatement") throw new Error("unsupported function body");
    if (containsNestedFunction(this.fn.body)) throw new Error("nested functions are not virtualized");
    this.validateBindings();
    this.pushScope();
    this.compileBlock(this.fn.body, false);
    this.popScope();
    this.emit("PUSH_UNDEFINED");
    this.emit("RETURN");
    return this.finish();
};
Compiler.prototype.compileBlock = function (block, createScope) {
    var self = this;
    if (createScope !== false) this.pushScope();
    block.body.forEach(function (stmt) { self.compileStatement(stmt); });
    if (createScope !== false) this.popScope();
};
Compiler.prototype.compileStatement = function (stmt) {
    switch (stmt.type) {
        case "BlockStatement": this.compileBlock(stmt, true); return;
        case "VariableDeclaration":
            for (var i = 0; i < stmt.declarations.length; i += 1) {
                var decl = stmt.declarations[i];
                var slot = this.declareLocal(decl.id.name, stmt.kind === "var");
                if (decl.init) this.compileExpression(decl.init); else this.emit("PUSH_UNDEFINED");
                this.emit("STORE_LOCAL", slot);
            }
            return;
        case "ExpressionStatement": this.compileExpression(stmt.expression); this.emit("POP"); return;
        case "ReturnStatement":
            if (stmt.argument) this.compileExpression(stmt.argument); else this.emit("PUSH_UNDEFINED");
            this.emit("RETURN");
            return;
        case "IfStatement": {
            var elseLabel = this.label();
            var endLabel = this.label();
            this.compileExpression(stmt.test);
            this.emit("JMP_FALSE", elseLabel);
            this.compileStatement(stmt.consequent);
            this.emit("JMP", endLabel);
            this.mark(elseLabel);
            if (stmt.alternate) this.compileStatement(stmt.alternate);
            this.mark(endLabel);
            return;
        }
        case "WhileStatement": {
            var start = this.label();
            var end = this.label();
            this.mark(start);
            this.compileExpression(stmt.test);
            this.emit("JMP_FALSE", end);
            this.compileStatement(stmt.body);
            this.emit("JMP", start);
            this.mark(end);
            return;
        }
        case "EmptyStatement": return;
        default: throw new Error("unsupported statement " + stmt.type);
    }
};
Compiler.prototype.compileExpression = function (expr) {
    switch (expr.type) {
        case "Literal": this.compileLiteral(expr); return;
        case "Identifier": this.compileIdentifier(expr.name); return;
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
            for (var i = 0; i < expr.expressions.length; i += 1) {
                this.compileExpression(expr.expressions[i]);
                if (i + 1 < expr.expressions.length) this.emit("POP");
            }
            return;
        default: throw new Error("unsupported expression " + expr.type);
    }
};
Compiler.prototype.compileLiteral = function (expr) {
    if (expr.regex) throw new Error("regex literals are unsupported");
    if (expr.value === null) this.emit("PUSH_NULL");
    else if (expr.value === true) this.emit("PUSH_TRUE");
    else if (expr.value === false) this.emit("PUSH_FALSE");
    else if (typeof expr.value === "number" && Number.isInteger(expr.value) && expr.value >= 0 && expr.value < SMALL_LIMIT) this.emit("PUSH_SMALL", expr.value);
    else this.emit("PUSH_CONST", this.addConstant(typeof expr.value, expr.value));
};
Compiler.prototype.compileIdentifier = function (name) {
    if (name === "undefined") this.emit("PUSH_UNDEFINED");
    else if (name === "arguments") this.emit("PUSH_ARGUMENTS");
    else {
        var slot = this.resolveLocal(name);
        if (slot !== null) this.emit("LOAD_LOCAL", slot);
        else if (Object.prototype.hasOwnProperty.call(this.params, name)) this.emit("LOAD_ARG", this.params[name]);
        else this.emit("PUSH_CONST", this.addConstant("reference", name));
    }
};
Compiler.prototype.compileArray = function (expr) {
    for (var i = 0; i < expr.elements.length; i += 1) {
        if (expr.elements[i] === null) this.emit("PUSH_UNDEFINED");
        else this.compileExpression(expr.elements[i]);
    }
    this.emit("MAKE_ARRAY", expr.elements.length);
};
Compiler.prototype.compileObject = function (expr) {
    for (var i = 0; i < expr.properties.length; i += 1) {
        var prop = expr.properties[i];
        if (prop.kind && prop.kind !== "init") throw new Error("unsupported object property kind");
        if (prop.type === "SpreadElement") throw new Error("unsupported object spread");
        var key = prop.computed ? null : prop.key.name || prop.key.value;
        if (key === null) this.compileExpression(prop.key); else this.emit("PUSH_CONST", this.addConstant("string", String(key)));
        this.compileExpression(prop.value);
    }
    this.emit("MAKE_OBJECT", expr.properties.length);
};
Compiler.prototype.compileUnary = function (expr) {
    if (expr.operator === "void") {
        this.compileExpression(expr.argument);
        this.emit("POP");
        this.emit("PUSH_UNDEFINED");
        return;
    }
    this.compileExpression(expr.argument);
    if (expr.operator === "-") this.emit("NEG");
    else if (expr.operator === "!") this.emit("NOT");
    else if (expr.operator === "~") this.emit("BIT_NOT");
    else if (expr.operator === "typeof") this.emit("TYPEOF");
    else if (expr.operator === "+") this.emit("TO_NUMBER");
    else throw new Error("unsupported unary operator " + expr.operator);
};
Compiler.prototype.compileBinary = function (expr) {
    this.compileExpression(expr.left);
    this.compileExpression(expr.right);
    var map = { "+": "ADD", "-": "SUB", "*": "MUL", "/": "DIV", "%": "MOD", "**": "POW", "==": "EQ", "!=": "NEQ", "===": "STRICT_EQ", "!==": "STRICT_NEQ", "<": "LT", "<=": "LTE", ">": "GT", ">=": "GTE" };
    if (!map[expr.operator]) throw new Error("unsupported binary operator " + expr.operator);
    this.emit(map[expr.operator]);
};
Compiler.prototype.compileLogical = function (expr) {
    var end = this.label();
    if (expr.operator === "??") {
        var right = this.label();
        this.compileExpression(expr.left);
        this.emit("DUP");
        this.emit("JMP_NULLISH", right);
        this.emit("JMP", end);
        this.mark(right);
        this.emit("POP");
        this.compileExpression(expr.right);
        this.mark(end);
        return;
    }
    if (expr.operator !== "&&" && expr.operator !== "||") throw new Error("unsupported logical operator " + expr.operator);
    this.compileExpression(expr.left);
    this.emit("DUP");
    this.emit(expr.operator === "&&" ? "JMP_FALSE" : "JMP_TRUE", end);
    this.emit("POP");
    this.compileExpression(expr.right);
    this.mark(end);
};
Compiler.prototype.compileAssignment = function (expr) {
    if (expr.left.type === "Identifier") {
        var slot = this.resolveLocal(expr.left.name);
        if (slot === null) throw new Error("unsupported assignment target " + expr.left.name);
        if (expr.operator === "=") this.compileExpression(expr.right);
        else {
            var map = { "+=": "ADD", "-=": "SUB", "*=": "MUL", "/=": "DIV", "%=": "MOD" };
            if (!map[expr.operator]) throw new Error("unsupported assignment operator " + expr.operator);
            this.compileIdentifier(expr.left.name);
            this.compileExpression(expr.right);
            this.emit(map[expr.operator]);
        }
        this.emit("DUP");
        this.emit("STORE_LOCAL", slot);
        return;
    }
    if (expr.left.type === "MemberExpression" && expr.operator === "=") {
        this.compileExpression(expr.left.object);
        this.compilePropertyKey(expr.left);
        this.compileExpression(expr.right);
        this.emit("SET_PROP");
        return;
    }
    throw new Error("unsupported assignment expression");
};
Compiler.prototype.compilePropertyKey = function (expr) {
    if (expr.computed) this.compileExpression(expr.property);
    else this.emit("PUSH_CONST", this.addConstant("string", expr.property.name));
};
Compiler.prototype.compileMember = function (expr) {
    this.compileExpression(expr.object);
    this.compilePropertyKey(expr);
    this.emit("GET_PROP");
};
Compiler.prototype.compileCall = function (expr) {
    if (expr.callee.type === "MemberExpression") {
        this.compileExpression(expr.callee.object);
        this.compilePropertyKey(expr.callee);
        for (var i = 0; i < expr.arguments.length; i += 1) this.compileExpression(expr.arguments[i]);
        this.emit("CALL_METHOD", expr.arguments.length);
        return;
    }
    this.compileExpression(expr.callee);
    for (var j = 0; j < expr.arguments.length; j += 1) this.compileExpression(expr.arguments[j]);
    this.emit("CALL_EXT", 0, expr.arguments.length);
};
Compiler.prototype.compileConditional = function (expr) {
    var alternate = this.label();
    var end = this.label();
    this.compileExpression(expr.test);
    this.emit("JMP_FALSE", alternate);
    this.compileExpression(expr.consequent);
    this.emit("JMP", end);
    this.mark(alternate);
    this.compileExpression(expr.alternate);
    this.mark(end);
};
Compiler.prototype.instructionSize = function (instr, positions) {
    if (instr.label) return 0;
    var start = positions.get(instr) || 0;
    var size = 1;
    for (var i = 0; i < instr.args.length; i += 1) {
        var arg = instr.args[i];
        if (typeof arg === "string") size += signedLengthFor(positions.get(arg) || 0, start, size);
        else size += encodeUnsigned(arg).length;
    }
    return size;
};
Compiler.prototype.isInstruction = function (instr, op) {
    return instr && !instr.label && instr.op === op;
};
Compiler.prototype.fuseSuperinstructions = function () {
    var out = [];
    for (var i = 0; i < this.instructions.length; i += 1) {
        var one = this.instructions[i];
        var two = this.instructions[i + 1];
        var three = this.instructions[i + 2];
        if (this.isInstruction(one, "PUSH_CONST") && this.isInstruction(two, "GET_PROP")) {
            out.push({ op: "GET_CONST_PROP", args: [one.args[0]] });
            i += 1;
            continue;
        }
        if (this.isInstruction(one, "DUP") && this.isInstruction(two, "STORE_LOCAL") && this.isInstruction(three, "POP")) {
            out.push({ op: "STORE_LOCAL_POP", args: [two.args[0]] });
            i += 2;
            continue;
        }
        out.push(one);
    }
    this.instructions = out;
};
Compiler.prototype.assemble = function () {
    var positions = new Map();
    var stable = false;
    while (!stable) {
        stable = true;
        var cursor = 0;
        for (var i = 0; i < this.instructions.length; i += 1) {
            var instr = this.instructions[i];
            if (instr.label) {
                if (positions.get(instr.label) !== cursor) stable = false;
                positions.set(instr.label, cursor);
            } else {
                positions.set(instr, cursor);
                cursor += this.instructionSize(instr, positions);
            }
        }
    }
    var tokens = [];
    for (var j = 0; j < this.instructions.length; j += 1) {
        var op = this.instructions[j];
        if (op.label) continue;
        var start = tokens.length;
        tokens.push(this.dialect.opcodes[op.op]);
        for (var k = 0; k < op.args.length; k += 1) {
            var arg = op.args[k];
            if (typeof arg === "string") {
                var before = tokens.length - start;
                var len = signedLengthFor(positions.get(arg), start, before);
                var rel = positions.get(arg) - (start + before + len);
                encodeSigned(rel).forEach(function (value) { tokens.push(value); });
            } else {
                encodeUnsigned(arg).forEach(function (value) { tokens.push(value); });
            }
        }
    }
    return tokens;
};
Compiler.prototype.constantExpression = function (constant) {
    var next = this.dialect.next;
    if (constant.kind === "number") {
        if (Number.isNaN(constant.value)) return binary("/", literal(0), literal(0));
        if (constant.value === Infinity) return binary("/", literal(1), literal(0));
        if (constant.value === -Infinity) return { type: "UnaryExpression", operator: "-", prefix: true, argument: binary("/", literal(1), literal(0)) };
        return literal(constant.value);
    }
    if (constant.kind === "string" || constant.kind === "reference") {
        var value = String(constant.value);
        var salt = (next() & 65535) || 1;
        var decoded = call(identifier("toildefender$numericVmString"), [ bigintExpression(stringBlob(value, salt), next), literal(value.length), literal(salt) ]);
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
    if (constant.kind === "boolean") return literal(!!constant.value);
    if (constant.kind === "undefined") return { type: "UnaryExpression", operator: "void", prefix: true, argument: literal(0) };
    throw new Error("unsupported constant " + constant.kind);
};
Compiler.prototype.referenceExpression = function (value) {
    var next = this.dialect.next;
    var name = String(value);
    var salt = (next() & 65535) || 1;
    var decoded = call(identifier("toildefender$numericVmString"), [ bigintExpression(stringBlob(name, salt), next), literal(name.length), literal(salt) ]);
    return {
        type: "ConditionalExpression",
        test: binary("===", unary("typeof", identifier(name)), literal("undefined")),
        consequent: member(identifier("globalThis"), decoded),
        alternate: identifier(name)
    };
};
Compiler.prototype.constantCellExpression = function (constant) {
    if (constant.kind === "reference") {
        return arrayExpression([
            literal(3),
            literal(this.addReference(constant.value))
        ]);
    }
    if (constant.kind !== "string" && constant.kind !== "reference") {
        return this.constantExpression(constant);
    }
    return arrayExpression([
        literal(constant.kind === "reference" ? 2 : 0),
        Object.assign(functionExpression([ returnStatement(this.constantExpression(constant)) ]), {
            toildefender$numericVmInternal: true
        })
    ]);
};
Compiler.prototype.finish = function () {
    this.fuseSuperinstructions();
    var tokens = this.assemble();
    var encrypted = encryptedStream(tokens, this.dialect.base, this.dialect.seed);
    var opValues = OP_NAMES.map(name => this.dialect.opcodes[name]);
    var record = {
        base: this.dialect.base,
        blob: packTokens(encrypted.encrypted, this.dialect.base),
        constants: this.constants.map(this.constantCellExpression.bind(this)),
        opValues: opValues.map(literal),
        references: this.references.map(this.referenceExpression.bind(this)),
        seed: this.dialect.seed,
        tag: encrypted.tag,
        tokenCount: tokens.length
    };
    if (this.options.hashMesh && this.options.hashMesh.enabled) {
        buildHashMeshRecord(record, encrypted.encrypted, opValues, this.constants, this.dialect, Object.assign({}, this.options.hashMesh, {
            seed: this.options.seed
        }));
    }
    return record;
};

function makeDialect(seedText) {
    var seed = hashSeed(seedText);
    var next = makeRng(seed);
    var values = shuffle(Array.from({ length: OP_NAMES.length }, function (_, index) { return index + 1; }), next);
    var opcodes = {};
    OP_NAMES.forEach(function (name, index) { opcodes[name] = values[index]; });
    return { base: BASES[next() % BASES.length], next: next, opcodes: opcodes, seed: seed };
}

function vmCall(record, next, refs) {
    refs = refs || {};
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

function resolveOptions(options) {
    return Object.assign({
        enabled: false,
        maxFunctionSize: 120,
        maxFunctions: Infinity,
        minFunctionSize: 1,
        mode: "balanced",
        ratio: 1,
        seed: "toildefender-numeric-vm",
        hashMesh: {
            bindToVmState: true,
            chaffRatio: 0.55,
            deriveDialectFromMesh: false,
            enabled: false,
            encodeChaff: true,
            mode: "balanced",
            serverBound: false,
            unlock: "per-function"
        },
        virtualize: "marked"
    }, options || {});
}

export default class NumericVm {
    constructor(logger, options) {
        this.logger = logger;
        this.options = resolveOptions(options);
        this.options.ratio = normalizeRatio(this.options.ratio);
        this.options.maxFunctions = normalizeMaxFunctions(this.options.maxFunctions);
        this.count = 0;
    }

    shouldTry(node) {
        if (!this.options.enabled || !estest.isFunction(node) || node.generator || node.async) return false;
        if (!node.body || node.body.type !== "BlockStatement") return false;
        if (functionName(node).indexOf("toildefender$numericVm") === 0) return false;
        var bodySize = node.body.body.length;
        if (bodySize < this.options.minFunctionSize || bodySize > this.options.maxFunctionSize) return false;
        if (this.options.virtualize === "all-supported") return true;
        if (this.options.virtualize === "heuristic") return bodySize >= this.options.minFunctionSize;
        return false;
    }

    apply(ast) {
        assert.ok(estest.isNode(ast));
        if (!this.options.enabled) return ast;

        var runtime = markNumericVmInternal(replaceStaticBigIntCalls(esprima.parse(RUNTIME)));
        var self = this;
        var transformed = 0;
        var candidateIndex = 0;
        var dataDeclarations = [];
        var trace = typeof process !== "undefined" && process.env && process.env.TOILDEFENDER_NUMERIC_VM_TRACE === "1";

        ast = traverser.traverse(ast, [], function (node) {
            if (!self.shouldTry(node)) return node;
            var currentIndex = candidateIndex;
            candidateIndex += 1;
            if (transformed >= self.options.maxFunctions) return node;
            if (self.options.ratio <= 0 || selectionScore(self.options, node, currentIndex) >= self.options.ratio) return node;
            try {
                var originalBodySize = node.body && node.body.body ? node.body.body.length : 0;
                var dialect = makeDialect(self.options.seed + ":" + transformed + ":" + functionName(node));
                var record = new Compiler(node, dialect, self.options).compile();
                var dataName = "toildefender$numericVmData$" + transformed;
                var opsName = "toildefender$numericVmOps$" + transformed;
                var meshName = "toildefender$numericVmMesh$" + transformed;
                var cacheName = "toildefender$numericVmCache$" + transformed;
                [
                    variableDeclaration(dataName, arrayExpression(record.constants)),
                    variableDeclaration(opsName, arrayExpression(record.opValues)),
                    variableDeclaration(meshName, record.mesh ? meshExpression(record.mesh) : literal(null)),
                    variableDeclaration(cacheName, arrayExpression([]))
                ].forEach(function (declaration) {
                    declaration.toildefender$numericVmInternal = true;
                    dataDeclarations.push(declaration);
                });
                node.body = { type: "BlockStatement", body: [ returnStatement(vmCall(record, dialect.next, {
                    cache: identifier(cacheName),
                    constants: identifier(dataName),
                    mesh: identifier(meshName),
                    ops: identifier(opsName)
                })) ] };
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
                if (self.options.virtualize === "all-supported") self.logger.warn("numeric_vm skipped " + functionName(node) + ": " + error.message);
            }
            return node;
        });

        if (transformed > 0) {
            ast.body = runtime.body.concat(dataDeclarations).concat(ast.body);
        }
        this.count = transformed;
        return ast;
    }
};
