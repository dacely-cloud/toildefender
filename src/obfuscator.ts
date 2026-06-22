/** @module toildefender */

import fs from "fs";
import assert from "assert";
import { createRequire } from "node:module";
import path from "node:path";
import * as modernParser from "@babel/parser";
import _ from "lodash";
import escodegen from "escodegen";
import escope from "escope";
import * as esprima from "esprima";
import traverser from "./traverser.js";
import utils from "./utils.js";
import Logger from "./logger.js";
import prDeadCode from "./processors/deadCode.js";
import prModules from "./processors/modules.js";
import prMethods from "./processors/methods.js";
import prVariables from "./processors/variables.js";
import prScopes from "./processors/scopes.js";
import prFlattener from "./processors/flattener.js";
import prNormalizer from "./processors/normalizer.js";
import prPreprocessing from "./processors/preprocessing.js";
import prPostprocessing from "./processors/postprocessing.js";
import prUglifier from "./processors/uglifier.js";
import prIdentifiers from "./processors/identifiers.js";
import prLiterals from "./processors/literals.js";
import prNumericVm from "./processors/numericVm.js";
import prHealth from "./processors/health.js";
import type {
    AstNode,
    FeatureConfig,
    FeatureDescriptions,
    FeatureName,
    LogAdapter,
    LogLevel,
    Loose,
    ToilDefenderOptions,
    ToilDefenderResult
} from "./types.js";

function requireBase(): string {
    if (typeof import.meta.url == "string" && import.meta.url.length > 0) {
        return import.meta.url;
    }
    if (typeof __filename == "string" && path.isAbsolute(__filename)) {
        return __filename;
    }
    return path.join(process.cwd(), "toildefender.js");
}

const optionalRequire = createRequire(requireBase());
function requireOptional(name: string): Loose | null {
    try {
        return optionalRequire(name);
    } catch (e) {
        return null;
    }
}

const defaultOptions: Required<Omit<ToilDefenderOptions, "code" | "modulesCode" | "forceFeatures" | "logAdapter">> & {
    features: FeatureConfig;
    modulesCode: Record<string, string>;
    logAdapter?: LogAdapter;
} = {
    babel: false,
    babelTarget: "ie 11",
    babelPreserveAsync: true,
    runtimeHelpers: true,
    simplify: true,
    features: {
        dead_code: true,
        scope: true,
        control_flow: true,
        identifiers: true,
        numeric_vm: false,
        object_packing: true,
        literals: true,
        mangle: true,
        compress: true
    },
    logLevel: "warn",
    modulesCode: {},
    numericVm: {
        enabled: false,
        maxFunctionSize: 120,
        minFunctionSize: 1,
        mode: "balanced",
        perFunctionDialect: true,
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
    },
    controlFlow: {
        ratio: 1,
        seed: "toildefender-control-flow"
    },
    scope: {
        ratio: 1,
        seed: "toildefender-scope"
    },
    protections: {
        virtualMachine: {
            bigintBytecode: true,
            enabled: false,
            encodeConstants: true,
            mode: "balanced",
            perFunctionDialect: true,
            randomizedOpcodes: true,
            virtualize: "marked"
        },
        hashMesh: {
            bindToVmState: true,
            chaffRatio: 0.55,
            deriveDialectFromMesh: false,
            enabled: false,
            encodeChaff: true,
            mode: "balanced",
            serverBound: false,
            unlock: "per-function"
        }
    },
    preprocessorVariables: {}
};

const featureDeps: Record<FeatureName, FeatureName[]> = {
    dead_code: [ "control_flow" ],
    scope: [ "mangle" ],
    control_flow: [ "scope", "mangle" ],
    identifiers: [ "mangle" ],
    numeric_vm: [],
    object_packing: [ "identifiers" ],
    literals: [ "scope", "mangle" ],
    mangle: [],
    compress: [ "mangle" ]
};

function isNumericVmInternalNode(node: Loose) {
    return node && node.toildefender$numericVmInternal === true;
}

function takeNumericVmInternalStatements(ast: Loose) {
    if (!ast || ast.type != "Program") {
        return [];
    }
    const retained: Loose[] = [];
    ast.body = ast.body.filter((statement: Loose) => {
        if (isNumericVmInternalNode(statement)) {
            retained.push(statement);
            return false;
        }
        return true;
    });
    return retained;
}

