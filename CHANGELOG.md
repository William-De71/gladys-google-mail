# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - unreleased

### Added

- Gladys notifications by email: a send-only communication channel, each user enters the address that receives their notifications, sent from the connected Gmail account with a configurable subject (camera images attached).
- Connection with Google OAuth 2.0 and the user's own Google Cloud client (Client ID and Client secret, never shipped with the image): Connect button, PKCE, state kept in /data across a restart, tokens refreshed automatically, a revoked access reported without hammering Google.
- Three access levels mapped to the narrowest Gmail scopes: send and vacation responder only (`gmail.send`, `gmail.settings.basic`), plus reading the headers and labels (`gmail.metadata`), or plus reading and organizing (`gmail.modify`).
- Scene trigger "new mail received", filtered by sender address, label and inbox category, with sender, subject, snippet, labels and message ID as variables; read from the Gmail history every 2 minutes by default (1 to 60), resumed after a restart, mails sent by Gladys never trigger it.
- Scene actions: send a mail (to, cc, bcc, subject, plain text or simple HTML), turn the vacation responder on (subject, message, optional dates in the time zone of Gladys, contacts only) and off, read the unread mails of the inbox or a label, mark a mail as read, add a label, archive it.
- Dashboard widgets: unread mails of the inbox or a label (count, newest mails, link to Gmail, "Mark as read") and the vacation responder (state, dates, "Turn on" form, "Turn off"), Gladys 5.2.0 or later.
- Configuration actions: test the connection (account, granted permissions, quota used today), diagnostic (an anonymized summary in the logs), disconnect (the access is revoked at Google).
- English, French, German and Spanish everywhere: settings, widgets, scenes and documentation.
