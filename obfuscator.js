/** @module toildefender */

"use strict";

var fs = require("fs");
var assert = require("assert");

var _ = require("lodash");
function requireOptional(name) {
    try {
        return require(name);
    } catch (e) {
        return null;
    }
}

var modernParser = requireOptional("@babel/parser");
var escodegen = require("escodegen");
var escope = require("escope");
var esprima = require("esprima");

var traverser = require("./traverser");
var utils = require("./utils");

var Logger = require("./logger");

var prDeadCode          = require("./processors/deadCode");
var prModules           = require("./processors/modules");
var prMethods           = require("./processors/methods");
var prVariables         = require("./processors/variables");
var prScopes            = require("./processors/scopes");
var prFlattener         = require("./processors/flattener");
var prNormalizer        = require("./processors/normalizer");
var prPreprocessing     = require("./processors/preprocessing");
var prPostprocessing    = require("./processors/postprocessing");
var prUglifier          = require("./processors/uglifier");
var prIdentifiers       = require("./processors/identifiers");
var prLiterals          = require("./processors/literals");
var prNumericVm         = require("./processors/numericVm");
var prHealth            = require("./processors/health");

var defaultOptions = {
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

var featureDeps = {
    dead_code: [ "control_flow" ],
    scope: [ "mangle" ],
    control_flow: [ "scope", "mangle" ],
    identifiers: [ "mangle" ],
    numeric_vm: [],
    object_packing: [ "identifiers" ],
    literals: [ "scope", "mangle" ],
    compress: [ "mangle" ]
};

function isNumericVmInternalNode(node) {
    return node && node.toildefender$numericVmInternal === true;
}

function takeNumericVmInternalStatements(ast) {
    if (!ast || ast.type != "Program") {
        return [];
    }
    var retained = [];
    ast.body = ast.body.filter(statement => {
        if (isNumericVmInternalNode(statement)) {
            retained.push(statement);
            return false;
        }
        return true;
    });
    return retained;
}

var featureDescs = {
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

exports.features = _.fromPairs(
    _.map(defaultOptions.features, (enabled, feature) =>
        [
            feature,
            {
                dependencies: featureDeps[feature] || [],
                descriptions: featureDescs[feature] || {},
                default: enabled
            }
        ]
    )
);

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
exports.do = function (options) {
    /**
     * Annotates potentially thrown errors with a label
     */
    function tryTag(label, task) {
        try {
            return task();
        } catch (e) {
            throw new Error(`[${label}]\t${e.stack}`);
        }
    }

    /**
     * Adapter for Logger
     */
    function createConsoleLoggingAdapter(logLevel) {
        const LEVELS = ["log", "error", "warn", "info", "debug"];
        let allowedLevels = [];
        for (let level of LEVELS) {
            allowedLevels.push(level);
            if (level == logLevel) {
                break;
            }
        }
        return (level, data) => {
            if (_.includes(allowedLevels, level)) {
                var prefix = "[task]" + Array(taskIndent).join("\t");
                console.log(`${prefix}[${level}]\t${data.join("\t")}`);
            }
        };
    }
    
    var taskIndent = 1;
    /**
     * Wraps a task, indents its output and measures its duration
     */
    function doTask(label, condition, task) {
        return tryTag(label, () => {
            taskIndent++;
            var prefix = "[task]" + Array(taskIndent).join("\t");
            try {
                if (condition) {
                    logger.info(`${prefix}${label} ...`);
                    
                    var start = Date.now();
                    task();
                    var duration = Date.now() - start;
                    logger.info(`${prefix}${label}: ${duration}ms`);
                    return {
                        otherwise: function() { }
                    };
                } else {
                    return {
                        otherwise: function (task) { task(); }
                    };
                }
            } finally {
                taskIndent--;
            }
        });
    }

    function transformModernSyntax(code, label) {
        var modernBabel = requireOptional("@babel/core");
        if (modernBabel) {
            var presetEnvPath;
            try {
                presetEnvPath = require.resolve("@babel/preset-env");
            } catch (e) {
                throw new Error("Babel transform requested, but @babel/preset-env is not installed");
            }

            var presetOptions = {
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
            var result = modernBabel.transformSync(code, {
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

        var legacyBabel = requireOptional("babel-core");
        if (!legacyBabel) {
            throw new Error("Babel transform requested, but neither @babel/core nor babel-core is installed");
        }

        var babelOptions = {
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
            ].map(require.resolve)
        };
        return legacyBabel.transform(code, babelOptions).code;
    }

    function parseSource(code, options) {
        try {
            return esprima.parse(code, options);
        } catch (esprimaError) {
            if (!modernParser) {
                throw esprimaError;
            }

            var parsed = modernParser.parse(code, {
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
            });
            return {
                type: "Program",
                body: parsed.program.body,
                sourceType: parsed.program.sourceType
            };
        }
    }

    function containsNodeType(root, names) {
        var found = false;
        var lookup = {};
        names.forEach(name => {
            lookup[name] = true;
        });
        traverser.traverseEx(root, [], function (node) {
            if (lookup[node.type]) {
                found = true;
                this.abort();
            }
            return node;
        });
        return found;
    }

    function hasMangleUnsupportedSyntax(root) {
        return false;
    }

    function dispatcherForMethod(method) {
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

    function normalizeRatio(value) {
        var ratio = Number(value);
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

    function hashString32(value) {
        var h = 0x811c9dc5;
        for (var i = 0; i < value.length; i += 1) {
            h ^= value.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h >>> 0;
    }

    function methodControlFlowScore(method, index) {
        var name = method && method.id && method.id.name || "";
        var seed = options.controlFlow && options.controlFlow.seed || "";
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
        _.map(featureDeps, (deps, feature) => {
            if (options.features[feature]) {
                deps.forEach(dep => options.features[dep] = true);
            }
        });
    } else {
        options.features = options.forceFeatures;
    }
    var controlFlowRatio = normalizeRatio(options.controlFlow && options.controlFlow.ratio);
    var controlFlowActive = options.features.control_flow && controlFlowRatio > 0;
    var scopeRatio = normalizeRatio(options.scope && options.scope.ratio);
    
    var parseOptions = {};
    var scopeOptions = {
        optimistic: true // required or things in the global scope just get lost
    };
    var lexicalScopeOptions = {
        ecmaVersion: 6,
        optimistic: true,
        sourceType: "script"
    };
    
    var logger = new Logger(options.logAdapter);
    var customBindAdded = false;

    var start = Date.now();

    // Preprocess
    doTask("preprocessing", true, () => {
        var preprocessor = new prPreprocessing(logger); 
        options.modulesCode = _.mapValues(
            options.modulesCode,
            (code, key) => tryTag(key, () => preprocessor.process(code, options.preprocessorVariables))
        );
        options.code = tryTag("app", () => preprocessor.process(options.code, options.preprocessorVariables));
    });
    
    // Apply babel
    doTask("babel", options.babel, () => {
        options.modulesCode = _.mapValues(options.modulesCode, (moduleCode, key) => tryTag(key, () => transformModernSyntax(moduleCode, key)));
        options.code = tryTag("app", () => transformModernSyntax(options.code, "app"));
    });
    
    // Parse code
    var ast, modulesAST;
    function addCustomBindOnce() {
        if (!customBindAdded) {
            var methods = new prMethods(logger);
            methods.addCustomBind(ast);
            customBindAdded = true;
        }
    }

    doTask("parse", true, () => {
        modulesAST = _.mapValues(options.modulesCode, (code, key) => tryTag(key, () => parseSource(code, parseOptions)));
        modulesAST.app = tryTag("app", () => parseSource(options.code, parseOptions));
    });
    
    // Merge depedencies into main modules
    doTask("merge", true, () => {
        var modules = new prModules(logger);
        ast = modules.merge(modulesAST, "app");
    });

    // Insert dead code
    doTask("dead_code", options.features.dead_code, () => {
        var deadCode = new prDeadCode();
        ast = deadCode.insert(ast, 1.0);
    });
    
    // Simplify graph
    doTask("simplify", options.simplify !== false, () => {
        var normalizer = new prNormalizer(logger);
        ast = normalizer.simplify(ast);
    });

    doTask("numeric_vm", options.features.numeric_vm || options.numericVm.enabled, () => {
        var numericVm = new prNumericVm(logger, _.merge({}, options.numericVm, {
            enabled: options.features.numeric_vm || options.numericVm.enabled
        }));
        ast = numericVm.apply(ast);
    });
        
    // Move identifiers
    doTask("identifiers", options.features.identifiers, () => {
        var identifiers = new prIdentifiers(logger);
        
        ast = identifiers.computeProperties(ast);
        ast = identifiers.arrayizeObjects(ast, {
            objectPacking: options.features.object_packing !== false
        });
        //ast = identifiers.moveIdentifiers(ast, escope.analyze(ast, scopeOptions));
        //^ why is this commented out?
        ast = identifiers.moveLiterals(ast, escope.analyze(ast, scopeOptions));
    });
    
    doTask("literals", options.features.literals, () => {
        var literals = new prLiterals(logger);
        
        literals.generateStrings(ast);
    });
    
    doTask("scope", options.features.scope, () => {
        var scopes = new prScopes(logger);
        var methods = new prMethods(logger);
    
        var rng = new utils.UniqueRandom(32768);
        
        // Make identifiers unique
        doTask("obfuscate_identifiers", true, () => {
            var variables = new prVariables(logger);
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
        var methodEntryPoints = {};
        doTask("list_methods", true, () => {
            methods.listMethods(ast).forEach(methodName => {
                methodEntryPoints[methodName] = {
                    entry: rng.get()
                };
            });
        });
        
        // Extract function declarations and expressions
        var fns;
        doTask("extract_methods", true, () => {
            var scopeManager = escope.analyze(ast, lexicalScopeOptions);
            fns = methods.extractMethods(ast);
            fns = fns.map(method => {
                var refers = methods.methodRefersToArguments(method, scopeManager);
                methods.removeFirstArguments(method, refers ? method.params.filter(x => x.name.indexOf("$$scope") == 0).length : 0);
                return methods.replaceArgumentReferences(method, true);
            });
            fns.forEach(method => {
                if (method && method.id && methodEntryPoints[method.id.name]) {
                    methodEntryPoints[method.id.name].dispatcher = dispatcherForMethod(method);
                }
            });
            var selectedMethodEntryPoints = {};
            fns.forEach((method, index) => {
                if (!method || !method.id || !methodEntryPoints[method.id.name]) {
                    return;
                }
                if (controlFlowRatio >= 1 || methodControlFlowScore(method, index) < controlFlowRatio) {
                    selectedMethodEntryPoints[method.id.name] = methodEntryPoints[method.id.name];
                }
            });

            if (controlFlowActive) {
                methods.replaceFunctionCalls(ast, selectedMethodEntryPoints);
                fns.forEach(method => {
                    methods.replaceFunctionCalls(method.body, selectedMethodEntryPoints);
                });
            }
        });
        
        doTask("control_flow", controlFlowActive, () => {
            // Apply control flow flattening and merge methods
            var flattener = new prFlattener(logger, rng);
            var entry = rng.get(), exit = rng.get();
            var dispatcherGroups = {
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
            var syncFns = [];
            var retainedFns = [];
            var retainedInternalFns = takeNumericVmInternalStatements(ast);

            fns.forEach((method, index) => {
                var selected = controlFlowRatio >= 1 || methodControlFlowScore(method, index) < controlFlowRatio;
                if (!selected) {
                    retainedFns.push(method);
                    return;
                }
                var dispatcher = dispatcherForMethod(method);
                if (dispatcher == "main") {
                    syncFns.push(method);
                } else {
                    dispatcherGroups[dispatcher].fns.push(method);
                }
            });

            flattener.addMethod(ast, entry, exit);
            syncFns.forEach(method => {
                methods.bumpArgumentsIndices(method, 1);

                var entry = methodEntryPoints[method.id.name].entry;
                flattener.addMethod(method.body, entry, exit);
            });
            
            var syncAst = flattener.getProgram(entry, exit, {
                name: "main",
                invoke: true
            });

            syncAst = flattener.unifyPrefixStatements(syncAst);

            var asyncPrograms = [];
            Object.keys(dispatcherGroups).forEach(name => {
                var group = dispatcherGroups[name];
                if (group.fns.length == 0) {
                    return;
                }

                var groupFlattener = new prFlattener(logger, rng);
                var groupEntry = methodEntryPoints[group.fns[0].id.name].entry;
                var groupExit = rng.get();

                group.fns.forEach(method => {
                    methods.bumpArgumentsIndices(method, 1);

                    var entry = methodEntryPoints[method.id.name].entry;
                    groupFlattener.addMethod(method.body, entry, groupExit);
                });

                var groupAst = groupFlattener.getProgram(groupEntry, groupExit, {
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
                    body: retainedInternalFns.concat(retainedFns).concat(Array.prototype.concat.apply([], asyncPrograms.map(program => program.body)).concat(syncAst.body))
                };
            } else {
                ast = {
                    type: "Program",
                    body: retainedInternalFns.concat(retainedFns).concat(syncAst.body)
                };
            }
        })
        .otherwise(() => {
            var retainedInternalFns = takeNumericVmInternalStatements(ast);
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
        var postprocessing = new prPostprocessing(logger);
        ast = postprocessing.do(ast);
    });
    
    doTask("health", options.features.health, () => {
        var health = new prHealth(logger);
        ast = health.check(ast);
    });
    
    doTask("mangle", options.features.mangle, () => {
        if (hasMangleUnsupportedSyntax(ast)) {
            logger.warn("Skipping mangle because native modern syntax is not supported by the legacy mangler");
            return;
        }
        var uglifier = new prUglifier(logger);
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
    
    var codegenOptions = {
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
    
    var result = escodegen.generate(ast, codegenOptions);

    var duration = Date.now() - start;
    
    return {
        code: result.code || result,
        map: result.map && result.map.toString()
    };
};
