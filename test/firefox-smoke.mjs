import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { firefox } from 'playwright';

import toildefender from '../build/toildefender.js';

const SOURCE = `
    (function (root) {
        function browserCheck(input) {
            var rows = [];
            var i = 0;
            while (i < input.length) {
                rows.push(input.charCodeAt(i) + i + 7);
                i += 1;
            }
            var total = rows[0] + rows[rows.length - 1];
            if (input.length > 5 && input.charCodeAt(0) === 70) {
                total += 13;
            }
            return {
                ok: rows.length > 2,
                total: total,
                tags: ["firefox", input.length, typeof window, typeof document]
            };
        }
        root.__result = [
            browserCheck("Firefox"),
            browserCheck("bot"),
            window === globalThis
        ];
    })(globalThis);
`;

const FEATURES = {
    dead_code: false,
    scope: true,
    control_flow: true,
    identifiers: true,
    numeric_vm: true,
    object_packing: true,
    literals: true,
    mangle: true,
    compress: true,
};

function protect(code) {
    return toildefender.do({
        code,
        modulesCode: {},
        features: FEATURES,
        protections: {
            hashMesh: {
                enabled: true,
                mode: 'aggressive',
                unlock: 'per-function',
            },
            virtualMachine: {
                enabled: true,
                maxFunctionSize: 400,
                minFunctionSize: 1,
                seed: 'firefox-smoke',
                virtualize: 'all-supported',
            },
        },
        logLevel: 'error',
    }).code;
}

function html(script) {
    return `<!doctype html>
<meta charset="utf-8">
<script>
${script.replaceAll('</script', '<\\/script')}
</script>`;
}

async function withServer(pages, task) {
    const server = createServer((request, response) => {
        const body = pages.get(request.url ?? '/') ?? pages.get('/') ?? '';
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(body);
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    try {
        const address = server.address();
        assert(address !== null && typeof address !== 'string');
        return await task(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

async function pageResult(browser, url) {
    const page = await browser.newPage();
    try {
        await page.goto(url, { waitUntil: 'load' });
        return await page.evaluate(() => globalThis.__result);
    } finally {
        await page.close();
    }
}

const protectedCode = protect(SOURCE);
assert.match(protectedCode, /\d+n/);
assert.equal(protectedCode.includes('return {'), false);
assert.equal(protectedCode.includes('Firefox'), false);

await withServer(
    new Map([
        ['/raw', html(SOURCE)],
        ['/protected', html(protectedCode)],
    ]),
    async (origin) => {
        const browser = await firefox.launch({ headless: true });
        try {
            const raw = await pageResult(browser, `${origin}/raw`);
            const defended = await pageResult(browser, `${origin}/protected`);
            assert.deepEqual(defended, raw);
        } finally {
            await browser.close();
        }
    },
);

console.log('Firefox smoke passed');
