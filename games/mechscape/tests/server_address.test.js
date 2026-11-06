import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServer, mixedContentProblem } from '../src/client/server_address.js';

test('server addresses are made into origins', () => {
  assert.equal(normalizeServer('abc-def.trycloudflare.com'), 'https://abc-def.trycloudflare.com');
  assert.equal(normalizeServer(' https://abc.trycloudflare.com/ '), 'https://abc.trycloudflare.com');
  assert.equal(normalizeServer('localhost:2567'), 'http://localhost:2567');
  assert.equal(normalizeServer('192.168.1.5:2567'), 'http://192.168.1.5:2567');
  assert.equal(normalizeServer('wss://x.example.com'), 'https://x.example.com');
  assert.equal(normalizeServer(''), null);
  assert.equal(normalizeServer('ftp://x.example.com'), null);
});

test('an https page only reaches https servers, apart from localhost', () => {
  assert.ok(mixedContentProblem('http://x.example.com', 'https:'));
  assert.equal(mixedContentProblem('http://localhost:2567', 'https:'), null);
  assert.equal(mixedContentProblem('https://x.example.com', 'https:'), null);
  assert.equal(mixedContentProblem('http://x.example.com', 'http:'), null);
});
