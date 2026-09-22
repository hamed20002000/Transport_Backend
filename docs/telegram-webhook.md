# Telegram transport

Polling remains the default. The existing message and callback handlers are shared by both transports.

## Production webhook

Set these environment variables (keep the existing `TELEGRAM_BOT_TOKEN`):

```dotenv
TELEGRAM_BOT_MODE=webhook
TELEGRAM_WEBHOOK_URL=https://your-domain.com/telegram/webhook
TELEGRAM_WEBHOOK_SECRET=replace_with_a_random_secret
```

Generate a secret with `openssl rand -hex 32`. The secret must contain 1–256 letters, digits, underscores or hyphens.

Expose `POST /telegram/webhook` through your HTTPS reverse proxy to the Nest application (default port 3333). Preserve the JSON body and `X-Telegram-Bot-Api-Secret-Token` header. Set the URL to the complete public endpoint; include any public prefix added by your proxy. Do not put JWT or Basic authentication on this route. The Telegram secret authenticates requests.

Startup registers the webhook automatically, with one connection and message/callback updates. Invalid configuration or registration errors fail startup. Missing bot token keeps the bot disabled. Shutdown does not delete the remote webhook, allowing Telegram to retry during deployment.

The endpoint waits for the existing handler before returning HTTP 200; uncaught processing errors return a failure so Telegram can retry. Telegram delivery can repeat updates; there is no durable deduplication or queue in this implementation. Existing handlers that catch their own errors retain that behavior.

Run one application instance for now: purchase sessions are currently stored in process memory. Multiple replicas require shared session storage and coordination/idempotency for updates. Use a separate bot token for development so local polling cannot remove production's webhook.

## Return to polling

```dotenv
TELEGRAM_BOT_MODE=polling
```

Restart the application. It deletes the webhook without dropping pending updates, then starts polling after listeners are attached. Webhook requests are rejected in polling mode. Omitting the mode also selects polling.

No live webhook registration is performed by the test suite. Verify the public endpoint and Telegram delivery after deployment.
