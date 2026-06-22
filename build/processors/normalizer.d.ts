import type { AstNode, AstStackFrame, LoggerLike } from "../types.js";
interface RandomAlphaLike {
    get(): string;
}
type PrivateStores = Record<string, string>;
export default class Normalizer {
    logger: LoggerLike;
    rngAlpha: RandomAlphaLike;
    constructor(logger: LoggerLike);
    simplify(ast: AstNode): AstNode;
    simplifyBlockStatement(node: AstNode): AstNode;
    simplifyWhileStatement(node: AstNode): AstNode;
    simplifyDoWhileStatement(node: AstNode): AstNode;
    simplifyForStatement(node: AstNode): AstNode;
    simplifyForInStatement(node: AstNode): AstNode;
    simplifyForOfStatement(node: AstNode): AstNode;
    simplifySwitchStatement(node: AstNode): AstNode;
    simplifyTryStatement(node: AstNode): AstNode;
    simplifyCallExpression(node: AstNode): AstNode;
    simplifyExpressionStatement(node: AstNode): AstNode;
    simplifyChainExpression(node: AstNode): AstNode;
    lowerOptionalChain(node: AstNode): AstNode;
    lowerOptionalMemberCall(node: AstNode): AstNode;
    simplifyLogicalExpression(node: AstNode): AstNode;
    simplifyObjectExpression(node: AstNode): AstNode;
    simplifyVariableDeclaration(node: AstNode, stack: AstStackFrame[]): AstNode;
    simplifyArrowFunctionExpression(node: AstNode): AstNode;
    simplifyClassDeclaration(node: AstNode): AstNode;
    lowerPrivateMembers(node: AstNode, privateStores: PrivateStores): void;
}
export {};
