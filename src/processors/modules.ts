import assert from "assert";
import escope from "escope";
import estest from "../estest.js";
import traverser from "../traverser.js";
import ESUtils from "../esutils.js";
import utils from "../utils.js";
import type { AstNode, AstStackFrame, LoggerLike, ReferenceLike } from "../types.js";

type RequireProcessor = (node: AstNode, stack: AstStackFrame[]) => AstNode;

interface ModuleReference extends ReferenceLike {
    identifier: AstNode;
}

interface ModuleScope {
    references: ModuleReference[];
}

interface ModuleScopeManager {
    scopes: ModuleScope[];
}

function nodeArray(value: unknown): AstNode[] {
    return Array.isArray(value) ? (value as AstNode[]) : [];
}

function childNode(node: AstNode, key: string): AstNode | null {
    const value = (node as Record<string, unknown>)[key];
    return estest.isNode(value) ? value : null;
}

function nodeName(node: AstNode | null): string | null {
    const name = (node as { name?: unknown } | null)?.name;
    return typeof name == "string" ? name : null;
}

function literalValue(node: AstNode | null): unknown {
    return (node as { value?: unknown } | null)?.value;
}

function nodeArguments(node: AstNode): AstNode[] {
    return nodeArray((node as { arguments?: unknown }).arguments);
}

function nodeBody(node: AstNode): AstNode[] {
    return nodeArray((node as { body?: unknown }).body);
}

function setNodeBody(node: AstNode, body: AstNode[]): void {
    (node as { body?: AstNode[] }).body = body;
}

function parentOf(node: AstNode): AstNode | null {
    const parent = (node as { toildefender$parent?: unknown }).toildefender$parent;
    return estest.isNode(parent) ? parent : null;
}

function isIdentifierNamed(node: AstNode | null, name: string): boolean {
    return node?.type == "Identifier" && nodeName(node) == name;
}

function isRequireCall(node: AstNode): boolean {
    return node.type == "CallExpression" && isIdentifierNamed(childNode(node, "callee"), "require");
}

function firstStringArgument(node: AstNode): string | null {
    const first = nodeArguments(node)[0] || null;
    const value = literalValue(first);
    return typeof value == "string" ? value : null;
}

function isModuleExportsMember(node: AstNode | null): boolean {
    if (!node || node.type != "MemberExpression") {
        return false;
    }

    const object = childNode(node, "object");
    const property = childNode(node, "property");
    return isIdentifierNamed(object, "module")
        && (isIdentifierNamed(property, "exports") || (property?.type == "Literal" && literalValue(property) == "exports"));
}

/**
 * Transform calls to require().
 * @param {Node} node Root node
 * @param {Function} processor Transformer
 * @returns {Node} Root node
 */
function findRequires(node: AstNode, processor: RequireProcessor): AstNode {
    assert.ok(estest.isNode(node));
    assert.equal(typeof processor, "function");
    
    return traverser.traverse(node, [], (child: AstNode, stack: AstStackFrame[]) => {
        if (isRequireCall(child)) {
            return processor(child, stack);
        }
        return child;
    });
}

/**
 * Split path into parts.
 * @param {string} path
 * @returns {string[]}
 */
function splitPath(path: string): string[] {
    return path.split(/[\\/]/g).filter((part: string) => part.length > 0);
}

/**
 * Normalize path.
 * @param {string[]} path
 * @returns {string}
 */
