# email-templates

The emails themselves: React Email components rendered to email-safe HTML plus a
`text/plain` alternative, and `composeEmail`, which turns one `PreparedEmail` into the
`OutgoingEmail` the transport sends.

## Building

Run `nx build email-templates` to build the library.

## Running unit tests

Run `nx test email-templates` to execute the unit tests via [Vitest](https://vitest.dev/).

## Previewing

From the repo root:

```sh
npm run email:dev
```

serves the dev-only entries in `src/lib/preview/` (one per email state, with sample
mishnayot) at http://localhost:3030. The react-email CLI only lists `.tsx`/`.jsx` files
with a default export, so the `.ts` sample-data file is ignored.
