/**
 * Minimal ambient types for `@toast-ui/editor`.
 *
 * The package ships full types under `types/`, but its `exports` map has no `types`
 * condition, so TypeScript under `moduleResolution: bundler` can't discover them
 * (esbuild still resolves the runtime via the `import` condition). We only use a small
 * slice of the editor API, declared here. Keep in sync with `admin-about.component.ts`.
 */
declare module '@toast-ui/editor' {
  export type EditType = 'markdown' | 'wysiwyg';
  export type PreviewStyle = 'tab' | 'vertical';
  export type HookCallback = (url: string, altText?: string) => void;

  export interface EditorOptions {
    el: HTMLElement;
    height?: string;
    initialEditType?: EditType;
    previewStyle?: PreviewStyle;
    initialValue?: string;
    usageStatistics?: boolean;
    hooks?: {
      addImageBlobHook?: (blob: Blob | File, callback: HookCallback) => void;
    };
  }

  export default class Editor {
    constructor(options: EditorOptions);
    getMarkdown(): string;
    setMarkdown(markdown: string, cursorToEnd?: boolean): void;
    destroy(): void;
  }
}

declare module '@toast-ui/editor/dist/toastui-editor.css';
