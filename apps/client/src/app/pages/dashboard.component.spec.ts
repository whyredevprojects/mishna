import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {
  QueryClient,
  provideTanStackQuery,
} from '@tanstack/angular-query-experimental';
import { DashboardComponent } from './dashboard.component';

// The "marked as memorized" notice — where the emailed CTA lands (`?memorized=1`).
//
// Only the notice is exercised. The component's queries are left unresolved on
// purpose (HttpClientTesting answers nothing), which parks it in its loading state —
// enough, because the notice renders from a route param, not from data.

function setup(memorized: string | null) {
  const navigate = vi.fn().mockResolvedValue(true);
  TestBed.configureTestingModule({
    imports: [DashboardComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideTanStackQuery(
        new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      ),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            queryParamMap: convertToParamMap(
              memorized === null ? {} : { memorized },
            ),
          },
        },
      },
      { provide: Router, useValue: { navigate } },
    ],
  });
  const fixture = TestBed.createComponent(DashboardComponent);
  fixture.detectChanges();
  return { fixture, navigate, el: fixture.nativeElement as HTMLElement };
}

describe('DashboardComponent — memorized notice', () => {
  it('shows the notice when the emailed link lands with ?memorized=1', () => {
    const { el } = setup('1');
    expect(el.querySelector('.memorized-notice')).not.toBeNull();
    expect(el.querySelector('.memorized-notice')?.textContent).toContain(
      'marked those mishnayos as learned',
    );
  });

  it.each([
    ['no param', null],
    ['some other value', '0'],
  ])('does not show it on an ordinary visit (%s)', (_label, value) => {
    const { el } = setup(value);
    expect(el.querySelector('.memorized-notice')).toBeNull();
  });

  it('hides the notice when dismissed', () => {
    const { fixture, el } = setup('1');
    el.querySelector<HTMLElement>('.memorized-notice wa-button')?.click();
    fixture.detectChanges();
    expect(el.querySelector('.memorized-notice')).toBeNull();
  });

  it('strips the param so a refresh does not replay the notice', () => {
    // Without this the notice reappears on every reload and back-navigation,
    // announcing something that happened once, possibly days ago. `replaceUrl` keeps
    // it out of history rather than adding an entry to bounce back through.
    const { navigate } = setup('1');
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { memorized: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      }),
    );
  });

  it('does not navigate at all on an ordinary visit', () => {
    const { navigate } = setup(null);
    expect(navigate).not.toHaveBeenCalled();
  });
});
