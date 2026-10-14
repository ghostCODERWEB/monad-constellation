// A small server-sent-events reader: feed it decoded text chunks as they
// arrive and it returns each complete event's data. Handles CRLF and LF line
// endings, multi-line `data:` fields (joined with "\n"), comments, and a final
// event that ends without a blank line (call `end()`).
export class SseReader {
  private buf = '';
  private data: string[] = [];

  push(chunk: string): string[] {
    this.buf += chunk;
    const out: string[] = [];
    let cut: number;
    while ((cut = this.buf.search(/\r\n|\r|\n/)) >= 0) {
      const line = this.buf.slice(0, cut);
      this.buf = this.buf.slice(cut + (this.buf.startsWith('\r\n', cut) ? 2 : 1));
      this.line(line, out);
    }
    return out;
  }

  /** Flushes whatever is left when the stream closes. */
  end(): string[] {
    const out: string[] = [];
    if (this.buf) { this.line(this.buf, out); this.buf = ''; }
    this.dispatch(out);
    return out;
  }

  private line(line: string, out: string[]) {
    if (line === '') { this.dispatch(out); return; }
    if (line.startsWith(':')) return;
    const i = line.indexOf(':');
    const field = i < 0 ? line : line.slice(0, i);
    let value = i < 0 ? '' : line.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.data.push(value);
  }

  private dispatch(out: string[]) {
    if (this.data.length) out.push(this.data.join('\n'));
    this.data = [];
  }
}
