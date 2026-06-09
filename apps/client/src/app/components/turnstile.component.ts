import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { environment } from '../../environments/environment';

/** The slice of the Cloudflare Turnstile JS API we use (explicit rendering). */
interface TurnstileApi {
  render(
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    },
  ): string;
  reset(widgetId?: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// `render=explicit` means api.js defines window.turnstile but renders nothing
// until we call render() ourselves — so we control placement and timing.
const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

// Module-level so the api.js script is injected at most once per document even
// when several Turnstile widgets mount (e.g. navigating between sign-in pages).
let scriptPromise: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null; // allow a later retry
      reject(new Error('Failed to load Turnstile'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * Renders a Cloudflare Turnstile widget and surfaces its token. Drop
 * `<app-turnstile (verified)="token.set($event)">` into a form, send the token as
 * the `x-captcha-response` header on the better-auth call, and call `reset()` in
 * the request's error handler — Turnstile tokens are single-use, so a retry needs
 * a fresh one.
 */
@Component({
  selector: 'app-turnstile',
  template: `<div #widget></div>`,
})
export class TurnstileComponent implements AfterViewInit, OnDestroy {
  private readonly widget =
    viewChild.required<ElementRef<HTMLDivElement>>('widget');

  /** Emits each time the widget issues a fresh token. */
  readonly verified = output<string>();
  /** Latest token, or null before verification / after expiry/reset. */
  readonly token = signal<string | null>(null);

  private widgetId?: string;

  ngAfterViewInit(): void {
    loadTurnstile()
      .then(() => {
        const api = window.turnstile;
        if (!api) return;
        this.widgetId = api.render(this.widget().nativeElement, {
          sitekey: environment.turnstileSiteKey,
          callback: (token: string) => {
            this.token.set(token);
            this.verified.emit(token);
          },
          'expired-callback': () => this.token.set(null),
          'error-callback': () => this.token.set(null),
        });
      })
      .catch(() => {
        // Script blocked (offline / ad-blocker). Token stays null so the form's
        // submit button stays disabled; the server would reject anyway.
      });
  }

  /** Drops the current single-use token and asks Turnstile for a new one. */
  reset(): void {
    this.token.set(null);
    if (this.widgetId) window.turnstile?.reset(this.widgetId);
  }

  ngOnDestroy(): void {
    if (this.widgetId) window.turnstile?.remove(this.widgetId);
  }
}
