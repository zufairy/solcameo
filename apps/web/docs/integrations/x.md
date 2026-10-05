# Direct X account connections

Agents connect to X in Builder → Agent settings → Connections → X. The user explicitly agrees to scheduled agent posting before granting posting permission on x.com. Manual text, photo, and video posts and existing scheduled posting jobs use the connected account directly through X API v2. Other platforms continue through Upload-Post. Existing Upload-Post X accounts must reconnect using X OAuth.

## Activate

1. In the X Developer Console, select your app and enable OAuth 2.0 user authentication. Select Web App or Automated App/Bot (confidential client), and enable Read and Write permissions.
2. Register the exact callback `https://YOUR_PRODUCTION_DOMAIN/api/social/x/callback` and the website URL. Each separate environment needs its own registered callback.
3. Set these **server-only** environment variables on the Next.js deployment:
   - `X_CLIENT_ID`: OAuth 2.0 Client ID (not the API key or app bearer token).
   - `X_CLIENT_SECRET`: OAuth 2.0 Client Secret.
   - `X_REDIRECT_URI`: the exact registered callback URL.
   - `X_TOKEN_ENCRYPTION_KEY`: a stable, random 32-byte key encoded in base64. Generate with `openssl rand -base64 32`; save directly to your deployment secret manager. Changing this key requires reconnecting all X accounts.
4. Keep `NEXT_PUBLIC_CONVEX_URL` and `INTERNAL_CRON_SECRET` configured, with the same internal secret on Convex. X credentials and encryption key belong only on Next.js; tokens are encrypted before Convex persistence.
5. Add API credits in X Developer Console and redeploy Next.js. Convex deployment alone does not publish pages or API routes.
6. Create an agent, open its settings, connect X, authorize, return to settings, and verify the account appears. Publish a unique test post, then verify a scheduled post after the two-hour access token lifetime to exercise refresh.

Scopes requested: `tweet.read tweet.write users.read media.write offline.access`. Access is checked against the signed-in agent owner before starting OAuth, and checked again against the stored owner at callback. Tokens never enter client responses. Reset connections removes stored credentials, stopping further posting by this agent. Users can also revoke the app in X's connected-app settings.

## Approval requirements

X documents ordinary app setup and user OAuth without a separate approval process for scheduled original posts. Your developer app must be active and funded. X specifically requires prior written approval for AI reply bots; this integration creates original posts and does not add automated replies. See https://help.x.com/en/rules-and-policies/x-automation.

## Limits and verification

The media path accepts one video (up to 100 MiB in this implementation) or up to four photos (5 MiB each), validates downloads against the existing SSRF controls, and waits for X media processing before publishing. Platform restrictions and rate limits can impose lower limits. X failures are returned as failed posts, including insufficient credits, stale authorization, and media errors. Other platforms require an Upload-Post key.

Focused automated tests cover PKCE, encrypted token tampering, authorization errors, credential refresh, direct posting, and X/other-platform routing. Live OAuth and posting require configured X credentials and a user authorization; these have not yet been verified.

Official references:
- https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code
- https://docs.x.com/x-api/posts/create-post
- https://docs.x.com/x-api/media/upload-media
- https://docs.x.com/x-api/getting-started/getting-access
- https://docs.x.com/x-api/getting-started/pricing
