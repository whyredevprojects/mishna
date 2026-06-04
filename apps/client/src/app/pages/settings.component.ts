import { CUSTOM_ELEMENTS_SCHEMA, Component, inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

/** Read-only account info for the signed-in user: name, email, user ID, role. */
@Component({
  selector: 'app-settings',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      dl {
        margin: 0;
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--wa-space-2xs, 0.125rem) var(--wa-space-m, 0.75rem);
      }
      dt {
        color: var(--wa-color-text-quiet, #6b6358);
      }
      dd {
        margin: 0;
        word-break: break-all;
      }
      .mono {
        font-family: var(--wa-font-family-code, monospace);
        font-size: var(--wa-font-size-s, 0.875rem);
      }
    `,
  ],
  template: `
    <div class="stack">
      <h2>Settings</h2>
      @if (auth.me()?.user; as user) {
        <wa-card>
          <dl>
            <dt>Name</dt>
            <dd>{{ user.name || '—' }}</dd>
            <dt>Email</dt>
            <dd>{{ user.email || '—' }}</dd>
            <dt>User ID</dt>
            <dd class="mono">{{ user.id }}</dd>
            <dt>Role</dt>
            <dd>{{ user.role || 'user' }}</dd>
          </dl>
        </wa-card>
      } @else {
        <wa-spinner style="font-size: 2rem"></wa-spinner>
      }
    </div>
  `,
})
export class SettingsComponent {
  protected readonly auth = inject(AuthService);
}