function normalizePath(path: string): string {
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
function getPathDir(path: string): string {
    return splitPath(path).slice(0, -1).join("/");
}

/**
 * Resolve path.
 * TODO: This doesnt work as expected when path starts with a slash. Fix this.
 * @param {string} curr Executing script
 * @param {string} path Path
 * @returns {string}
 */
function resolvePath(curr: string, path: string): string {
    return normalizePath(getPathDir(curr) + "/" + path);
}

export default class Modules {
    logger: LoggerLike;
    esutils: ESUtils;

    constructor (logger: LoggerLike) {
        this.logger = logger;
        this.esutils = new ESUtils(logger);
    }

    /**
     * Replace references to exports and module.exports.
     * @param {Node} ast Root node
     * @param {Node} replacement Replacement
     * @returns {Node} Root node
     */
    replaceExportsReferences (ast: AstNode, replacement: AstNode): AstNode {
        this.esutils.setParentsRecursive(ast);
        
        const scopeManager = escope.analyze(ast, { optimistic: true }) as unknown as ModuleScopeManager;
        
        scopeManager.scopes.forEach((scope: ModuleScope) => {
            scope.references
            .filter((reference: ModuleReference) => !utils.isResolvedReference(reference))
            .forEach((reference: ModuleReference) => {
                const parent = parentOf(reference.identifier);
                
                if (nodeName(reference.identifier) == "exports") {
                    this.esutils.replaceNode(ast, reference.identifier, utils.cloneISwearIKnowWhatImDoing(replacement));
                } else if (parent && isModuleExportsMember(parent)) {
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
    merge (modules: Record<string, AstNode>, mainKey: string, _scopeManager: unknown): AstNode {
        assert.ok(Object.keys(modules).length > 0);
        assert.equal(typeof mainKey, "string");
        
        const normalizedModules: Record<string, AstNode> = {};
        for (const [key, value] of Object.entries(modules)) {
            normalizedModules[normalizePath(key)] = value;
        }
        const normalizedMainKey = normalizePath(mainKey);
        
        const declarationDeclarations: AstNode[] = [];
        const declaration: AstNode = {
            type: "VariableDeclaration",
            kind: "var",
            declarations: declarationDeclarations
        };
        const embeds: AstNode[] = [];
        
        const rng = new utils.UniqueRandomAlpha(3);
        
        const processedModules: Record<string, string> = {};
        
        const walkDeps = (key: string, stack: string[] = []): void => {
            const moduleAst = normalizedModules[key];
            if (!moduleAst) {
                this.logger.warn(`Local module not found: ${key}`);
                return;
            }
            
            findRequires(moduleAst, (node: AstNode) => {
                const requestPath = firstStringArgument(node);

                if (!requestPath) {
                    return node;
                }
                
                if (![ "/", "./", "../" ].some((prefix: string) => requestPath.startsWith(prefix))) {
                    return node;
                }
                
                let requiredPath = resolvePath(key, requestPath);
                
                if (requiredPath.slice(-3) == ".js") {
                    requiredPath = requiredPath.slice(0, -3);
                }
                
                if (!normalizedModules[requiredPath]) {
                    requiredPath = requiredPath + ".js";
                }
                
                let requiredModule = normalizedModules[requiredPath];
                if (!requiredModule) {
                    this.logger.warn(`Local module not found: ${requiredPath}`);
                    return node;
                }
                
                if (stack.indexOf(requiredPath) == -1) {
                    walkDeps(requiredPath, stack.concat(requiredPath));
                } else {
                    this.logger.warn("Skipping cyclic depedency: " + requiredPath);
                }
                
                if (!processedModules[requiredPath]) {
                    const id = "$$module$" + rng.get();
                    processedModules[requiredPath] = id;
                
                    declarationDeclarations.push({
                        type: "VariableDeclarator",
                        id: { type: "Identifier", name: id },
                        init: { type: "ObjectExpression", properties: [] }
                    });
                    
                    requiredModule = this.replaceExportsReferences(requiredModule, { type: "Identifier", name: id });
                    
                    embeds.push({
                        type: "ExpressionStatement",
                        expression: {
                            type: "CallExpression",
                            callee: {
                                type: "FunctionExpression",
                                params: [],
                                body: {
                                    type: "BlockStatement",
                                    body: nodeBody(requiredModule)
                                }
                            },
                            arguments: []
                        },
                        toildefender$module: requiredPath
                    });
                }
                
                return { type: "Identifier", name: processedModules[requiredPath] };
            });
        };
        walkDeps(normalizedMainKey);
        
        const mainModule = normalizedModules[normalizedMainKey];
        assert.ok(mainModule, `Main module not found: ${normalizedMainKey}`);

        // Check whether the VariableDeclaration contains VariableDeclarators, because an empty VariableDeclaration causes errors
        if (declarationDeclarations.length > 0) {
            setNodeBody(mainModule, [ declaration ].concat(embeds).concat(nodeBody(mainModule)));
        }
        
        return mainModule;
    }

};
