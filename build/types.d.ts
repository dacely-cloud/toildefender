export type LogLevel = "log" | "error" | "warn" | "info" | "debug";
export type LogAdapter = (level: LogLevel, data: unknown[]) => void;
export interface LoggerLike {
    log(...data: unknown[]): void;
    error(...data: unknown[]): void;
    warn(...data: unknown[]): void;
    info(...data: unknown[]): void;
    debug(...data: unknown[]): void;
}
export type FeatureName = "dead_code" | "scope" | "control_flow" | "identifiers" | "numeric_vm" | "object_packing" | "literals" | "mangle" | "compress";
export type FeatureConfig = Record<FeatureName, boolean>;
export interface FeatureDescription {
    dependencies: FeatureName[];
    descriptions: Record<string, string>;
    default: boolean;
}
export type FeatureDescriptions = Record<FeatureName, FeatureDescription>;
export interface HashMeshOptions {
    bindToVmState?: boolean;
    chaffRatio?: number;
    deriveDialectFromMesh?: boolean;
    enabled?: boolean;
    encodeChaff?: boolean;
    mode?: "balanced" | "aggressive" | string;
    serverBound?: boolean;
    unlock?: "per-function" | string;
}
export interface NumericVmOptions {
    enabled?: boolean;
    hashMesh?: HashMeshOptions;
    maxFunctionSize?: number;
    maxFunctions?: number;
    minFunctionSize?: number;
    mode?: "balanced" | "aggressive" | string;
    perFunctionDialect?: boolean;
    ratio?: number;
    seed?: string;
    virtualize?: "marked" | "all-supported" | string;
}
export interface ProtectionOptions {
    hashMesh?: HashMeshOptions;
    virtualMachine?: NumericVmOptions & {
        bigintBytecode?: boolean;
        encodeConstants?: boolean;
        randomizedOpcodes?: boolean;
    };
}
export interface ControlFlowOptions {
    ratio?: number;
    seed?: string;
}
export interface ScopeOptions {
    ratio?: number;
    seed?: string;
}
export interface ToilDefenderOptions {
    babel?: boolean;
    babelPreserveAsync?: boolean;
    babelTarget?: string;
    code: string;
    controlFlow?: ControlFlowOptions;
    features?: Partial<FeatureConfig>;
    forceFeatures?: Partial<FeatureConfig>;
    logAdapter?: LogAdapter;
    logLevel?: LogLevel;
    modulesCode?: Record<string, string>;
    numericVm?: NumericVmOptions;
    preprocessorVariables?: Record<string, string | number | boolean | null>;
    protections?: ProtectionOptions;
    runtimeHelpers?: boolean;
    scope?: ScopeOptions;
    simplify?: boolean;
}
export interface ToilDefenderResult {
    code: string;
    map?: string;
}
export type Loose = any;
export type AstNode = Record<string, Loose> & {
    type: string;
};
export type AstStackFrame = {
    node: AstNode;
    key?: string | undefined;
};
export type AstVisitor = (node: AstNode, stack: AstStackFrame[]) => AstNode;
export type AstChildVisitor = (node: AstNode, key: string) => AstNode | AstNode[];
export interface ScopeLike {
    block: AstNode;
}
export interface ScopeManagerLike {
    scopes: ScopeLike[];
}
export interface ReferenceLike {
    resolved?: {
        defs?: unknown[];
    } | null;
}
