/** Vite raw-text imports (e.g. `import schema from './schema.sql?raw'`). */
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
