#!/usr/bin/env node

import assert from 'node:assert/strict';

const [rawBaseUrl, expectedCommit] = process.argv.slice(2);
assert.ok(rawBaseUrl, 'usage: verify-cloudflare-deployment.mjs <url> <commit>');
assert.match(expectedCommit ?? '', /^[0-9a-f]{40}$/i, 'expected commit must be a full Git SHA');

const baseUrl = new URL(rawBaseUrl);
baseUrl.pathname = '/';
baseUrl.search = '';
baseUrl.hash = '';

async function request(pathname, expectedStatus = 200) {
  const url = new URL(pathname, baseUrl);
  let lastError;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === expectedStatus) return response;
      lastError = new Error(`${url} returned ${response.status}; expected ${expectedStatus}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw lastError;
}

const root = await request('/');
assert.equal(root.headers.get('server')?.toLowerCase(), 'cloudflare', 'response must be served by Cloudflare');
const html = await root.text();
assert.match(html, /<title>xmtp\.mx<\/title>/i, 'root HTML must contain the xmtp.mx title');

const marker = await request('/cloudflare-deployment.txt');
assert.equal((await marker.text()).trim(), expectedCommit, 'deployed marker must match the tested commit');

await request('/favicon.ico');

const assetPath = html.match(/["']([^"']*\/_next\/static\/[^"']+)["']/)?.[1];
assert.ok(assetPath, 'root HTML must reference a Next.js static asset');
const asset = await request(assetPath);
assert.ok(Number(asset.headers.get('content-length') ?? 1) > 0, 'Next.js static asset must not be empty');

await request(`/cloudflare-smoke-missing-${expectedCommit.slice(0, 12)}/`, 404);

console.log(`Verified Cloudflare frontend commit ${expectedCommit} at ${baseUrl.origin}`);
