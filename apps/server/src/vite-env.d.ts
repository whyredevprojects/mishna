/** Vite raw-text imports (e.g. migration SQL via `import.meta.glob(..., '?raw')`). */
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
