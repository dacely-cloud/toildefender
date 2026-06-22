/** @module toildefender */

import fs from "fs";
import assert from "assert";
import { createRequire } from "node:module";
import path from "node:path";
import * as modernParser from "@babel/parser";
import _ from "lodash";
import escodegen from "escodegen";
import type { GenerateOptions } from "escodegen";
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
    HashMeshOptions,
    LogAdapter,
    LogLevel,
    NumericVmOptions,
    ProtectionOptions,
    ToilDefenderOptions,
    ToilDefenderResult
} from "./types.js";

type InternalFeatureName = FeatureName | "health";
type InternalFeatureConfig = Partial<Record<InternalFeatureName, boolean>>;
type PreprocessorDefines = NonNullable<ToilDefenderOptions["preprocessorVariables"]>;
type DispatcherName = "main$asyncGenerator" | "main$async" | "main$generator" | "main";
type AsyncDispatcherName = Exclude<DispatcherName, "main">;

interface MethodEntryPoint {
    dispatcher?: DispatcherName;
    entry: number;
}

interface DispatcherGroup {
    async?: boolean;
    fns: AstNode[];
    generator?: boolean;
}

interface ResolvedProtectionOptions {
    virtualMachine: NumericVmOptions & NonNullable<ProtectionOptions["virtualMachine"]>;
    hashMesh: HashMeshOptions;
}

interface ResolvedToilDefenderOptions extends Omit<Required<ToilDefenderOptions>, "features" | "forceFeatures" | "logAdapter" | "modulesCode" | "preprocessorVariables" | "protections"> {
    features: InternalFeatureConfig;
    forceFeatures?: InternalFeatureConfig;
    logAdapter?: LogAdapter;
    modulesCode: Record<string, string>;
    preprocessorVariables: PreprocessorDefines;
    protections: ResolvedProtectionOptions;
}

interface BabelTransformResult {
    code?: string | null;
}

interface BabelTransformer {
    transform(code: string, options: Record<string, unknown>): BabelTransformResult;
}

interface ModernBabelTransformer {
    transformSync(code: string, options: Record<string, unknown>): BabelTransformResult | null;
}

interface BabelPresetEnvOptions {
    exclude?: string[];
    modules: "commonjs";
    targets?: string;
    useBuiltIns: false;
}

interface TaskAlternative {
    otherwise(task?: () => void): void;
}

type DefaultToilDefenderOptions = Omit<ResolvedToilDefenderOptions, "code" | "forceFeatures" | "logAdapter"> & {
    features: FeatureConfig;
};

const NO_NUMERIC_VM_DIRECTIVE = "toildefender:no-numeric-vm";

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
function requireOptional<T>(name: string): T | null {
    try {
        return optionalRequire(name) as T;
    } catch {
        return null;
    }
}

const defaultOptions: DefaultToilDefenderOptions = {
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value == "object" && value !== null;
}

function asAstNode(value: unknown): AstNode {
    return value as AstNode;
}

function asAstNodeArray(value: unknown): AstNode[] {
    return Array.isArray(value) ? (value as AstNode[]) : [];
}

function asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item == "string") : [];
}

function nodeName(node: AstNode): string {
    const name = (node as { name?: unknown }).name;
    return typeof name == "string" ? name : "";
}

function nodeBody(node: AstNode): AstNode {
    const body = (node as { body?: unknown }).body;
    return isRecord(body) && typeof body.type == "string" ? (body as AstNode) : { type: "BlockStatement", body: [] };
}

function nodeBodyArray(node: AstNode): AstNode[] {
    const body = (node as { body?: unknown }).body;
    return asAstNodeArray(body);
}

function nodeParams(node: AstNode): AstNode[] {
    const params = (node as { params?: unknown }).params;
    return asAstNodeArray(params);
}

function methodIdName(method: AstNode): string | null {
    const id = (method as { id?: unknown }).id;
    if (isRecord(id) && typeof id.name == "string") {
        return id.name;
    }
    return null;
}

function methodFlag(method: AstNode, key: "async" | "generator"): boolean {
    return (method as Record<string, unknown>)[key] === true;
}

function isNumericVmInternalNode(node: unknown): boolean {
    return isRecord(node) && node.toildefender$numericVmInternal === true;
}

function expressionStringValue(node: unknown): string | null {
    if (!isRecord(node)) {
        return null;
    }
    if (typeof node.value == "string") {
        return node.value;
    }
    const expression = node.expression;
    if (isRecord(expression) && typeof expression.value == "string") {
        return expression.value;
    }
    return null;
}

