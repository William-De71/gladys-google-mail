# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for **Google Mail (Gmail)**: a
Node.js service (Node 22+, ESM, no build step) in its own sandboxed Docker
container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and to Google through the official Gmail API v1 and OAuth 2.0 (the user's own
Google Cloud client). Manifest type `communication`, send-only
(`messaging.receive: false`, `contact_schema` = the user's email address), plus
a scene trigger, scene actions and widgets. Only dependency: the SDK (`fetch`
is native). Transport: cloud only.

## Commands

```bash
npm install
npm test                                  # node --test, never touches the network
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store . --skip-image-check
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js          SDK wiring only (new GladysIntegration + createApp)
src/app.js        every handler, registered before connect(): OAuth, start, polling
                  timer, notifications (onSendMessage), scene events, widgets,
                  scene and config actions
src/auth.js       Google OAuth 2.0 (scopes per access level, PKCE, code exchange,
                  single-flight refresh, final stop on invalid_grant, revoke)
src/gmail-api.js  Gmail API v1 client (profile, labels, history, messages, send,
                  modify, vacation; quota units counted)
src/mailbox.js    history reading (baseline, cursor in /data, 404 = new baseline),
                  received-mail filter, quiet ids of the mails Gladys sent, unread
src/mime.js       RFC 2822 / MIME message for messages.send, header parsing
src/vacation.js   vacation responder settings, dates typed by users (TZ aware)
src/store.js      /data/state.json: tokens, pending OAuth state, history cursor
src/events.js     scene trigger keys and event data
src/widgets.js    `unread` and `vacation` widgets (pure builders)
src/config.js / i18n.js   configuration, runtime texts (en / fr / de / es)
```

## Google facts (from the documentation, to re-check when in doubt)

- OAuth: `https://accounts.google.com/o/oauth2/v2/auth`, `access_type=offline`,
  `prompt=consent`, PKCE S256; token `https://oauth2.googleapis.com/token`; the
  refresh answer carries no new refresh token; granular consent can drop scopes
  (the granted `scope` string is stored and decides the capabilities).
- Scopes (narrowest per access level): `gmail.send` + `gmail.settings.basic`
  (sensitive); + `gmail.metadata` or `gmail.modify` (restricted). Never both
  metadata and modify: with metadata, Gmail refuses `q` and (per the scope
  description, unverified) gives no body content such as the snippet.
- Refresh tokens die after 7 days for an External app left in **Testing**;
  `invalid_grant` is final: never retry it.
- Redirect URI: the one Gladys sends (`https://my.gladysassistant.com/redirect/oauth`).
- Gmail: push only through Cloud Pub/Sub (out of reach): poll `history.list`
  (2 units, `historyTypes=messageAdded`); a 404 = cursor too old -> new baseline.
  Units: messages.get 20, send 100, labels.get 1, getVacation 1, updateVacation 5;
  6,000 units per minute per user. `updateVacation` is a PUT (full settings).

## Rules

- **Keys are forever**: config, contact, action, widget, widget action, scene
  trigger (fields, options, variables) and action (fields, outputs) keys.
  `test/structure.test.js` compares them to `test/fixtures/keys.baseline.json`
  (0.1.0): never update the baseline without a documented migration.
- **Polling by an internal timer** (`poll_minutes`); every Gmail operation goes
  through `exclusive()` (one at a time, the cursor is shared).
- **Scene events**: one per new mail; the first reading (and a 404) is a
  baseline. A scene action, a widget action or a notification never fires an
  event (`mailbox.quiet()` for the mails Gladys sends).
- **Secrets and privacy**: never log a token, the Client secret, the Client ID,
  an address, a subject or a snippet. Gladys passes no DEBUG variable to the
  container: the **Diagnostic** action writes an anonymized summary instead.
- **Time**: vacation dates typed by users use the `TZ` the supervisor injects.
- **The container rootfs is read-only**: only `/data/state.json` is written
  (store.js, atomic, 0600). `GLADYS_DATA_DIR` overrides `/data` in development.
- **Four languages** everywhere (manifest, `src/i18n.js`, docs, README);
  `test/i18n.test.js` checks it.
- **Widget images**: after any change to a widget content, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
- **Changelog**: Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style**: Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
