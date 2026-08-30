// The `/__dev/email` workbench page: one dependency-free HTML document, no build
// step, no framework, no npm package. Served inline by `dev-routes.ts` because this
// worker has no static-asset pipeline (`wrangler.toml` has no `[assets]`) and adding
// one for a dev tool would be more machinery than the tool.
//
// It is a thin client over the four `/__dev/email/*` routes — it contains no email
// logic of its own, deliberately.

/** The default "send to" address: Resend's sandbox sink. */
const SANDBOX_TO = 'delivered@resend.dev';

export const DEV_EMAIL_PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Email workbench (dev)</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 system-ui, sans-serif; margin: 0; display: grid;
         grid-template-columns: 340px 1fr; height: 100vh; }
  aside { padding: 1rem; overflow: auto; border-right: 1px solid #8884; }
  main { display: grid; grid-template-rows: 1fr auto; min-width: 0; }
  iframe { border: 0; width: 100%; height: 100%; background: #fff; }
  pre { margin: 0; padding: .75rem; max-height: 40vh; overflow: auto;
        background: #8881; font-size: 12px; white-space: pre-wrap; }
  h1 { font-size: 1rem; margin: 0 0 .75rem; }
  label { display: block; margin: .6rem 0 .15rem; font-weight: 600; font-size: 12px; }
  input, select, button { width: 100%; box-sizing: border-box; padding: .4rem; font: inherit; }
  button { margin-top: .5rem; cursor: pointer; }
  .row { display: flex; gap: .4rem; }
  .row button { margin-top: 0; }
  .danger { border: 1px solid #c33; border-radius: 6px; padding: .5rem; margin-top: 1rem; }
  .danger h2 { font-size: 12px; margin: 0 0 .25rem; color: #c33; }
  .hint { font-size: 11px; opacity: .7; margin: .25rem 0 0; }
  fieldset { border: 0; padding: 0; margin: .5rem 0 0; }
</style>
</head>
<body>
<aside>
  <h1>Email workbench <small style="opacity:.6">dev only</small></h1>

  <label for="user">User</label>
  <select id="user"></select>
  <p class="hint" id="userHint"></p>

  <fieldset>
    <label>Kind</label>
    <label style="font-weight:400"><input type="radio" name="kind" value="weekly" checked style="width:auto"> weekly</label>
    <label style="font-weight:400"><input type="radio" name="kind" value="reminder" style="width:auto"> reminder</label>
  </fieldset>

  <label for="weekStart">weekStart (optional, YYYY-MM-DD)</label>
  <input id="weekStart" placeholder="from the user's prefs">

  <label for="at">at (optional ISO instant, for plan/cron)</label>
  <input id="at" placeholder="now">

  <label for="textOrigin">textOrigin (optional)</label>
  <input id="textOrigin" placeholder="APP_ORIGIN">
  <p class="hint">Where mishna-text's tractate JSON is fetched from. Leave blank to
  use APP_ORIGIN. Set it to https://app.mishna2go.com to borrow production's text
  while the links stay local.</p>

  <div class="row">
    <button id="preview">Preview</button>
    <button id="src">Source</button>
    <button id="text">Text part</button>
  </div>
  <button id="json">Show OutgoingEmail JSON (headers)</button>

  <div class="row" style="margin-top:1rem">
    <button id="plan">Plan (dry run)</button>
    <button id="cron">Run cron</button>
  </div>
  <p class="hint">Plan answers "who would get mail at <em>at</em>?" and sends nothing.
  Cron creates a real ReminderWorkflow instance — it <strong>does</strong> send.</p>

  <div class="danger">
    <h2>Send a real email</h2>
    <label for="to">To</label>
    <input id="to" value="${SANDBOX_TO}">
    <p class="hint">Resend sandbox sinks: delivered@resend.dev, bounced@resend.dev,
    complained@resend.dev — they exercise the API without touching a mailbox.</p>
    <button id="send">Send</button>
  </div>
</aside>
<main>
  <iframe id="frame" title="preview"></iframe>
  <pre id="out">Pick a user, then Preview.</pre>
</main>
<script>
const $ = (id) => document.getElementById(id);
const out = (v) => { $('out').textContent = typeof v === 'string' ? v : JSON.stringify(v, null, 2); };
const kind = () => document.querySelector('input[name=kind]:checked').value;

function params(extra) {
  const p = new URLSearchParams({ userId: $('user').value, kind: kind(), ...extra });
  for (const k of ['weekStart', 'at', 'textOrigin']) if ($(k).value) p.set(k, $(k).value);
  return p;
}

async function show(extra) {
  const url = '/__dev/email/render?' + params(extra);
  out('GET ' + url);
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) { out(body); return; }
  if (extra.part === 'html' || !extra.part) $('frame').srcdoc = body;
  else out(body);
}

$('preview').onclick = () => show({});
$('src').onclick = () => show({ raw: '1' });
$('text').onclick = () => show({ part: 'text' });
$('json').onclick = () => show({ part: 'json' });

$('plan').onclick = async () => {
  const p = new URLSearchParams();
  if ($('at').value) p.set('at', $('at').value);
  out('running…');
  out(await (await fetch('/__dev/email/plan?' + p)).json());
};

$('cron').onclick = async () => {
  if (!confirm('This creates a real ReminderWorkflow instance and REALLY SENDS to everyone due. Continue?')) return;
  const p = new URLSearchParams();
  if ($('at').value) p.set('at', $('at').value);
  out('running the workflow…');
  out(await (await fetch('/__dev/email/cron?' + p)).json());
};

$('send').onclick = async () => {
  const to = $('to').value;
  if (!/@resend\\.dev$/.test(to) && !confirm('"' + to + '" is a REAL mailbox, not a Resend sandbox address. Send anyway?')) return;
  out('sending…');
  const res = await fetch('/__dev/email/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      userId: $('user').value, kind: kind(), to,
      weekStart: $('weekStart').value || undefined,
      textOrigin: $('textOrigin').value || undefined,
    }),
  });
  out(await res.json());
};

(async () => {
  try {
    const { users } = await (await fetch('/__dev/email/users')).json();
    if (!users.length) { out('No users in the local mishna-auth DB. See "Testing email locally" in apps/server/CLAUDE.md.'); return; }
    $('user').innerHTML = users.map((u) =>
      '<option value="' + u.id + '">' + (u.email || '(no email)') +
      (u.emailVerified ? '' : ' [UNVERIFIED]') +
      (u.commitment ? '' : ' [not joined]') + '</option>').join('');
    const byId = Object.fromEntries(users.map((u) => [u.id, u]));
    const hint = () => { const u = byId[$('user').value];
      $('userHint').textContent = u ? u.id + ' · tz ' + (u.timezone || 'default') +
        ' · weekly ' + (u.weeklyEnabled ? 'on' : 'off') +
        ' · reminder ' + (u.reminderEnabled ? 'on' : 'off') : ''; };
    $('user').onchange = hint; hint();
  } catch (e) { out('Failed to load users: ' + e); }
})();
</script>
</body>
</html>`;
