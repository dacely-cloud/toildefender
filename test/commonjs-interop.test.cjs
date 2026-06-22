const assert = require("node:assert/strict");
const test = require("node:test");

test("CommonJS package entry exposes the public API", () => {
    const toildefender = require("..");

    assert.equal(typeof toildefender.do, "function");
    assert.equal(typeof toildefender.protect, "function");
    assert.equal(typeof toildefender.features, "object");
});

test("CommonJS can load legacy root shims", () => {
    for (const entry of ["../toildefender.js", "../defendjs.js"]) {
        const toildefender = require(entry);

        assert.equal(typeof toildefender.do, "function");
        assert.equal(typeof toildefender.protect, "function");
        assert.equal(typeof toildefender.features, "object");
    }
});
