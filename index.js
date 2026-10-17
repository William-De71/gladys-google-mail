// -----------------------------------------------------------------------------
// Entry point of the Google Mail (Gmail) external integration.
//
// Brings a Gmail account into Gladys, through the official Gmail API:
//   - communication channel (send-only): the Gladys notifications of each
//     user are sent by mail to the address they entered in "My account";
//   - scene trigger: new mail received, filtered by sender, label, category
//     (src/events.js);
//   - scene actions: send a mail, turn the vacation responder on / off, read
//     the unread mails, mark as read / label / archive a mail;
//   - dashboard widgets: unread mails, vacation responder (src/widgets.js).
//
// Sign-in: OAuth 2.0 with the user's own Google Cloud client (src/auth.js).
// Data: the mailbox history, read every few minutes (src/mailbox.js); the
// tokens and the history cursor are kept in /data (src/store.js).
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
//   TZ (the time zone of Gladys: dates of the vacation responder follow it)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys);

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the Google Mail integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
