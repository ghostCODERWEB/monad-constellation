import { describe, expect, it } from 'vitest';
import { SseReader } from './sse';

describe('SseReader', () => {
  it('reads events split across chunks', () => {
    const r = new SseReader();
    expect(r.push('data: {"a"')).toEqual([]);
    expect(r.push(':1}\n\ndata: x\n')).toEqual(['{"a":1}']);
    expect(r.push('\n')).toEqual(['x']);
  });
  it('handles CRLF and multi-line data', () => {
    const r = new SseReader();
    expect(r.push('data: one\r\ndata: two\r\n\r\n')).toEqual(['one\ntwo']);
  });
  it('ignores comments and other fields', () => {
    const r = new SseReader();
    expect(r.push(': ping\nevent: delta\ndata: hi\n\n')).toEqual(['hi']);
  });
  it('flushes a final event without a trailing blank line', () => {
    const r = new SseReader();
    expect(r.push('data: [DONE]')).toEqual([]);
    expect(r.end()).toEqual(['[DONE]']);
  });
});
