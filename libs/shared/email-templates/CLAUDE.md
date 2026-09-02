# @mishna/email-templates

The **presentation** half of the email seam: React Email components rendered to
email-safe HTML + a `text/plain` alternative, and `composeEmail`, which turns one
`PreparedEmail` (from `@mishna/email-domain`) into the `OutgoingEmail` the transport
sends. No storage, no network, no clock — rendering is a pure function of the job, its
resolved Hebrew text, and the sender options.

Depends on `@mishna/email-domain` (for `PreparedEmail` / `ResolvedMishna` /
`OutgoingEmail` / `unsubscribeHeaders`), `react` and `@react-email/*`. It does **not**
depend on `@mishna/domain` or on any Cloudflare binding.

## Public surface (`src/index.ts`)

| Export | What it is |
|--------|------------|
| `weeklyEmail(items, appOrigin, unsubscribeUrl?)` | Renders the weekly quota email to `BuiltEmail` (`{ subject, html, text }`). |
| `reminderEmail(pending, appOrigin, unsubscribeUrl?)` | Same, for the reminder (only the still-unlearned mishnayot). |
| `composeEmail(job, resolved, opts)` | One `PreparedEmail` + its resolved text → `OutgoingEmail`: picks the template from `job.kind`, fills from/replyTo/to, and stamps the three RFC 8058 headers via `unsubscribeHeaders`. |
| `BuiltEmail`, `ComposeOptions` | The two shapes above. |
| `WeeklyEmail`, `ReminderEmail`, `EmailShell`, `MishnaList`, `WEEKLY_TITLE`, `REMINDER_TITLE`, `styles` | The components and theme, for previews and for tests that render one in isolation. |

## Layout (`src/lib/`)

| File | Role |
|------|------|
| `render.tsx` | `weeklyEmail` / `reminderEmail` + the shared `build()` (HTML **and** text in one render). |
| `compose.ts` | `composeEmail` — the job → wire-shape step. |
| `weekly-email.tsx`, `reminder-email.tsx` | One component per email, each with an explicit **empty state**. |
| `components/email-shell.tsx` | Shared chrome: heading, CTA, and the unsubscribe footer. |
| `components/mishna-list.tsx` | The mishnayot grouped by tractate; each Hebrew body is `dir="rtl"`. |
| `styles.ts` | The inline-style theme (email clients strip `<style>`/external CSS). |
| `preview/` | Dev-only entries for `npm run email:dev` — one per email **state**, plus a `.ts` sample-data file the CLI ignores (it only lists `.tsx`/`.jsx` with a default export). |

The preview states, and why each one earns its file: `weekly` (two tractates, so the
grouping headings show), `weekly-single-tractate` (**one** heading — what most real
weeklies look like at a pace of 1-3), `weekly-empty` and `reminder-empty` (reachable
in production: admin send-now passes `skipWhenEmpty: false`), `weekly-large` (~40
mishnayot — the returning user's next unlearned bucket, and the size at which Gmail's
~102 KB clipping would hide the footer's unsubscribe link behind "View entire
message"), `weekly-no-unsubscribe` (the control: a footer that lost its link still
looks like a perfectly normal footer, and the fallout shows up in deliverability data
weeks later), `reminder`.

For "what would *this real user* receive", the templates preview isn't enough — it has
no D1, no user and no `AssignmentSource`. Use `apps/server`'s `/__dev/email` workbench
(`npm run dev:email`); see "Testing email locally" in `apps/server/CLAUDE.md`.

## Key conventions

- **Both parts, every time.** `BuiltEmail.text` is required, and it is `toPlainText`
  over the **exact HTML being sent** — not a second `render(el, { plainText: true })`.
  One render instead of two inside a 100-email Workflow step, and the two parts cannot
  drift apart. Two `toPlainText` behaviors the output leans on: react-email skips the
  `<Preview>` preheader (its 150-char zero-width-space padding never reaches the text
  part) and `wordwrap: false` is hard-set, which is what keeps the long base64url
  unsubscribe URL on one unbroken, clickable line.
