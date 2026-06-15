import {
  AfterViewInit,
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import {
  QueryClient,
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';
import Editor from '@toast-ui/editor';
// The editor's stylesheet is loaded globally via the `styles` array in
// project.json — NOT as a side-effect `import` here. A bare CSS import inside a
// lazily-loaded standalone component is emitted by the esbuild builder but never
// injected at runtime, so the editor would render completely unstyled in prod.
import { AdminService } from '../services/admin.service';
import { ToastService } from '../services/toast.service';
import { queryKeys } from '../queries/query-keys';
import { adminAboutQueryOptions } from '../queries/queries';

/**
 * Admin editor for the public www site's "general info" copy (`about.md`). Wraps the
 * Toast UI Markdown editor (a vanilla-JS lib that owns its own DOM subtree): it's
 * instantiated in `ngAfterViewInit` against the host element and `destroy()`ed in
 * `ngOnDestroy` so leaving the route leaks no DOM/listeners. Saving reads
 * `getMarkdown()` and commits via `POST /api/admin/about`; pasted/dropped images are
 * uploaded to R2 (`addImageBlobHook`) and inserted as plain Markdown URLs.
 */
@Component({
  selector: 'app-admin-about',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-m, 0.75rem);
        flex-wrap: wrap;
      }
      .head p {
        margin: 0;
        max-width: 40rem;
      }
      .editor-host {
        margin-block-start: var(--wa-space-m, 0.75rem);
      }
      .hidden {
        display: none;
      }
    `,
  ],
  template: `
    <div class="stack">
      <div class="head">
        <div>
          <h3 style="margin: 0">About page</h3>
          <p class="muted">
            Edits the public site's intro copy. Saving commits it and the site
            rebuilds automatically.
          </p>
        </div>
        <wa-button
          variant="brand"
          [attr.loading]="saveMutation.isPending() ? '' : null"
          [attr.disabled]="query.isError() || query.isPending() ? '' : null"
          (click)="save()"
        >
          <wa-icon slot="start" name="floppy-disk"></wa-icon>
          Save
        </wa-button>
      </div>

      @if (query.isPending()) {
        <wa-callout variant="neutral">
          <wa-spinner slot="icon"></wa-spinner>
          Loading the current content…
        </wa-callout>
      } @else if (query.isError()) {
        <wa-callout variant="danger">
          Could not load the about page. {{ errorDetail() }}
        </wa-callout>
      }

      <!-- The host stays mounted in all states so the editor (created in
           ngAfterViewInit) always has its element; it's just hidden on error. -->
      <div
        #editorHost
        class="editor-host"
        [class.hidden]="query.isError()"
      ></div>
    </div>
  `,
})
export class AdminAboutComponent implements AfterViewInit, OnDestroy {
  private readonly admin = inject(AdminService);
  private readonly toast = inject(ToastService);
  private readonly queryClient = inject(QueryClient);

  private readonly editorHost =
    viewChild.required<ElementRef<HTMLDivElement>>('editorHost');

  private editor?: Editor;
  /** Guards against re-seeding the editor (which would clobber unsaved edits). */
  private seeded = false;

  protected readonly query = injectQuery(() => adminAboutQueryOptions(this.admin));

  protected readonly saveMutation = injectMutation(() => ({
    mutationFn: (markdown: string) =>
      firstValueFrom(this.admin.saveAbout(markdown)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: queryKeys.adminAbout });
      this.toast.success('About page saved — the site will rebuild shortly.');
    },
    onError: (err: HttpErrorResponse) => {
      const detail = this.detailOf(err);
      this.toast.error(
        detail ? `Could not save: ${detail}` : 'Could not save the about page.',
      );
    },
  }));

  constructor() {
    // Seed the editor once both it and the fetched Markdown are ready. The query may
    // resolve before or after ngAfterViewInit, so handle either order here.
    effect(() => {
      const data = this.query.data();
      if (data && this.editor && !this.seeded) {
        this.editor.setMarkdown(data.markdown ?? '');
        this.seeded = true;
      }
    });
  }

  ngAfterViewInit(): void {
    this.editor = new Editor({
      el: this.editorHost().nativeElement,
      height: '600px',
      initialEditType: 'wysiwyg',
      previewStyle: 'vertical',
      usageStatistics: false,
      initialValue: this.query.data()?.markdown ?? '',
      hooks: {
        addImageBlobHook: (blob, callback) => {
          void this.handleImage(blob, callback);
        },
      },
    });
    if (this.query.data()) {
      this.seeded = true;
    }
  }

  ngOnDestroy(): void {
    this.editor?.destroy();
    this.editor = undefined;
  }

  protected save(): void {
    if (!this.editor) return;
    this.saveMutation.mutate(this.editor.getMarkdown());
  }

  protected errorDetail(): string {
    return this.query.error() instanceof HttpErrorResponse
      ? (this.detailOf(this.query.error() as HttpErrorResponse) ?? '')
      : '';
  }

  private async handleImage(
    blob: Blob,
    callback: (url: string, altText?: string) => void,
  ): Promise<void> {
    try {
      const upload = await downscaleImage(blob);
      const name = blob instanceof File ? blob.name : 'image';
      const { url } = await firstValueFrom(
        this.admin.uploadAboutImage(upload, name),
      );
      callback(url, name);
    } catch {
      this.toast.error('Image upload failed.');
    }
  }

  private detailOf(err: HttpErrorResponse): string | null {
    const body = err.error as { error?: unknown } | null;
    return typeof body?.error === 'string' ? body.error : null;
  }
}

/**
 * Downscales/re-encodes an image to cap dimensions and bytes before upload (max ~1600px
 * longest edge, webp). Falls back to the original blob on any failure or for non-images.
 */
async function downscaleImage(blob: Blob, maxEdge = 1600): Promise<Blob> {
  try {
    if (!blob.type.startsWith('image/')) return blob;
    const bitmap = await createImageBitmap(blob);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, maxEdge / longest);
    if (scale >= 1) {
      bitmap.close();
      return blob;
    }
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return blob;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.85),
    );
    return out ?? blob;
  } catch {
    return blob;
  }
}
