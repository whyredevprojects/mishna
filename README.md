# Mishna

App for organizing groups to collectively memorize the entire Mishna by Rosh
Chodesh Sivan. See [`CLAUDE.md`](./CLAUDE.md) for the project overview and
[`apps/*/CLAUDE.md`](./apps) for per-app details.

## Local Development

### Topology

One command boots the whole stack. The Angular client makes only relative
`/api/*` calls, proxied to the server worker; the server reaches the login worker
internally through a Cloudflare **service binding** (`AUTH`), so you never hit
login directly.

| App | Port | Notes |
|-----|------|-------|
| `apps/client` (Angular) | **4200** | `proxy.conf.json` forwards `/api` → `:8787`. |
| `apps/server` (Hono API) | **8787** | The single API surface the client talks to. |
| `apps/login` (better-auth) | **8788** | Reached via the `AUTH` service binding, not directly. |

> There are intentionally **no Angular `environment.ts` files** — the dev proxy +
> relative URLs behave the same in production (same-origin API).

### Prerequisites

- Node.js + npm (this repo uses npm; see `package-lock.json`).
- `npm install`

### One-time setup

1. **Login secret.** `wrangler dev` reads `.dev.vars` (not `.env`). Create one:

   ```sh
   cp apps/login/.dev.vars.example apps/login/.dev.vars
   # then edit apps/login/.dev.vars and set a BETTER_AUTH_SECRET
   ```

   `.dev.vars` is gitignored. For production set the secret with
   `wrangler secret put BETTER_AUTH_SECRET` (see `apps/login/CLAUDE.md`).

2. **Local databases.** Apply both D1 schemas to local wrangler state:

   ```sh
   npm run db:init:local
   ```

   This seeds the `mishna-auth` (login) and `mishna-app` (server) databases under
   each app's `.wrangler/` state. Re-run it any time you wipe `.wrangler`.

### Run everything

```sh
npm run dev          # alias for: npx nx serve client
```

This starts the login worker (`:8788`), the server worker (`:8787`), and the
Angular dev server, then open **http://localhost:4200**. Nx starts the two worker
`serve` targets first (they're declared as `dependsOn` of `client:serve`), and
wrangler's dev registry wires the `AUTH` service binding across the processes.

To run a single piece on its own: `npx nx serve server`, `npx nx serve login`, or
`npx nx serve client` (the client always pulls in the two workers).

### Email (in `apps/server`)

Email lives inside the server worker — there's no separate worker to start. An hourly
cron triggers the `ReminderWorkflow` (a Cloudflare Workflow), which decides who is due an
email right now (08:00 in each user's timezone) and sends the weekly/reminder emails via
Resend in batches. Admin "send now" sends one email inline from the request handler.

To exercise it locally (after `npm run db:init:local`):

- **Cron → Workflow (bulk):** run the server with `npx nx serve server` and trigger the
  scheduled handler, e.g. `curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"`. It
  creates a workflow instance; inspect it with
  `npx wrangler workflows instances list mishna-reminders` /
  `... instances describe mishna-reminders <id>`.
- **Admin "send now":** the admin button hits the server, which builds and sends the one
  email inline and returns the real success/error to the UI.

A real send needs `RESEND_API_KEY` as a secret (`wrangler secret put RESEND_API_KEY` for
deploys) or in `apps/server/.dev.vars` locally (gitignored). Without it the Resend client
throws and the send surfaces as a `502` (admin send-now) or a retried workflow step.

### Notes

- **Auth providers:** only email + password is enabled in `apps/login/src/auth.ts`.
  The landing page's "sign in" button currently calls Google OAuth, which needs a
  `socialProviders.google` block plus credentials before it works end-to-end.

---

<a alt="Nx logo" href="https://nx.dev" target="_blank" rel="noreferrer"><img src="https://raw.githubusercontent.com/nrwl/nx/master/images/nx-logo.png" width="45"></a>

✨ Your new, shiny [Nx workspace](https://nx.dev) is ready ✨.

[Learn more about this workspace setup and its capabilities](https://nx.dev/getting-started/intro#learn-nx?utm_source=nx_project&amp;utm_medium=readme&amp;utm_campaign=nx_projects) or run `npx nx graph` to visually explore what was created. Now, let's get you up to speed!

## Run tasks

To run tasks with Nx use:

```sh
npx nx <target> <project-name>
```

For example:

```sh
npx nx build myproject
```

These targets are either [inferred automatically](https://nx.dev/concepts/inferred-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) or defined in the `project.json` or `package.json` files.

[More about running tasks in the docs &raquo;](https://nx.dev/features/run-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Add new projects

While you could add new projects to your workspace manually, you might want to leverage [Nx plugins](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) and their [code generation](https://nx.dev/features/generate-code?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) feature.

To install a new plugin you can use the `nx add` command. Here's an example of adding the React plugin:
```sh
npx nx add @nx/react
```

Use the plugin's generator to create new projects. For example, to create a new React app or library:

```sh
# Generate an app
npx nx g @nx/react:app demo

# Generate a library
npx nx g @nx/react:lib some-lib
```

You can use `npx nx list` to get a list of installed plugins. Then, run `npx nx list <plugin-name>` to learn about more specific capabilities of a particular plugin. Alternatively, [install Nx Console](https://nx.dev/getting-started/editor-setup?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) to browse plugins and generators in your IDE.

[Learn more about Nx plugins &raquo;](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) | [Browse the plugin registry &raquo;](https://nx.dev/plugin-registry?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Set up CI!

### Step 1

To connect to Nx Cloud, run the following command:

```sh
npx nx connect
```

Connecting to Nx Cloud ensures a [fast and scalable CI](https://nx.dev/ci/intro/why-nx-cloud?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) pipeline. It includes features such as:

- [Remote caching](https://nx.dev/ci/features/remote-cache?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Task distribution across multiple machines](https://nx.dev/ci/features/distribute-task-execution?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Automated e2e test splitting](https://nx.dev/ci/features/split-e2e-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Task flakiness detection and rerunning](https://nx.dev/ci/features/flaky-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

### Step 2

Use the following command to configure a CI workflow for your workspace:

```sh
npx nx g ci-workflow
```

[Learn more about Nx on CI](https://nx.dev/ci/intro/ci-with-nx#ready-get-started-with-your-provider?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Install Nx Console

Nx Console is an editor extension that enriches your developer experience. It lets you run tasks, generate code, and improves code autocompletion in your IDE. It is available for VSCode and IntelliJ.

[Install Nx Console &raquo;](https://nx.dev/getting-started/editor-setup?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Useful links

Learn more:

- [Learn more about this workspace setup](https://nx.dev/getting-started/intro#learn-nx?utm_source=nx_project&amp;utm_medium=readme&amp;utm_campaign=nx_projects)
- [Learn about Nx on CI](https://nx.dev/ci/intro/ci-with-nx?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Releasing Packages with Nx release](https://nx.dev/features/manage-releases?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [What are Nx plugins?](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

And join the Nx community:
- [Discord](https://go.nx.dev/community)
- [Follow us on X](https://twitter.com/nxdevtools) or [LinkedIn](https://www.linkedin.com/company/nrwl)
- [Our Youtube channel](https://www.youtube.com/@nxdevtools)
- [Our blog](https://nx.dev/blog?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
