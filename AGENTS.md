# Etsy API Hub — agent instructions

This repository is the shared Etsy integration layer for server-side agents and internal projects.

## Golden rule

Do not search for Etsy tokens and do not hand-write one-off authenticated curl/Python requests if `etsyctl` can do the job.

Use:

    etsyctl shops
    etsyctl listing get <listing_id>
    etsyctl listing update <listing_id> @changes.json
    etsyctl personalization get <listing_id>
    etsyctl personalization set <listing_id> @questions.json
    etsyctl inventory get <listing_id>
    etsyctl orders list --limit 25
    etsyctl images upload <listing_id> ./image.jpg

For an Etsy endpoint that has no friendly wrapper, use the full-access path interface:

    etsyctl request GET /application/...
    etsyctl request POST /application/... --body @payload.json

The raw interface intentionally supports the complete Etsy `/v3/application/*` surface. It is not draft-only and is not limited to the old GPT Action operation list.

## Safety and correctness

- Read the current resource before substantial writes.
- Friendly listing/inventory/personalization/image mutation commands create a server-side snapshot first unless `--no-backup` is explicitly used.
- Raw requests do not infer backups because the hub cannot safely guess the resource semantics of every current/future Etsy endpoint.
- Never print, cat, echo, return, log, or commit access tokens, refresh tokens, API keys, shared secrets, or the internal API bearer token.
- Prefer `etsyctl request` for unusual endpoints instead of bypassing the Hub.
- Do not assume a listing must be a draft unless Etsy itself requires that endpoint to operate on drafts. The Hub core intentionally has no GPT-specific draft gate.
- When an Etsy endpoint/schema is unfamiliar or recently changed, verify it against Etsy's current Open API documentation/spec rather than guessing.
- Friendly listing reads normalize Etsy's live `listing_type` field and expose both `listing_type` and `type`; `is_digital` is derived from that value. Do not infer physical/digital status from shipping fields.
- Personalization writes are validated locally before Etsy is called: 1-5 questions; `question_text` 1-45 characters; `instructions` <=120 characters; text limits 1-1024; uploads 1-10 files with at most one upload question; dropdowns 1-30 unique options with 1-20 character labels; labeled-upload labels 1-45 characters.
- Existing personalization add-on prices are preserved automatically when an existing text question is updated without an explicit `add_on_price`. Send `0` or `null` explicitly to remove one.
- Callers remain responsible for their own user-authorization policy for destructive or consequential actions. The Hub provides capability, not business approval.

## Architecture

All interfaces share the same core:

`Etsy token store -> EtsyClient -> EtsyHub -> CLI / local HTTP API / future adapters`

Do not implement a second token refresher or second Etsy HTTP client in downstream projects. Add reusable behavior here instead.
