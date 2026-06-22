import type { LogAdapter } from "./types.js";
export default class Logger {
    private readonly adapter;
    constructor(adapter?: LogAdapter);
    log(...args: unknown[]): void;
    error(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    info(...args: unknown[]): void;
    debug(...args: unknown[]): void;
}
