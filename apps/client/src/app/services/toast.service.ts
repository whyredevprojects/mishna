import { Injectable } from '@angular/core';

/**
 * Shows a transient, self-dismissing notification. Web Awesome ships no toast
 * component — only the inline `<wa-callout>` — so this imperatively drops a
 * fixed-position callout on the page and removes it after a timeout. The element
 * is already registered globally (see `main.ts`), so no template wiring is needed.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  /** Shows a danger toast in the corner for `ms` milliseconds. */
  error(message: string, ms = 5000): void {
    if (typeof document === 'undefined') {
      return;
    }
    const el = document.createElement('wa-callout');
    el.setAttribute('variant', 'danger');
    el.textContent = message;
    Object.assign(el.style, {
      position: 'fixed',
      insetBlockEnd: 'var(--wa-space-l, 1rem)',
      insetInlineEnd: 'var(--wa-space-l, 1rem)',
      zIndex: '1000',
      maxInlineSize: '24rem',
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }
}