- **Pure — no clock, no randomness.** Load-bearing: `batchIdempotencyKey` covers only
  (user, kind, week), and Resend answers a reused key carrying a *different* payload
  with `409 invalid_idempotent_request`, which fails the retried `step.do` and takes
  the rest of that hour's batches with it.
- **The unsubscribe footer is its own paragraph**, not `"Chevras Mishnayos Baal Peh ·
  Unsubscribe"` on one line. html-to-text renders an anchor as `text href`, so a
  one-line footer buries the URL mid-sentence instead of putting it on a line of its
  own (`Unsubscribe https://…`). Don't collapse the two `<Text>`s back together.
- **English chrome, Hebrew content.** Only the mishna text is RTL.
- **The empty state is reachable and deliberate.** Admin "send now" does not skip a
  user who has finished their portion (`prepareSingle({ skipWhenEmpty: false })`), so
  both templates must read as a real message with zero items.

## JSX configuration (do not "simplify")

`jsx: "react-jsx"` + `jsxImportSource: "react"` appear in **both** `tsconfig.json` and
`tsconfig.lib.json`. esbuild — which is what bundles this lib when `apps/server` pulls
it in through the `tsconfig.base.json` path alias — resolves a tsconfig **per source
file**, walking up from the file itself, so it reads *this project's* `tsconfig.json`,
not the app's. Without the automatic runtime here it falls back to the classic
`React.createElement` transform and the deployed worker throws "React is not defined"
at render time. The guard is:

```sh
cd apps/server && npx wrangler deploy --dry-run --outdir /tmp/x
grep -c 'React.createElement' /tmp/x/index.js   # must print 0
```

`react` is pinned to **18.3.1** (see `apps/server/wrangler.toml`'s header note). A
nested react 19 breaks rendering with "Objects are not valid as a React child".

## Testing

`nx test email-templates` — plain **node** vitest, sub-second. Deliberately **no**
`react-dom/server.edge` alias: that alias exists in `apps/server`'s config only because
`@react-email/render`'s `workerd` export condition imports a react-dom subpath react
18/19 doesn't ship. Under node the package resolves its `node` condition and uses
`renderToPipeableStream`.

That difference is why these tests assert **semantics** (the subject, the counts, every
`Perek N, Mishna M` label, the Hebrew body verbatim, one tractate heading per tractate,
`dir="rtl"`, the footer's presence/absence, the text part's invariants, escaping) and
not full-HTML snapshots — which would break on every react-email bump while still not
catching a missing mishna. The byte-level guarantees that only hold in the deployed
runtime (a byte-identical re-render, the headers as wired) stay in `apps/server`'s
`email/email.integration.test.ts`, which runs in workerd. Keep both.

One gotcha when writing assertions: React separates adjacent text nodes with `<!-- -->`
comments, so `Perek {n}, Mishna {m}` never appears contiguously in the **HTML**. Assert
copy against `built.text`; assert structure (headings, `dir`, hrefs) against `.html`.

## The top CTA ("Click here when you've memorized this.")

`EmailShell` takes an optional `memorizedUrl` and renders it as a prominent button
**immediately after the heading, above `children`**. Three rules:

- **Top, not bottom.** Gmail clips messages over ~102 KB and a long weekly can reach
  that, so anything below the mishna list may not be in what the reader sees. The
  `render.spec.tsx` case asserting the CTA's index is before the first tractate name is
  what keeps a refactor from quietly moving it.
- **Its own paragraph.** `toPlainText` renders an anchor as `text href`, so sharing a
  line with the intro would bury the URL mid-sentence in the `text/plain` part — the
  same reasoning as the unsubscribe footer's two `<Text>`s. Don't collapse it.
- **Never on the empty state.** "Click here when you've memorized this" over an empty
  list is nonsense, so `WeeklyEmail`/`ReminderEmail` forward the URL only when their
  list is non-empty. The shell just renders what it's handed.

`weeklyEmail`/`reminderEmail` take an options object (`RenderOptions`) rather than
positional optionals — three optional trailing args is where that stopped being
readable. `ComposeOptions.memorizedUrl` is **required**, so a caller that forgets it is
a compile error rather than an email silently shipping without the one action it asks
for.
