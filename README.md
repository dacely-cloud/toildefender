<div align="center">

<img src="./images/toildefender6.svg" alt="ToilDefender" width="600" />


### JavaScript code protection for the Toil stack.

<sub>Randomized control flow, literal protection, object packing, BigInt-backed VM bytecode, and hash-mesh bytecode unlock for browser and Node bundles.</sub>

<br/>

[![npm](https://img.shields.io/npm/v/@dacely/toildefender.svg?color=2563ff&label=npm&labelColor=0e1520)](https://www.npmjs.com/package/@dacely/toildefender)
[![node](https://img.shields.io/badge/node-%3E%3D24-22e3ab.svg?labelColor=0e1520)](https://nodejs.org/)
[![vm](https://img.shields.io/badge/VM-BigInt_bytecode-7c3aed.svg?labelColor=0e1520)](#virtual-machine-protection)
[![license](https://img.shields.io/badge/license-AGPL--3.0-8b9ab4.svg?labelColor=0e1520)](./LICENSE)

</div>

---

ToilDefender is Dacely's maintained JavaScript protection layer for the Toil
technology stack. It started from the original `defendjs` project, but this
fork is now maintained as its own package: `@dacely/toildefender`.

The goal is not to make client-side JavaScript impossible to analyze. That is
not a real promise. The goal is to raise reverse-engineering cost by removing
source-level structure, splitting logic across generated helpers, packing
constants, and optionally compiling selected functions into randomized numeric
VM programs.

```bash
npm install @dacely/toildefender
```

```js
const toildefender = require("@dacely/toildefender");

const result = toildefender.do({
    code: source,
    modulesCode: {},
    logLevel: "error",
    features: {
        dead_code: true,
        scope: true,
        control_flow: true,
        identifiers: true,
        numeric_vm: true,
        object_packing: true,
        literals: true,
        mangle: true,
        compress: true
    },
    protections: {
        virtualMachine: {
            enabled: true,
            mode: "aggressive",
            bigintBytecode: true,
            randomizedOpcodes: true,
            encodeConstants: true,
            perFunctionDialect: true,
            virtualize: "heuristic"
        },
        hashMesh: {
            enabled: true,
            mode: "aggressive",
            unlock: "per-function",
            deriveDialectFromMesh: true,
            bindToVmState: true,
            encodeChaff: true,
            chaffRatio: 0.55
        }
    }
});

console.log(result.code);
```

## What It Does

| Protection | Purpose |
| --- | --- |
| `control_flow` | Rewrites structured control flow into dispatcher-style execution. |
| `scope` | Flattens function/scope structure into generated runtime frames. |
| `identifiers` | Renames and rewrites identifiers, object references, and property access. |
| `object_packing` | Packs object literal keys into numeric schemas instead of readable key/value arrays. |
| `literals` | Encodes strings and numeric constants. |
| `dead_code` | Inserts unreachable or low-value code paths to add noise. |
| `mangle` | Shortens generated identifiers. |
| `compress` | Emits compact output. |
| `numeric_vm` | Virtualizes supported functions into BigInt-packed bytecode. |

## Virtual Machine Protection

Transform your JavaScript into randomized virtual-machine bytecode for maximum
resistance against reverse engineering.

ToilDefender compiles protected functions into a private instruction set, packs
the bytecode into encrypted BigInt streams, and executes it through a generated
runtime VM. Instead of exposing readable JavaScript logic, your code becomes
numeric program data consumed by a randomized virtual machine.

The compiler also fuses selected hot stack patterns into semantic
superinstructions, so common operation boundaries such as constant-key property
reads are not always emitted as separate primitive VM opcodes.
Constants are wrapped in access-bound cells, so encoded strings and references
are decoded lazily when bytecode reads them instead of during VM call setup.

Original logic disappears from the output bundle. Attackers no longer reverse
plain JavaScript; they must recover the VM, decode the bytecode format,
reconstruct the instruction set, and emulate the protected program.

```js
toildefender.do({
    code,
    modulesCode: {},
    features: {
        numeric_vm: true
    },
    protections: {
        virtualMachine: {
            enabled: true,
            mode: "aggressive",
            bigintBytecode: true,
            randomizedOpcodes: true,
            encodeConstants: true,
            perFunctionDialect: true,
            virtualize: "marked",
            minFunctionSize: 1,
            maxFunctionSize: 120,
            seed: "build-seed"
        }
    }
});
```

Selection modes:

| `virtualize` | Meaning |
| --- | --- |
| `marked` | Virtualize functions marked by supported annotations or compiler selection. |
| `all-supported` | Virtualize every function that fits the supported syntax subset. |
| `heuristic` | Virtualize functions selected by size and compiler suitability. |

Supported VM syntax currently targets practical protection work: literals,
locals, arguments, return, assignment, arithmetic, comparisons, logical
expressions, `if` / `else`, `while`, calls, member reads, arrays, and object
literals. Unsupported syntax remains native or is skipped by selection.

### All-Modes Output Demo

Input:

```js
function licenseGate(input) {
    const total = input.length * 7;
    return input.charCodeAt(0) === 86
        ? { ok: true, total: total + 13 }
        : { ok: false, total: total - 5 };
}

globalThis.__result = licenseGate("Veilmark");
```

The demo artifact is generated with every major protection enabled and
compression disabled so the runtime stays readable:

```js
features: {
    dead_code: true,
    scope: true,
    control_flow: true,
    identifiers: true,
    numeric_vm: true,
    object_packing: true,
    literals: true,
    mangle: true,
    compress: false
},
protections: {
    virtualMachine: {
        enabled: true,
        mode: "aggressive",
        bigintBytecode: true,
        randomizedOpcodes: true,
        encodeConstants: true,
        perFunctionDialect: true,
        virtualize: "all-supported",
        seed: "readme-all-modes-demo"
    },
    hashMesh: {
        enabled: true,
        mode: "aggressive",
        unlock: "per-function",
        deriveDialectFromMesh: true,
        bindToVmState: true,
        encodeChaff: true,
        chaffRatio: 0.55
    }
}
```

The complete beautified generated output is committed at
[docs/all-modes-output.demo.js](./docs/all-modes-output.demo.js). It is a real
1015-line artifact from the current generator and executes to:

Output excerpt:

```js
(function () {
  function a(f, j) {
    var b = new Array(105);
    ;
    var c = arguments;
    while (true) try {
      switch (f) {
        case 18274:
          b[11] = c[11];
          b[12] = c[10];
          b[13] = c[9];
          b[14] = c[8];
          b[15] = c[7];
          b[16] = c[6];
          b[17] = c[5];
          b[18] = c[4];
          b[19] = c[3];
          b[20] = c[2];
          b[21] = e(a, 22, b, c[1]);
          b[22] = e(a, 13455, b, c[1]);
          b[23] = e(a, 23551, b, c[1]);
          b[24] = e(a, 5304, b, c[1]);
          b[25] = e(a, 14518, b, c[1]);
          b[26] = e(a, 16031, b, c[1]);
          b[27] = e(a, 12999, b, c[1]);
          b[28] = e(a, 3096, b, c[1]);
          b[29] = e(a, 12237, b, c[1]);
          b[30] = e(a, 20218, b, c[1]);
          b[31] = e(a, 21222, b, c[1]);
          b[32] = e(a, 29854, b, c[1]);
          b[33] = e(a, 612, b, c[1]);
          b[34] = e(a, 18182, b, c[1]);
          b[35] = e(a, 9881, b, c[1]);
          b[36] = BigInt(b[19]);
          b[37] = [1n];
          b[38] = c[1][10][1];
          b[39] = c[1][10][1];
          if (b[11]) {
            b[38] = c[1][4](b[11], b[19], b[18], b[17], b[16], b[12]);
            b[39] = b[11][c[1][10][24]] >>> c[1][10][1];
          }
          b[40] = c[1][10][1];
          b[41] = b[17] >>> c[1][10][1];
          while (b[40] < b[18]) {
            b[42] = b[33](b[40]);
            b[41] = b[34](b[41], b[42], b[40]);
            b[40] += c[1][10][5];
          }
          if (b[41] >>> c[1][10][1] !== b[16] >>> c[1][10][1]) throw new Error(c[1][10][29]);
          b[43] = c[1][10][1];
          b[44] = b[17] >>> c[1][10][1];
          b[45] = b[17] & c[1][10][5];
          b[46] = b[45] ? c[1][10][30] : [];
          b[47] = b[45] ? c[1][10][30] : [];
          b[48] = b[45] ? g([
            /* encoded layout keys */
          ], [
            [],
            Object[c[1][10][36]](c[1][10][30])
          ]) : c[1][10][30];

          /* 900+ more generated lines:
             dispatcher cases, encoded literals, streaming VM token reads,
             lazy constant cells, seed-selected stack/local storage, BigInt program blobs,
             semantic superinstructions, randomized opcode tables,
             and Hash-Mesh unwrap */

        case 5304:
          if (c[1][49] < c[2][10][1] || c[1][49] >= c[1][18]) throw new Error(c[2][10][45]);
          b[1] = c[1][30](c[1][49]);
          c[1][49] += c[2][10][5];
          return b[1];
        case 1762:
          b[1] = '';
          b[1] += d(86, 101, 105);
          b[1] += d(108, 109);
          b[1] += d(97, 114, 107);
          return b[1];
      }
    } catch (a) {
      veilmark$tobethrown = null;
      switch (f) {
        default:
          throw a;
      }
    }
  }
  a(15312, {});
})();
```

```json
{ "ok": true, "total": 69 }
```

That output contains the full stacked mess: flattened dispatcher runtime,
identifier rewriting, packed literals, object packing, VM bytecode execution,
BigInt program blobs, randomized opcode tables, and Hash-Mesh unlock material.

## Hash-Mesh Unlock

Hash-Mesh Unlock derives VM bytecode keys from runtime integrity data. If
protected code, constants, VM helpers, or execution state are modified, the next
bytecode chunk decrypts incorrectly instead of exposing runnable logic.

This turns integrity checks into decryption requirements instead of patchable
boolean branches.

```js
toildefender.do({
    code,
    modulesCode: {},
    features: {
        numeric_vm: true
    },
    protections: {
        virtualMachine: {
            enabled: true,
            mode: "aggressive",
            virtualize: "all-supported"
        },
        hashMesh: {
            enabled: true,
            mode: "aggressive",
            unlock: "per-function",
            deriveDialectFromMesh: true,
            bindToVmState: true,
            encodeChaff: true,
            chaffRatio: 0.55,
            serverBound: false
        }
    }
});
```

Hash-Mesh is an obfuscation and tamper-resistance layer. It is not a
cryptographic secrecy guarantee for code running on an attacker-controlled
machine.

## CLI

Install globally or run through `npx`:

```bash
npm install -g @dacely/toildefender
toildefender --help
```

```bash
toildefender \
  --input ./src \
  --output ./dist-protected \
  --features scope,control_flow,identifiers,literals,mangle,compress
```

For multi-entry projects, declare entry files in `package.json`:

```json
{
    "toildefender": {
        "mainFiles": ["index.js", "worker.js"]
    }
}
```

The old `defendjs.mainFiles` field is still read as a compatibility fallback,
but new projects should use `toildefender`.

## API

```js
const toildefender = require("@dacely/toildefender");

const result = toildefender.do({
    code: "function add(a,b){ return a + b } globalThis.x = add(1,2)",
    modulesCode: {},
    logLevel: "warn",
    features: {
        dead_code: false,
        scope: true,
        control_flow: true,
        identifiers: true,
        numeric_vm: false,
        object_packing: true,
        literals: true,
        mangle: true,
        compress: true
    }
});

console.log(result.code);
```

Main options:

| Option | Meaning |
| --- | --- |
| `code` | Entry source code. |
| `modulesCode` | Map of dependency filename to source code. |
| `features` | Feature switches for the classic pipeline. |
| `protections.virtualMachine` | User-facing VM bytecode backend configuration. |
| `protections.hashMesh` | User-facing hash-mesh unlock configuration. |
| `numericVm` | Lower-level numeric VM configuration retained for internal callers. |
| `preprocessorVariables` | Compile-time preprocessor constants. |
| `logLevel` | `error`, `warn`, `info`, `debug`, or `log`. |

## Toil Integration

ToilDefender is intended to sit behind Toil build tooling. Framework packages
can call the API directly, then run normal syntax validation and browser tests
against the protected artifact.

Recommended Toil stack pattern:

```txt
source bundle
-> Vite / framework build
-> ToilDefender pre-obfuscation and protection
-> syntax validation
-> browser smoke tests
-> publish/deploy artifact
```

For security-sensitive browser code, pair this with server-side validation.
Client-side protection raises cost; it does not replace server authority.

## Security Boundary

ToilDefender is code protection, not magic.

It helps against:

- quick static reading of shipped JavaScript
- simple string/signature extraction
- source-level control-flow recovery
- direct patching of obvious boolean integrity checks
- automated diffing across builds when seeds and dialects rotate

It does not guarantee:

- secrets stay secret in client-side code
- runtime tracing is impossible
- browser-controlled attackers cannot eventually emulate behavior
- server authorization can be moved into the browser

Put real authorization and durable decisions on the server.

## Development

```bash
npm test
npm run test:firefox
npm run pack:dry
```

The regression suite covers modern syntax handling, object packing, VM bytecode
execution, Hash-Mesh unlock, and tamper failure behavior.

## Credit

ToilDefender began as a fork of
[defendjs](https://github.com/alexhorn/defendjs), originally created by
Alexander Horn and released under the GNU Affero General Public License v3.0.

Dacely maintains this fork for the Toil stack and has added the modern parser
surface, VM bytecode backend, Hash-Mesh unlock layer, object key packing,
branding cleanup, and current regression coverage.

See [NOTICE.md](./NOTICE.md) for attribution details.

## License

AGPL-3.0. See [LICENSE](./LICENSE).
