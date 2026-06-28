import { describe, expect, it } from 'vitest';
import { isolateHtmlBlocks } from './about';

describe('isolateHtmlBlocks', () => {
  it('adds a blank line after a standalone tag followed by Markdown', () => {
    // The bug: a `<br>` spacer with no trailing blank line starts a CommonMark HTML
    // block that swallows the heading/bold/image that follow.
    const input = ['intro', '', '<br>', '**bold**', '![alt](url)'].join('\n');
    expect(isolateHtmlBlocks(input)).toBe(
      ['intro', '', '<br>', '', '**bold**', '![alt](url)'].join('\n'),
    );
  });

  it('isolates a tag wedged between two non-blank lines', () => {
    expect(isolateHtmlBlocks('above\n<br>\nbelow')).toBe('above\n\n<br>\n\nbelow');
  });

  it('handles void, self-closing and closing tags', () => {
    expect(isolateHtmlBlocks('<hr>\nx')).toBe('<hr>\n\nx');
    expect(isolateHtmlBlocks('<br/>\nx')).toBe('<br/>\n\nx');
    expect(isolateHtmlBlocks('<br />\nx')).toBe('<br />\n\nx');
    expect(isolateHtmlBlocks('</div>\nx')).toBe('</div>\n\nx');
  });

  it('is idempotent on already-correct content', () => {
    const ok = ['intro', '', '<br>', '', '**bold**'].join('\n');
    expect(isolateHtmlBlocks(ok)).toBe(ok);
  });

  it('leaves tags inside fenced code blocks untouched', () => {
    const fenced = ['```html', '<br>', 'text', '```'].join('\n');
    expect(isolateHtmlBlocks(fenced)).toBe(fenced);
  });

  it('ignores lines that are a tag plus other content', () => {
    const inline = 'see <br> here\n<a href="x">link</a>';
    expect(isolateHtmlBlocks(inline)).toBe(inline);
  });

  it('returns empty string unchanged', () => {
    expect(isolateHtmlBlocks('')).toBe('');
  });
});
