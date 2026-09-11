import assert from 'node:assert/strict';
import {
  allowedExternalProtocols,
  validateExternalLinkUrl,
} from '../src/security/externalLinkSafety';

function assertAllowed(url: string, protocol: string): void {
  const decision = validateExternalLinkUrl(url);

  assert.equal(decision.allowed, true, `${url} should be allowed`);

  if (decision.allowed) {
    assert.equal(decision.protocol, protocol);
  }
}

function assertBlocked(url: string, protocol?: string): void {
  const decision = validateExternalLinkUrl(url);

  assert.equal(decision.allowed, false, `${url} should be blocked`);

  if (!decision.allowed && protocol) {
    assert.equal(decision.protocol, protocol);
  }
}

assert.deepEqual([...allowedExternalProtocols].sort(), ['https:', 'mailto:']);

assertAllowed('https://example.com', 'https:');
assertAllowed('mailto:test@example.com', 'mailto:');

assertBlocked('http://example.com', 'http:');
assertBlocked('file:///C:/Windows/System32', 'file:');
assertBlocked('javascript:alert(1)', 'javascript:');
assertBlocked('data:text/html,<h1>x</h1>', 'data:');
assertBlocked('vbscript:msgbox(1)', 'vbscript:');
assertBlocked('ftp://example.com/file.txt', 'ftp:');
assertBlocked('customscheme://example', 'customscheme:');
assertBlocked('not a url');
assertBlocked('');

console.log('external-link-security-tests passed');
