/**
 * Seedance 2.5 text-to-video through the official Higgsfield SDK.
 *
 *   cd apps/web && node --env-file=.env.local --experimental-strip-types examples/higgsfield-seedance/index.ts
 *
 * Needs HF_CREDENTIALS="key-id:key-secret" (server-side only; .env.local is git-ignored).
 * This submits a real, billable generation request.
 */
import { config, higgsfield } from "@higgsfield/client/v2";

const credentials = process.env.HF_CREDENTIALS;
if (!credentials) {
  console.error("HF_CREDENTIALS is not set. Add it to apps/web/.env.local as key-id:key-secret.");
  process.exit(1);
}
config({ credentials });

try {
  const result = await higgsfield.subscribe("bytedance/seedance-2.5/text-to-video", {
    input: {
      prompt: "A cinematic scene at sunset",
      duration: 5,
      resolution: "720p",
      aspect_ratio: "16:9",
    },
    withPolling: true,
  });

  // The SDK types narrow `status`; the API can also report canceled and an error string.
  const status = result.status as string;
  const failure = (result as { error?: string }).error;
  switch (status) {
    case "completed": {
      const url = result.video?.url;
      if (!url) {
        console.error("Request completed but returned no video URL.");
        process.exit(1);
      }
      console.log(`Video URL: ${url}`);
      break;
    }
    case "nsfw":
      console.error("Request was rejected by content moderation (nsfw). No video was produced.");
      process.exit(1);
    case "canceled":
      console.error("Request was canceled. No video was produced.");
      process.exit(1);
    case "failed":
      console.error(`Request failed${failure ? `: ${failure}` : ""}. No video was produced.`);
      process.exit(1);
    default:
      console.error(`Request ended in unexpected state "${status}".`);
      process.exit(1);
  }
} catch (err) {
  console.error(`Higgsfield request error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
