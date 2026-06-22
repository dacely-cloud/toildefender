import { EventEmitter } from "events";
import type { AstNode, LoggerLike } from "../types.js";
interface RandomLike {
    get(): number;
}
interface JumpTarget {
    id: number;
    label: string | null;
}
interface ProgramOptions {
    async?: boolean;
    generator?: boolean;
    invoke?: boolean;
    name?: string;
}
export default class Flattener {
    logger: LoggerLike;
    rng: RandomLike;
    emitter: EventEmitter;
    output: AstNode[];
    handlers: AstNode[];
    breaks: JumpTarget[];
    continues: JumpTarget[];
    constructor(logger: LoggerLike, rng: RandomLike);
    addMethod(input: AstNode, entry: number, exit: number): void;
    getCases(entry: number, exit: number): AstNode;
    getProgram(entry: number, exit: number, options?: ProgramOptions): AstNode;
    transformStatement(node: AstNode, entry: number, exit: number): void;
    transformBlock(node: AstNode, entry: number, exit: number): void;
    transformSequence(node: AstNode, entry: number, exit: number): void;
    transformIf(node: AstNode, entry: number, exit: number): void;
    transformWhile(node: AstNode, entry: number, exit: number): void;
    transformDoWhile(node: AstNode, entry: number, exit: number): void;
    transformSwitch(node: AstNode, entry: number, exit: number): void;
    transformTryCatch(node: AstNode, entry: number, exit: number): void;
    unifyPrefixStatements(ast: AstNode): AstNode;
}
export {};