const featureDescs: Record<FeatureName, Record<string, string>> = {
    dead_code: {
        en: "Insert dead code"
    },
    scope: {
        en: "Flatten the scope (method) structure to obfuscate application structure"
    },
    control_flow: {
        en: "Flatten control flow (if, while, for, etc...) structure to obfuscate control flow"
    },
    identifiers: {
        en: "Obfuscate identifiers (variable, object and property names)"
    },
    numeric_vm: {
        en: "Virtualize selected functions into BigInt-packed numeric VM programs"
    },
    object_packing: {
        en: "Pack object literal keys into numeric schemas instead of alternating key/value arrays"
    },
    literals: {
        en: "Obfuscate literals (numbers, strings)"
    },
    mangle: {
        en: "Shorten identifiers (variable names, function names)"
    },
    compress: {
        en: "Remove unneeded whitespace"
    }
};

export var features: FeatureDescriptions = Object.fromEntries(
    (Object.keys(defaultOptions.features) as FeatureName[]).map((feature) => [
        feature,
        {
            dependencies: featureDeps[feature] || [],
            descriptions: featureDescs[feature] || {},
            default: defaultOptions.features[feature]
        }
    ])
) as FeatureDescriptions;

/**
 * Logs informational and diagnostic messages onto an output device or object.
 * 
 * @callback logAdapterCallback
 * @param {string} level - Message level.
 * @param {string} data - Message data.
 */

/**
 * Obfuscates a project.
 * @param {Object} options - Configuration.
 * @param {string} options.code - Code of entry point file to be obfuscated.
 * @param {Object.<string, string>} options.modulesCode - Code of all of options.code's depedencies.
 * @param {boolean} [options.babel = false] - Whether to run the optional Babel transform before obfuscating.
 * @param {boolean} [options.babelPreserveAsync = true] - Whether Babel should leave async/generator syntax for async-aware flattening instead of emitting regenerator helpers.
 * @param {Object.<string, boolean>} [options.features = All enabled] - Feature configuration.
 * @param {logAdapterCallback} [options.logAdapter = Console] - Logging adapter.
 * @param {string} [options.logLevel = "warn"] - Minimum level of shown log messages.
 * @param {Object.<string, boolean>} [options.preprocessorVariables] - Preprocessor variables.
 * @example
 * toildefender.do({
 *     code: "...",
 *     modulesCode: {
 *         depA: "...",
 *         depB: "..."
 *     },
 *     features: {
 *         scope: true,
 *         control_flow: true,
 *         identifiers: true,
 *         literals: true,
 *         mangle: true,
 *         compress: true
 *      }
 * });
 */
