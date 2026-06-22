"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Preprocessing = require("../processors/preprocessing");

function preprocess(code, variables = {}) {
    const processor = new Preprocessing({ warn () {} });
    return processor.process(code.trim(), variables)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n");
}

test("preprocessor evaluates boolean, comparison, and arithmetic conditions", () => {
    const code = `
        //#if FEATURE && (LEVEL + 1) >= 3
        enabled();
        //#else
        disabled();
        //#endif
    `;

    assert.equal(preprocess(code, { FEATURE: 1, LEVEL: 2 }), "enabled();");
    assert.equal(preprocess(code, { FEATURE: 1, LEVEL: 0 }), "disabled();");
});

test("preprocessor evaluates defined conditions more than once per condition", () => {
    const code = `
        //#if defined(A) && !defined(B) && defined(C)
        first();
        //#else
        second();
        //#endif
    `;

    assert.equal(preprocess(code, { A: 1, C: 1 }), "first();");
    assert.equal(preprocess(code, { A: 1, B: 1, C: 1 }), "second();");
});

test("preprocessor keeps ifdef and ifndef behavior", () => {
    const code = `
        //#ifdef ENABLED
        enabled();
        //#endif
        //#ifndef DISABLED
        visible();
        //#endif
    `;

    assert.equal(preprocess(code, { ENABLED: 1 }), "enabled();\nvisible();");
});