function hasNoNumericVmDirective(node: AstNode): boolean {
    const bodyNode = nodeBody(node);
    if (bodyNode.type != "BlockStatement") {
        return false;
    }
    for (const statement of nodeBodyArray(bodyNode)) {
        if (statement.type != "ExpressionStatement") {
            return false;
        }
        if (statement.directive === NO_NUMERIC_VM_DIRECTIVE || expressionStringValue(statement) === NO_NUMERIC_VM_DIRECTIVE) {
            return true;
        }
    }
    return false;
}

function markNoNumericVmDirectives(ast: AstNode): AstNode {
    return traverser.traverse(ast, [], (node: AstNode) => {
        if (
            (node.type == "FunctionDeclaration" || node.type == "FunctionExpression" || node.type == "ArrowFunctionExpression")
            && hasNoNumericVmDirective(node)
        ) {
            node.toildefender$noNumericVm = true;
        }
        return node;
    });
}

function takeNumericVmInternalStatements(ast: AstNode): AstNode[] {
    if (ast.type != "Program") {
        return [];
    }
    const retained: AstNode[] = [];
    const body = nodeBodyArray(ast);
    ast.body = body.filter((statement: AstNode) => {
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

export const features: FeatureDescriptions = Object.fromEntries(
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
    /**
     * Annotates potentially thrown errors with a label
     */
    function tryTag<T>(label: string, task: () => T): T {
        try {
            return task();
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            throw new Error(`[${label}]\t${error.stack || error.message}`, {
                cause: e
            });
        }
    }

    /**
     * Adapter for Logger
     */
    function createConsoleLoggingAdapter(logLevel: LogLevel): LogAdapter {
        const LEVELS: LogLevel[] = ["log", "error", "warn", "info", "debug"];
        const allowedLevels: LogLevel[] = [];
        for (const level of LEVELS) {
            allowedLevels.push(level);
            if (level == logLevel) {
                break;
            }
        }
        return (level: LogLevel, data: unknown[]) => {
            if (allowedLevels.includes(level)) {
                const prefix = "[task]" + Array(taskIndent).join("\t");
                console.log(`${prefix}[${level}]\t${data.join("\t")}`);
            }
        };
    }
    
    const options = _.merge({}, defaultOptions, inputOptions) as ResolvedToilDefenderOptions; // first argument gets mutated
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
        _.map(featureDeps, (deps: FeatureName[], feature: FeatureName) => {
            if (options.features[feature]) {
                deps.forEach((dep: FeatureName) => {
                    options.features[dep] = true;
                });
            }
        });
    } else {
        options.features = options.forceFeatures;
    }

    const logger = new Logger(options.logAdapter);
    let taskIndent = 1;
    /**
     * Wraps a task, indents its output and measures its duration
     */
    function doTask(label: string, condition: boolean | undefined, task: () => void): TaskAlternative {
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
                        otherwise: () => undefined
                    };
                } else {
                    return {
                        otherwise: (task?: () => void) => {
                            task?.();
                        }
                    };
                }
            } finally {
                taskIndent--;
            }
        });
    }

    function transformModernSyntax(code: string, label: string): string {
        const modernBabel = requireOptional<ModernBabelTransformer>("@babel/core");
        if (modernBabel) {
            let presetEnvPath: string;
            try {
                presetEnvPath = optionalRequire.resolve("@babel/preset-env");
            } catch (e) {
                throw new Error("Babel transform requested, but @babel/preset-env is not installed", {
                    cause: e
                });
            }

            const presetOptions: BabelPresetEnvOptions = {
                modules: "commonjs",
                targets: options.babelTarget,
                useBuiltIns: false
            };
            if (options.babelPreserveAsync) {
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

        const legacyBabel = requireOptional<BabelTransformer>("babel-core");
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
            ].map((plugin: string) => optionalRequire.resolve(plugin))
        };
        return legacyBabel.transform(code, babelOptions).code || code;
    }

    function parseSource(code: string, options: esprima.ParseOptions): AstNode {
        try {
            return esprima.parseScript(code, options) as unknown as AstNode;
        } catch (esprimaError) {
            if (!modernParser) {
                throw esprimaError;
            }

            const modernParseOptions = {
                sourceType: "unambiguous" as const,
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
            const parsed = modernParser.parse(code, modernParseOptions as modernParser.ParserOptions);
            return {
                type: "Program",
                body: parsed.program.body as unknown as AstNode[],
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

    function dispatcherForMethod(method: AstNode): DispatcherName {
        if (methodFlag(method, "async") && methodFlag(method, "generator")) {
            return "main$asyncGenerator";
        }
        if (methodFlag(method, "async")) {
            return "main$async";
        }
        if (methodFlag(method, "generator")) {
            return "main$generator";
        }
        return "main";
    }

    function normalizeRatio(value: unknown): number {
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
        const name = methodIdName(method) || "";
        const seed = options.controlFlow.seed || "";
        return hashString32(`${seed}:${index}:${name}`) / 0x100000000;
    }
    
    const controlFlowRatio = normalizeRatio(options.controlFlow.ratio);
    const controlFlowActive = options.features.control_flow === true && controlFlowRatio > 0;
    const scopeRatio = normalizeRatio(options.scope.ratio);
    
    const parseOptions: esprima.ParseOptions = {};
    const scopeOptions = {
        optimistic: true // required or things in the global scope just get lost
    };
    const lexicalScopeOptions = {
        ecmaVersion: 6,
        optimistic: true,
        sourceType: "script" as const
    };
    
    let customBindAdded = false;

    const start = Date.now();

    // Preprocess
    doTask("preprocessing", true, () => {
        const preprocessor = new prPreprocessing(logger); 
        const modulesCode: Record<string, string> = {};
        for (const [key, code] of Object.entries(options.modulesCode)) {
            modulesCode[key] = tryTag(key, () => preprocessor.process(code, options.preprocessorVariables));
        }
        options.modulesCode = modulesCode;
        options.code = tryTag("app", () => preprocessor.process(options.code, options.preprocessorVariables));
    });
    
    // Apply babel
    doTask("babel", options.babel, () => {
        const modulesCode: Record<string, string> = {};
        for (const [key, moduleCode] of Object.entries(options.modulesCode)) {
            modulesCode[key] = tryTag(key, () => transformModernSyntax(moduleCode, key));
        }
        options.modulesCode = modulesCode;
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
        const parsedModules: Record<string, AstNode> = {};
        for (const [key, code] of Object.entries(options.modulesCode)) {
            parsedModules[key] = tryTag(key, () => parseSource(code, parseOptions));
        }
        modulesAST = parsedModules;
        modulesAST.app = tryTag("app", () => parseSource(options.code, parseOptions));
    });
    
    // Merge depedencies into main modules
    doTask("merge", true, () => {
        const modules = new prModules(logger);
        ast = asAstNode(modules.merge(modulesAST, "app", null));
    });

    // Insert dead code
    doTask("dead_code", options.features.dead_code, () => {
        const deadCode = new prDeadCode(logger);
        ast = asAstNode(deadCode.insert(ast, 1.0));
    });

    doTask("numeric_vm_markers", true, () => {
        ast = asAstNode(markNoNumericVmDirectives(ast));
    });
    
    // Simplify graph
    doTask("simplify", options.simplify, () => {
        const normalizer = new prNormalizer(logger);
        ast = asAstNode(normalizer.simplify(ast));
    });

    doTask("numeric_vm", options.features.numeric_vm || options.numericVm.enabled, () => {
        const numericVm = new prNumericVm(logger, _.merge({}, options.numericVm, {
            enabled: options.features.numeric_vm || options.numericVm.enabled
        }));
        ast = asAstNode(numericVm.apply(ast));
    });
        
    // Move identifiers
    doTask("identifiers", options.features.identifiers, () => {
        const identifiers = new prIdentifiers(logger);
        
        ast = asAstNode(identifiers.computeProperties(ast));
        ast = asAstNode(identifiers.arrayizeObjects(ast, {
            objectPacking: options.features.object_packing !== false
        }));
        //ast = identifiers.moveIdentifiers(ast, escope.analyze(ast, scopeOptions));
        //^ why is this commented out?
        ast = asAstNode(identifiers.moveLiterals(ast, escope.analyze(ast, scopeOptions)));
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
                seed: options.scope.seed || "toildefender-scope",
                forceProgram: controlFlowActive
            });
        });
        
        // Calculate entry points for all methods
        const methodEntryPoints: Record<string, MethodEntryPoint> = {};
        const entryPointFor = (method: AstNode): MethodEntryPoint | undefined => {
            const name = methodIdName(method);
            return name ? methodEntryPoints[name] : undefined;
        };
        doTask("list_methods", true, () => {
            for (const methodName of asStringArray(methods.listMethods(ast))) {
                methodEntryPoints[methodName] = {
                    entry: rng.get()
                };
            }
        });
        
        // Extract function declarations and expressions
        let fns: AstNode[] = [];
        doTask("extract_methods", true, () => {
            const scopeManager = escope.analyze(ast, lexicalScopeOptions);
            fns = asAstNodeArray(methods.extractMethods(ast));
            fns = fns.map((method: AstNode) => {
                const refers = methods.methodRefersToArguments(method, scopeManager);
                const scopeArgumentCount = refers ? nodeParams(method).filter((param) => nodeName(param).indexOf("$$scope") == 0).length : 0;
                methods.removeFirstArguments(method, scopeArgumentCount);
                return asAstNode(methods.replaceArgumentReferences(method, true));
            });
            fns.forEach((method: AstNode) => {
                const entryPoint = entryPointFor(method);
                if (entryPoint) {
                    entryPoint.dispatcher = dispatcherForMethod(method);
                }
            });
            const selectedMethodEntryPoints: Record<string, MethodEntryPoint> = {};
            fns.forEach((method: AstNode, index: number) => {
                const name = methodIdName(method);
                if (!name || !methodEntryPoints[name]) {
                    return;
                }
                if (controlFlowRatio >= 1 || methodControlFlowScore(method, index) < controlFlowRatio) {
                    selectedMethodEntryPoints[name] = methodEntryPoints[name];
                }
            });

            if (controlFlowActive) {
                methods.replaceFunctionCalls(ast, selectedMethodEntryPoints);
                fns.forEach((method: AstNode) => {
                    methods.replaceFunctionCalls(nodeBody(method), selectedMethodEntryPoints);
                });
            }
        });
        
        doTask("control_flow", controlFlowActive, () => {
            // Apply control flow flattening and merge methods
            const flattener = new prFlattener(logger, rng);
            const entry = rng.get(), exit = rng.get();
            const dispatcherGroups: Record<AsyncDispatcherName, DispatcherGroup> = {
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

            fns.forEach((method: AstNode, index: number) => {
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
            syncFns.forEach((method: AstNode) => {
                methods.bumpArgumentsIndices(method, 1);

                const methodEntry = entryPointFor(method);
                if (!methodEntry) {
                    return;
                }
                flattener.addMethod(nodeBody(method), methodEntry.entry, exit);
            });
            
            let syncAst = asAstNode(flattener.getProgram(entry, exit, {
                name: "main",
                invoke: true
            }));

            syncAst = asAstNode(flattener.unifyPrefixStatements(syncAst));

            const asyncPrograms: AstNode[] = [];
            for (const [name, group] of Object.entries(dispatcherGroups) as Array<[AsyncDispatcherName, DispatcherGroup]>) {
                if (group.fns.length == 0) {
                    continue;
                }

                const groupFlattener = new prFlattener(logger, rng);
                const firstMethodEntry = entryPointFor(group.fns[0]);
                if (!firstMethodEntry) {
                    continue;
                }
                const groupExit = rng.get();

                group.fns.forEach((method: AstNode) => {
                    methods.bumpArgumentsIndices(method, 1);

                    const methodEntry = entryPointFor(method);
                    if (!methodEntry) {
                        return;
                    }
                    groupFlattener.addMethod(nodeBody(method), methodEntry.entry, groupExit);
                });

                let groupAst = asAstNode(groupFlattener.getProgram(firstMethodEntry.entry, groupExit, {
                    name: name,
                    async: Boolean(group.async),
                    generator: Boolean(group.generator),
                    invoke: false
                }));

                groupAst = asAstNode(groupFlattener.unifyPrefixStatements(groupAst));
                asyncPrograms.push(groupAst);
            }

            if (asyncPrograms.length > 0) {
                ast = {
                    type: "Program",
                    body: retainedInternalFns
                        .concat(retainedFns)
                        .concat(asyncPrograms.flatMap((program) => nodeBodyArray(program)))
                        .concat(nodeBodyArray(syncAst))
                };
            } else {
                ast = {
                    type: "Program",
                    body: retainedInternalFns.concat(retainedFns).concat(nodeBodyArray(syncAst))
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

    doTask("add_runtime_helpers", options.runtimeHelpers && (Boolean(options.features.scope || options.features.object_packing || options.features.literals) || !options.babel), () => {
        addCustomBindOnce();
    });
    
    // Postprocessing
    doTask("postprocessing", true, () => {
        const postprocessing = new prPostprocessing(logger);
        ast = asAstNode(postprocessing.do(ast));
    });
    
    doTask("health", options.features.health, () => {
        const health = new prHealth(logger);
        ast = asAstNode(health.check(ast));
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
        ast = asAstNode(uglifier.uglify({
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
        }));
    });
    
    const codegenOptions: GenerateOptions = {
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
    
    const code = escodegen.generate(ast, codegenOptions);

    const duration = Date.now() - start;
    
    return {
        code
    };
}

const api = { features, protect, do: protect };

export { protect as do };
export default api;