export function protect(inputOptions: ToilDefenderOptions): ToilDefenderResult {
    let options: Loose = inputOptions;
    /**
     * Annotates potentially thrown errors with a label
     */
    function tryTag<T>(label: string, task: () => T): T {
        try {
            return task();
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            throw new Error(`[${label}]\t${error.stack || error.message}`);
        }
    }

    /**
     * Adapter for Logger
     */
    function createConsoleLoggingAdapter(logLevel: LogLevel): LogAdapter {
        const LEVELS = ["log", "error", "warn", "info", "debug"];
        const allowedLevels: Loose[] = [];
        for (const level of LEVELS) {
            allowedLevels.push(level);
            if (level == logLevel) {
                break;
            }
        }
        return (level: LogLevel, data: unknown[]) => {
            if (_.includes(allowedLevels, level)) {
                const prefix = "[task]" + Array(taskIndent).join("\t");
                console.log(`${prefix}[${level}]\t${data.join("\t")}`);
            }
        };
    }
    
    var taskIndent = 1;
    /**
     * Wraps a task, indents its output and measures its duration
     */
    function doTask(label: string, condition: boolean, task: () => void) {
        return tryTag(label, () => {
            taskIndent++;
            const prefix = "[task]" + Array(taskIndent).join("\t");
            try {
                if (condition) {
                    logger.info(`${prefix}${label} ...`);
                    
                    const start = Date.now();
                    task();
                    const duration = Date.now() - start;
                    logger.info(`${prefix}${label}: ${duration}ms`);
                    return {
                        otherwise: function() { }
                    };
                } else {
                    return {
                        otherwise: function (task: () => void) { task(); }
                    };
                }
            } finally {
                taskIndent--;
            }
        });
    }

    function transformModernSyntax(code: string, label: string): string {
        const modernBabel = requireOptional("@babel/core");
        if (modernBabel) {
            let presetEnvPath;
            try {
                presetEnvPath = optionalRequire.resolve("@babel/preset-env");
            } catch (e) {
                throw new Error("Babel transform requested, but @babel/preset-env is not installed");
            }

            let presetOptions: Loose;
            presetOptions = {
                modules: "commonjs",
                targets: options.babelTarget,
                useBuiltIns: false
            };
            if (options.babelPreserveAsync !== false) {
                presetOptions.exclude = [
                    "@babel/plugin-transform-async-to-generator",
                    "@babel/plugin-transform-regenerator"
                ];
            }
            const result = modernBabel.transformSync(code, {
                babelrc: false,
                comments: false,
                compact: false,
                configFile: false,
                sourceType: "unambiguous",
                presets: [
                    [
                        presetEnvPath,
                        presetOptions
                    ]
                ]
            });
            return result && result.code || code;
        }

        const legacyBabel = requireOptional("babel-core");
        if (!legacyBabel) {
            throw new Error("Babel transform requested, but neither @babel/core nor babel-core is installed");
        }

        const babelOptions = {
            "plugins": [
                "babel-plugin-transform-es2015-arrow-functions",
                //"babel-plugin-transform-es2015-block-scoped-functions",
                "babel-plugin-transform-es2015-block-scoping",
                "babel-plugin-transform-es2015-classes",
                "babel-plugin-transform-es2015-computed-properties",
                //"babel-plugin-check-es2015-constants",
                "babel-plugin-transform-es2015-destructuring",
                "babel-plugin-transform-es2015-duplicate-keys",
                "babel-plugin-transform-es2015-for-of",
                "babel-plugin-transform-es2015-function-name",
                "babel-plugin-transform-es2015-literals",
                "babel-plugin-transform-es2015-object-super",
                "babel-plugin-transform-es2015-parameters",
                "babel-plugin-transform-es2015-shorthand-properties",
                "babel-plugin-transform-es2015-spread",
                "babel-plugin-transform-es2015-sticky-regex",
                "babel-plugin-transform-es2015-template-literals",
                //"babel-plugin-transform-es2015-typeof-symbol",
                "babel-plugin-transform-es2015-unicode-regex"
            ].map((plugin: Loose) => optionalRequire.resolve(plugin))
        };
        return legacyBabel.transform(code, babelOptions).code;
    }

    function parseSource(code: string, options: Loose): AstNode {
        try {
            return esprima.parseScript(code, options) as AstNode;
        } catch (esprimaError) {
            if (!modernParser) {
                throw esprimaError;
            }

            let modernParseOptions: Loose;
            modernParseOptions = {
                sourceType: "unambiguous",
                plugins: [
                    "estree",
                    "classProperties",
                    "classPrivateProperties",
                    "classPrivateMethods",
                    "optionalChaining",
                    "nullishCoalescingOperator",
                    "objectRestSpread"
                ]
            };
            const parsed = modernParser.parse(code, modernParseOptions);
            return {
                type: "Program",
                body: parsed.program.body,
                sourceType: parsed.program.sourceType
            };
        }
    }

    function containsNodeType(root: AstNode, names: string[]): boolean {
        let found = false;
        const lookup: Record<string, boolean> = {};
        names.forEach((name: string) => {
            lookup[name] = true;
        });
        traverser.traverseEx(root, [], function (this: { abort(): void }, node: AstNode) {
            if (lookup[node.type]) {
                found = true;
                this.abort();
            }
            return node;
        });
        return found;
    }

    function hasMangleUnsupportedSyntax(root: AstNode): boolean {
        return false;
    }

    function dispatcherForMethod(method: AstNode): "main$asyncGenerator" | "main$async" | "main$generator" | "main" {
        if (method.async === true && method.generator === true) {
            return "main$asyncGenerator";
        }
        if (method.async === true) {
            return "main$async";
        }
        if (method.generator === true) {
            return "main$generator";
        }
        return "main";
    }

    function normalizeRatio(value: Loose): number {
        const ratio = Number(value);
        if (!Number.isFinite(ratio)) {
            return 1;
        }
        if (ratio < 0) {
            return 0;
        }
        if (ratio > 1) {
            return 1;
        }
        return ratio;
    }

    function hashString32(value: string): number {
        let h = 0x811c9dc5;
        for (let i = 0; i < value.length; i += 1) {
            h ^= value.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h >>> 0;
    }

    function methodControlFlowScore(method: AstNode, index: number): number {
        const name = method && method.id && method.id.name || "";
        const seed = options.controlFlow && options.controlFlow.seed || "";
        return hashString32(`${seed}:${index}:${name}`) / 0x100000000;
    }
    
    options = _.merge({}, defaultOptions, options); // first argument gets mutated
    if (options.protections.virtualMachine.enabled) {
        options.numericVm = _.merge({}, options.numericVm, options.protections.virtualMachine, {
            enabled: true
        });
        options.features.numeric_vm = true;
    }
    if (options.protections.hashMesh.enabled) {
        options.numericVm = _.merge({}, options.numericVm, options.protections.virtualMachine, {
            enabled: true,
            hashMesh: options.protections.hashMesh
        });
        options.features.numeric_vm = true;
    }
    if (!options.logAdapter) {
        options.logAdapter = createConsoleLoggingAdapter(options.logLevel);
    }
    if (!options.forceFeatures) {
        _.map(featureDeps, (deps: Loose, feature: Loose) => {
            if (options.features[feature]) {
                deps.forEach((dep: Loose) => options.features[dep] = true);
            }
        });
    } else {
        options.features = options.forceFeatures;
    }
    const controlFlowRatio = normalizeRatio(options.controlFlow && options.controlFlow.ratio);
    const controlFlowActive = options.features.control_flow && controlFlowRatio > 0;
    const scopeRatio = normalizeRatio(options.scope && options.scope.ratio);
    
    const parseOptions: Record<string, Loose> = {};
    const scopeOptions = {
        optimistic: true // required or things in the global scope just get lost
    };
    const lexicalScopeOptions = {
        ecmaVersion: 6,
        optimistic: true,
        sourceType: "script" as const
    };
    
    var logger = new Logger(options.logAdapter);
    let customBindAdded = false;

    const start = Date.now();

    // Preprocess
    doTask("preprocessing", true, () => {
        const preprocessor = new prPreprocessing(logger); 
        options.modulesCode = _.mapValues(
            options.modulesCode,
            (code: Loose, key: Loose) => tryTag(key, () => preprocessor.process(code, options.preprocessorVariables))
        );
        options.code = tryTag("app", () => preprocessor.process(options.code, options.preprocessorVariables));
    });
    
    // Apply babel
    doTask("babel", options.babel, () => {
        options.modulesCode = _.mapValues(options.modulesCode, (moduleCode: Loose, key: Loose) => tryTag(key, () => transformModernSyntax(moduleCode, key)));
        options.code = tryTag("app", () => transformModernSyntax(options.code, "app"));
    });
    
    // Parse code
    let ast: AstNode = { type: "Program", body: [] };
    let modulesAST: Record<string, AstNode> = {};
    function addCustomBindOnce() {
        if (!customBindAdded) {
            const methods = new prMethods(logger);
            methods.addCustomBind(ast);
            customBindAdded = true;
        }
    }

    doTask("parse", true, () => {
        modulesAST = _.mapValues(options.modulesCode, (code: Loose, key: Loose) => tryTag(key, () => parseSource(code, parseOptions)));
        modulesAST.app = tryTag("app", () => parseSource(options.code, parseOptions));
    });
    
    // Merge depedencies into main modules
    doTask("merge", true, () => {
        const modules = new prModules(logger);
        ast = modules.merge(modulesAST, "app", null);
    });

    // Insert dead code
    doTask("dead_code", options.features.dead_code, () => {
        const deadCode = new prDeadCode(logger);
        ast = deadCode.insert(ast, 1.0);
    });
    
    // Simplify graph
    doTask("simplify", options.simplify !== false, () => {
        const normalizer = new prNormalizer(logger);
        ast = normalizer.simplify(ast);
    });

    doTask("numeric_vm", options.features.numeric_vm || options.numericVm.enabled, () => {
        const numericVm = new prNumericVm(logger, _.merge({}, options.numericVm, {
            enabled: options.features.numeric_vm || options.numericVm.enabled
        }));
        ast = numericVm.apply(ast);
    });
        
    // Move identifiers
    doTask("identifiers", options.features.identifiers, () => {
        const identifiers = new prIdentifiers(logger);
        
        ast = identifiers.computeProperties(ast);
        ast = identifiers.arrayizeObjects(ast, {
            objectPacking: options.features.object_packing !== false
        });
        //ast = identifiers.moveIdentifiers(ast, escope.analyze(ast, scopeOptions));
        //^ why is this commented out?
        ast = identifiers.moveLiterals(ast, escope.analyze(ast, scopeOptions));
    });
    
    doTask("literals", options.features.literals, () => {
        const literals = new prLiterals(logger);
        
        literals.generateStrings(ast);
    });
    
    doTask("scope", options.features.scope, () => {
        const scopes = new prScopes(logger);
        const methods = new prMethods(logger);
    
        const rng = new utils.UniqueRandom(32768);
        
        // Make identifiers unique
        doTask("obfuscate_identifiers", true, () => {
            const variables = new prVariables(logger);
            variables.removeFunctionExpressionIds(ast);
            variables.functionDeclarationToExpression(ast, escope.analyze(ast, scopeOptions));
            variables.obfuscateIdentifiers(ast, escope.analyze(ast, lexicalScopeOptions));
            variables.redefineParameters(ast, escope.analyze(ast, scopeOptions));
        });
        
        // Move identifiers into scope objects
        doTask("create_scope_objects", true, () => {
            scopes.createScopeObjects(ast, escope.analyze(ast, lexicalScopeOptions), {
                ratio: scopeRatio,
                seed: options.scope && options.scope.seed || "toildefender-scope",
                forceProgram: controlFlowActive
            });
        });
        
        // Calculate entry points for all methods
        const methodEntryPoints: Record<string, Loose> = {};
        doTask("list_methods", true, () => {
            methods.listMethods(ast).forEach((methodName: string) => {
                methodEntryPoints[methodName] = {
                    entry: rng.get()
                };
            });
        });
        
        // Extract function declarations and expressions
        let fns: AstNode[];
        doTask("extract_methods", true, () => {
            const scopeManager = escope.analyze(ast, lexicalScopeOptions);
            fns = methods.extractMethods(ast);
            fns = fns.map((method: Loose) => {
                const refers = methods.methodRefersToArguments(method, scopeManager);
                methods.removeFirstArguments(method, refers ? method.params.filter((x: AstNode) => x.name.indexOf("$$scope") == 0).length : 0);
                return methods.replaceArgumentReferences(method, true);
            });
            fns.forEach((method: Loose) => {
                if (method && method.id && methodEntryPoints[method.id.name]) {
                    methodEntryPoints[method.id.name].dispatcher = dispatcherForMethod(method);
                }
            });
            const selectedMethodEntryPoints: Record<string, Loose> = {};
            fns.forEach((method: Loose, index: Loose) => {
                if (!method || !method.id || !methodEntryPoints[method.id.name]) {
                    return;
                }
                if (controlFlowRatio >= 1 || methodControlFlowScore(method, index) < controlFlowRatio) {
                    selectedMethodEntryPoints[method.id.name] = methodEntryPoints[method.id.name];
                }
            });

            if (controlFlowActive) {
                methods.replaceFunctionCalls(ast, selectedMethodEntryPoints);
                fns.forEach((method: Loose) => {
                    methods.replaceFunctionCalls(method.body, selectedMethodEntryPoints);
                });
            }
        });
        
        doTask("control_flow", controlFlowActive, () => {
            // Apply control flow flattening and merge methods
            const flattener = new prFlattener(logger, rng);
            const entry = rng.get(), exit = rng.get();
            const dispatcherGroups: Record<string, { async?: boolean; generator?: boolean; fns: AstNode[] }> = {
                "main$async": {
                    async: true,
                    fns: []
                },
                "main$generator": {
                    generator: true,
                    fns: []
                },
                "main$asyncGenerator": {
                    async: true,
                    generator: true,
                    fns: []
                }
            };
            const syncFns: AstNode[] = [];
            const retainedFns: AstNode[] = [];
            const retainedInternalFns = takeNumericVmInternalStatements(ast);

            fns.forEach((method: Loose, index: Loose) => {
                const selected = controlFlowRatio >= 1 || methodControlFlowScore(method, index) < controlFlowRatio;
                if (!selected) {
                    retainedFns.push(method);
                    return;
                }
                const dispatcher = dispatcherForMethod(method);
                if (dispatcher == "main") {
                    syncFns.push(method);
                } else {
                    dispatcherGroups[dispatcher].fns.push(method);
                }
            });

            flattener.addMethod(ast, entry, exit);
            syncFns.forEach((method: Loose) => {
                methods.bumpArgumentsIndices(method, 1);

                const entry = methodEntryPoints[method.id.name].entry;
                flattener.addMethod(method.body, entry, exit);
            });
            
            let syncAst = flattener.getProgram(entry, exit, {
                name: "main",
                invoke: true
            });

            syncAst = flattener.unifyPrefixStatements(syncAst);

            const asyncPrograms: AstNode[] = [];
            Object.keys(dispatcherGroups).forEach((name: Loose) => {
                const group = dispatcherGroups[name];
                if (group.fns.length == 0) {
                    return;
                }

                const groupFlattener = new prFlattener(logger, rng);
                const groupEntry = methodEntryPoints[group.fns[0].id.name].entry;
                const groupExit = rng.get();

                group.fns.forEach((method: Loose) => {
                    methods.bumpArgumentsIndices(method, 1);

                    const entry = methodEntryPoints[method.id.name].entry;
                    groupFlattener.addMethod(method.body, entry, groupExit);
                });

                let groupAst = groupFlattener.getProgram(groupEntry, groupExit, {
                    name: name,
                    async: group.async === true,
                    generator: group.generator === true,
                    invoke: false
                });

                groupAst = groupFlattener.unifyPrefixStatements(groupAst);
                asyncPrograms.push(groupAst);
            });

            if (asyncPrograms.length > 0) {
                ast = {
                    type: "Program",
                    body: retainedInternalFns.concat(retainedFns).concat(Array.prototype.concat.apply([], asyncPrograms.map((program: Loose) => program.body)).concat(syncAst.body))
                };
            } else {
                ast = {
                    type: "Program",
                    body: retainedInternalFns.concat(retainedFns).concat(syncAst.body)
                };
            }
        })
        .otherwise(() => {
            const retainedInternalFns = takeNumericVmInternalStatements(ast);
            if (ast.type == "Program") {
                ast.type = "BlockStatement";
            }
            ast = {
                type: "Program",
                body: retainedInternalFns.concat(fns).concat([ ast ])
            };
        });
    });

    doTask("add_runtime_helpers", options.runtimeHelpers !== false && (options.features.scope || options.features.object_packing || options.features.literals || options.babel === false), () => {
        addCustomBindOnce();
    });
    
    // Postprocessing
    doTask("postprocessing", true, () => {
        const postprocessing = new prPostprocessing(logger);
        ast = postprocessing.do(ast);
    });
    
    doTask("health", options.features.health, () => {
        const health = new prHealth(logger);
        ast = health.check(ast);
    });
    
    doTask("mangle", options.features.mangle, () => {
        if (hasMangleUnsupportedSyntax(ast)) {
            logger.warn("Skipping mangle because native modern syntax is not supported by the legacy mangler");
            return;
        }
        const uglifier = new prUglifier(logger);
        if (ast.type == "Program") {
            ast.type = "BlockStatement";
        }
        ast = uglifier.uglify({
            type: "Program",
            body: [
                {
                    type: "CallExpression",
                    arguments: [],
                    callee: {
                        type: "FunctionExpression",
                        params: [],
                        body: ast
                    }
                }
            ]
        });
    });
    
    let codegenOptions: Loose;
    codegenOptions = {
        sourceMap: false,
        sourceMapWithCode: false
    };
    
    doTask("compress", options.features.compress, () => {
        codegenOptions.format = {
            renumber: true,
            hexadecimal: true,
            quotes: "auto",
            compact: true
        };
    });
    
    const result = escodegen.generate(ast, codegenOptions) as Loose;

    const duration = Date.now() - start;
    
    return {
        code: result.code || result,
        map: result.map && result.map.toString()
    };
}

const api = { features, protect, do: protect };

export { protect as do };
export default api;
