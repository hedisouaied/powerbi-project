---
name: mail-relay
description: Use when working on the Send by email button, the local mail service in visuals/mailRelay, the HTML email template, or a "Mail not sent" problem.
---

# Send by email

## Hard rules

- `visuals/mailRelay/.env` holds the SMTP password. **Never read it into chat, copy it or share it.**
- Test with a dry run, or with the `test-visual` page, which stubs the service. Don't send a real email unless the user asks for one.

## How it works

1. The button in Mauve Sales Page (`WebAccess` privilege, `http://127.0.0.1:8787`) calls `visuals/mailRelay/server.js`, a local Node service (nodemailer).
2. The service must be running on the same PC: `start-mail-service.cmd`. If `.env` has no password, its window asks for one and saves it.
3. A visual can't speak SMTP, and a password in it would ship with the report. So the password and recipient live only in the service's `.env`. The visual holds just a token (`src/mailConfig.ts`), which must match `RELAY_TOKEN`.
4. Outcomes show in a dialog (`alertDialog`: "Mail sent" / "Mail not sent"), not the toast, which can be off screen on this tall page.

The button only works on a PC running the service, so it won't work for someone who just receives the `.pbix`.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /health` | Returns `ok`, `configured` and the recipient `to` |
| `POST /send` | Takes `subject`, `html`, `text`, `images`, with the `X-Relay-Token` header |

## Dry run

Set the environment variable `MAIL_MAILER=log` when starting the service. Real environment variables win over `.env`. It writes `sent-log/last-email.eml` (or to `MAIL_LOG_DIR`) and sends nothing.

## Email template

`visuals/mauveSalesPage/src/emailTemplate.ts` rebuilds the page with tables and inline styles:
- Mail clients drop flexbox, grid, conic gradients, SVG and scripts, so the email has no icons, sparklines or animation.
- The donut is a canvas PNG (`donutPng` in `src/visual.ts`) sent as an inline `cid:` image. Its background must match `CARD` in the template.
- Values are escaped before insertion.

After changing the template, build with the `build-visual` skill and check `window.lastEmail` with the `test-visual` skill.

## If the mail doesn't arrive

- A message sent to the same Gmail account can land in Sent or All Mail rather than the inbox. Check those and Spam.
- "Mail not sent" with no connection means the service isn't running.
- If web access is blocked, the Power BI admin has turned off web access for custom visuals.
