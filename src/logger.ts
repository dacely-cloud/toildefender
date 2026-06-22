import type { LogAdapter, LogLevel } from "./types.js";

export default class Logger {
    private readonly adapter: LogAdapter;

    constructor(adapter?: LogAdapter) {
        this.adapter = adapter || function (level: LogLevel, args: unknown[]) {
            console.log(level + ": " + JSON.stringify(args));
        };
    }
    
    log(...args: unknown[]): void {
        this.adapter("log", args);
    }
    
    error(...args: unknown[]): void {
        this.adapter("error", args);
    }
    
    warn(...args: unknown[]): void {
        this.adapter("warn", args);
    }
    
    info(...args: unknown[]): void {
        this.adapter("info", args);
    }
    
    debug(...args: unknown[]): void {
        this.adapter("debug", args);
    }
}
