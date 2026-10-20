import { describe, expect, it } from 'vitest';
import { isLoopback, pairLink, parsePairCode } from './pair';

describe('pairing codes', () => {
  it('round-trips a server URL through the pairing link', () => {
    const server = 'https://openthings.tail1234.ts.net:8443/sub';
    expect(pairLink(server)).toBe('openthings://pair?server=https%3A%2F%2Fopenthings.tail1234.ts.net%3A8443%2Fsub');
    expect(parsePairCode(pairLink(server))).toBe(server);
  });

  it('accepts a plain http(s) URL and normalizes it', () => {
    expect(parsePairCode(' http://10.0.0.5:8080/ ')).toBe('http://10.0.0.5:8080');
    expect(parsePairCode('openthings://pair/?server=openthings.example.com')).toBe('https://openthings.example.com');
  });

  it('rejects codes that are not pairing codes', () => {
    expect(parsePairCode('hello')).toBeNull();
    expect(parsePairCode('openthings://today')).toBeNull();
    expect(parsePairCode('openthings://pair')).toBeNull();
    expect(parsePairCode('openthings://pair?server=javascript:alert(1)')).toBeNull();
    expect(parsePairCode('ftp://example.com')).toBeNull();
  });

  it('flags loopback addresses a phone cannot reach', () => {
    expect(isLoopback('http://localhost:8080')).toBe(true);
    expect(isLoopback('http://127.0.0.1:8080')).toBe(true);
    expect(isLoopback('http://[::1]:8080')).toBe(true);
    expect(isLoopback('https://openthings.tail1234.ts.net')).toBe(false);
    expect(isLoopback('http://192.168.1.10:8080')).toBe(false);
  });
});
