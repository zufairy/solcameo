# YouTube downloads without paying the residential proxy

Applies to every yt-dlp pull in `apps/web/lib/server/downloader.ts` (Editor Videos panel, clip jobs, clipper samples, launch funnel clips).

## How it works now

Attempt order per download (`planYtdlpAttempts`):

1. **Direct** from the Railway box. Free. Passes when the request carries proof it came from a real browser session:
   - a **PO token** minted per request by the bgutil provider that boots next to the app (`scripts/start.sh`, port 4416), and
   - **cookies** from a signed-in Google account (`YTDLP_COOKIES`), and
   - yt-dlp's n-challenge solved in Node (`YTDLP_JS_RUNTIME=node`).
2. **Residential proxy** (`YTDLP_PROXY`), fresh session, only if the direct pull was bot-walled or 403'd. Two tries.
3. A video that needed the proxy is remembered for 24h so its retries skip the direct try.

`YTDLP_DIRECT_FIRST=0` restores proxy-on-every-attempt.

## One manual step: cookies

The provider alone gets most videos through. Cookies push the direct success rate up further and unlock age/consent-gated videos.

1. Create a throwaway Google account. Never use a personal one; YouTube can flag the account.
2. In a desktop Chrome or Firefox profile signed into that account, open youtube.com once.
3. Install a "Get cookies.txt LOCALLY" style extension and export cookies for `youtube.com` in Netscape format.
4. Base64 the file so it survives Railway's env editor:
   ```
   base64 -i cookies.txt | tr -d '\n' | pbcopy
   ```
5. Railway → vello service → Variables → `YTDLP_COOKIES` = paste. Redeploy.
6. Confirm at `https://velloagents.com/api/health/config`: `YTDLP_COOKIES: true`, `YTDLP_POT_PROVIDER: true`.

Cookies expire or get invalidated after a few weeks. The health endpoint warns when they're missing. Re-export and replace when direct pulls start falling back to the proxy again (look for `[downloader] direct pull ok` vs `attempt 1/3 (direct …) failed` in Railway logs).

## Verifying after a deploy

- Railway deploy log shows `[start] bgutil POT provider ready`.
- `/api/health/config` → `YTDLP_POT_PROVIDER: true`.
- Paste a YouTube link in the Editor. Railway log for that pull should read `direct pull ok (no proxy) for yt:<id> · POT · cookies`.

## If the provider breaks

YouTube rotates BotGuard; the provider is pinned to `master` at image build time (`BGUTIL_REF` build arg). Rebuilding the image picks up fixes. Until then the proxy fallback keeps downloads working, at cost.
