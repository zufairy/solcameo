# Character reference editing verification

Verified on 2026-10-05 against the configured local credentials, using the project's public sample portrait rather than a user's upload.

- Higgsfield Qwen Image 3 edit accepted two real requests, then failed with `This model is temporarily unavailable`. Both the app's no-enhancement payload and the documented default payload produced the same result. This is an upstream availability issue, not a rejected credential or inaccessible reference.
- Kie's `qwen/image-edit` returned code 402, insufficient credits. No image job was created.
- Higgsfield Marketing Studio completed an actual edit: only hair color changed to burgundy while the face, glasses, striped shirt and white background remained. The completed image was mirrored through the same R2 helper used by the status API and was publicly reachable.

After the user rejected Marketing Studio's cost, the builder now uses Qwen exclusively: `alibaba/qwen-image-3/text-to-image` without an uploaded reference and `alibaba/qwen-image-3/edit` with a reference. Marketing Studio is removed from the flow. A fresh real text-to-image request also failed with the same temporary-unavailability message. No alternative is automatically submitted. Credentials remain server-side; reference ownership and signed job tickets remain enforced.

Provider failures now appear in both the failed gallery tile and the builder error area instead of the generic `Generation failed` message. A failed edit retains the current reference and selected traits.

Completed portraits reload from the authenticated owner's R2 `gen/` folder, including legacy images without a history index. New accepted jobs are recorded under that owner's `jobs/` folder, so refresh recovery can poll unfinished requests and mirror completed results. Results use deterministic keys and a stored result index to avoid generating duplicate stored images on every status poll. Both draft and minted-character status requests now require a signed owner/job ticket. Seven legacy generated portraits were found across three owner scopes; recovery shows only the authenticated owner's files.

Sources: [Higgsfield Qwen edit](https://docs.higgsfield.ai/docs/models/qwen-image-3/edit), [Higgsfield Marketing Studio edit](https://docs.higgsfield.ai/docs/models/marketing-studio-image/generate-and-edit), [Kie Qwen edit](https://docs.kie.ai/market/qwen/image-edit).

The authenticated browser upload/generate flow was not exercised during this check because the in-app browser was signed out. Provider submission, completion, output preservation and R2 mirroring were exercised with real API calls; route regression tests cover the requested model and reference ownership checks.
