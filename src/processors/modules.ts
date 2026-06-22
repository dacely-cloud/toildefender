import assert from "assert";
import path from "path";
import _ from "lodash";
import escope from "escope";
import estest from "../estest.js";
import traverser from "../traverser.js";
import ESUtils from "../esutils.js";
import utils from "../utils.js";
import type { Loose } from "../types.js";

/**
 * Transform calls to require().
 * @param {Node} node Root node
 * @param {Function} processor Transformer
 * @returns {Node} Root node
 */
function findRequires(node: Loose, processor: Loose) {
    assert.ok(estest.isNode(node));
    assert.equal(typeof processor, "function");
    
    return traverser.traverse(node, [], (node: Loose, stack: Loose) => {
        if (node.type == "CallExpression" && node.callee.type == "Identifier" && node.callee.name == "require") {
            return processor(node, stack);
        } else {
            return node;
        }
    });
}

/**
 * Split path into parts.
 * @param {string} path
 * @returns {string[]}
 */
function splitPath(path: Loose) {
    return path.split(/[\/\\]/g).filter((x: Loose) => x != null && x.length > 0);
}

/**
 * Normalize path.
 * @param {string[]} path
 * @returns {string}
 */
function normalizePath(path: Loose) {
    const parts = splitPath(path);
    
    for (let i = parts.length - 1; i >= 0; --i) {
        if (parts[i] == "" || parts[i] == ".") {
            parts.splice(i, 1);
        } else if (parts[i] == "..") {
            parts.splice(i - 1, 2);
        }
    }
    
    return parts.join("/");
}

/**
 * Get directory from path.
 * @param {string} path
 * @returns {string}
 */
function getPathDir(path: Loose) {
    return splitPath(path).slice(0, -1).join("/");
}

/**
 * Resolve path.
 * TODO: This doesnt work as expected when path starts with a slash. Fix this.
 * @param {string} curr Executing script
 * @param {string} path Path
 * @returns {string}
 */
function resolvePath(curr: Loose, path: Loose) {
    return normalizePath(getPathDir(curr) + "/" + path);
}

export default class Modules {
    logger: Loose;
    esutils: Loose;

    constructor (logger: Loose) {
        this.logger = logger;
        this.esutils = new ESUtils(logger);
    }

    /**
     * Replace references to exports and module.exports.
     * @param {Node} ast Root node
     * @param {Node} replacement Replacement
     * @returns {Node} Root node
     */
    replaceExportsReferences (ast: Loose, replacement: Loose) {
        this.esutils.setParentsRecursive(ast);
        
        const scopeManager = escope.analyze(ast, { optimistic: true });
        
        scopeManager.scopes.forEach((scope: Loose) => {
            scope.references
            .filter((reference: Loose) => !utils.isResolvedReference(reference))
            .forEach((reference: Loose) => {
                const parent = reference.identifier.toildefender$parent;
                
                if (reference.identifier.name == "exports") {
                    this.esutils.replaceNode(ast, reference.identifier, utils.cloneISwearIKnowWhatImDoing(replacement));
                } else if (
                    parent.type == "MemberExpression"
                    && (parent.object.type == "Identifier" && parent.object.name == "module")
                    && ((parent.property.type == "Identifier" && parent.property.name == "exports") || (parent.property.type == "Literal" && parent.property.value == "exports"))
                ) {
                    this.esutils.replaceNode(ast, parent, utils.cloneISwearIKnowWhatImDoing(replacement));
                }
            });
        });
        
        return ast;
    }
    
    /**
     * Merges multiple modules into a single main module.
     * @param {Object.<string, Node>} modules Module dictionary
     * @param {string} mainKey Main module key
     * @param {ScopeManager} scopeManager Scope manager
     * @returns {Node} Transformed root node
     */
    merge (modules: Loose, mainKey: Loose, scopeManager: Loose) {
        assert.ok(Object.keys(modules).length > 0);
        assert.equal(typeof mainKey, "string");
        
        modules = _.mapKeys(modules, (value: Loose, key: Loose) => normalizePath(key));
        mainKey = normalizePath(mainKey);
        
        const declaration: Loose = {
            type: "VariableDeclaration",
            kind: "var",
            declarations: []
        };
        const embeds: Loose[] = [];
        
        const rng = new utils.UniqueRandomAlpha(3);
        
        const processedModules: Record<string, Loose> = {};
        
        const requiresOrder: Loose[] = [];
        
        const walkDeps = (key: Loose, stack: Loose = []) => {
            
            findRequires(modules[key], (node: Loose) => {
                let path = node.arguments.length > 0 && node.arguments[0].value;

                if (!path) {
                    return node;
                }
                
                if (![ "/", "./", "../" ].some((x: Loose) => path.indexOf(x) == 0)) {
                    return node;
                }
                
                path = resolvePath(key, path);
                
                if (path.slice(-3) == ".js") {
                    path = path.slice(0, -3);
                }
                
                if (!modules[path]) {
                    path = path + ".js";
                }
                
                requiresOrder.push(path);
                
                let _module = modules[path];
                if (!_module) {
                    this.logger.warn(`Local module not found: ${path}`);
                    return node;
                }
                
                if (stack.indexOf(path) == -1) {
                    walkDeps(path, stack.concat(path));
                } else {
                    this.logger.warn("Skipping cyclic depedency: " + path);
                }
                
                if (!processedModules[path]) {
                    const id = processedModules[path] = "$$module$" + rng.get();
                
                    declaration.declarations.push({
                        type: "VariableDeclarator",
                        id: { type: "Identifier", name: id },
                        init: { type: "ObjectExpression", properties: [] }
                    });
                    
                    _module = this.replaceExportsReferences(_module, { type: "Identifier", name: id });
                    
                    embeds.push({
                        type: "ExpressionStatement",
                        expression: {
                            type: "CallExpression",
                            callee: {
                                type: "FunctionExpression",
                                params: [
                                ],
                                body: {
                                    type: "BlockStatement",
                                    body: _module.body
                                }
                            },
                            arguments: [
                                
                            ]
                        },
                        toildefender$module: path
                    });
                }
                
                return { type: "Identifier", name: processedModules[path] };
            });
        };
        walkDeps(mainKey);
        
        // Check whether the VariableDeclaration contains VariableDeclarators, because an empty VariableDeclaration causes errors
        if (declaration.declarations.length > 0) {
            modules[mainKey].body = [ declaration ].concat(embeds).concat(modules[mainKey].body);
        }
        
        return modules[mainKey];
    }

};
