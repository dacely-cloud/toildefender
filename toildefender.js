#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { run } from "./build/cli.js";
import toildefender, { do as protectCode, features, protect } from "./build/toildefender.js";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    run();
}

export { protectCode as do, features, protect };
export default toildefender;
