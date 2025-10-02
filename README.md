## Overview

`botcimghost` is a Next.js 14 (App Router + TypeScript) application that ingests Blood on the Clocktower script files, validates them against the official schema, mirrors every referenced image into an S3-compatible bucket with human-friendly naming, and returns a rewritten script that points to the mirrored assets. The original script, the rewritten script, and a manifest detailing every asset are stored alongside the images.

## Features

- 🔍 Schema validation using the official [BotC script schema](https://github.com/ThePandemoniumInstitute/botc-release/blob/main/script-schema.json).
- 🖼️ End-to-end asset pipeline: discover URLs, download, upload to S3, and rewrite JSON references.
- 🗃️ Stores original script, rewritten script, and asset manifest in your bucket for reproducibility.
- 🧭 Friendly naming convention (`Script_Name_UID/Character_Name_Good.jpg`) with alignment-aware variants.
- 💻 UI and API entry points for manual workflows or automation.
- 💾 Local fallback automatically stores assets in `public/local-mirror` when S3 credentials are absent.
- 🇺🇸 Optional US proxy routing for downloads when source hosts geo-block UK traffic.

## Prerequisites

- Node.js 18.17 or newer.
- Access to an S3-compatible object storage service (AWS S3, MinIO, Cloudflare R2, etc.).
- Credentials with permission to `PutObject` into the target bucket.

### Required environment variables

Create a `.env.local` file (not committed) and populate the variables below before running the app:

| Variable | Required | Description |
| --- | --- | --- |
| `S3_ACCESS_KEY_ID` | optional | Access key identifier with write access to the bucket. Required for S3 mode. |
| `S3_SECRET_ACCESS_KEY` | optional | Secret key for the supplied access key. Required for S3 mode. |
| `S3_REGION` | optional | Region for AWS S3 (e.g. `us-east-1`). For S3-compatible services, use the value expected by the SDK. Required for S3 mode. |
| `S3_BUCKET` | optional | Destination bucket for mirrored assets and manifests. Required for S3 mode. |
| `S3_ENDPOINT` | optional | Custom endpoint for S3-compatible providers (e.g. `https://s3.us-west-002.backblazeb2.com`). |
| `S3_PUBLIC_BASE_URL` | optional | Override the public URL base (useful for CDN domains). Defaults to AWS public URL pattern. |
| `S3_FORCE_PATH_STYLE` | optional | Set to `true`/`1` for providers that require path-style URLs. |
| `USE_US_PROXY` | optional | Set to `true` to download assets through a random US proxy (helpful for UK-based hosts that are geo-blocked). |
| `US_PROXY_LIST_URL` | optional | Override the proxy list source (defaults to Proxifly’s US list on jsDelivr). |

## Quick start

Install dependencies, then start the development server:

```powershell
npm install
npm run dev
```

Navigate to [http://localhost:3000](http://localhost:3000) and upload your script JSON via the provided form. Toggle **“Use US proxy for downloads”** if the original hosting site blocks UK visitors.

If you omit the S3 credentials during development, the app mirrors assets to `public/local-mirror`, keeping the rest of the workflow identical.

### API usage

You can also trigger processing programmatically by POSTing to `/api/process` with either multipart form data or JSON:

```powershell
curl -X POST http://localhost:3000/api/process \
	-H "Content-Type: application/json" \
	-d @payload.json
```

`payload.json` should contain the original JSON string:

```json
{
	"script": "<stringified BotC script JSON>",
	"scriptName": "Optional Friendly Script Name"
}
```

The response includes storage keys, public URLs, and the rewritten script payload.

## Processing pipeline

1. **Validation** – scripts are checked against the official BotC JSON schema.
2. **Asset discovery** – character and metadata images (logo/background) are enumerated.
3. **Download & upload** – each URL is fetched (optionally through a US proxy), validated, and uploaded to S3 (or mirrored locally) using the naming convention `Script_Name_UID/Character_Name_Alignment.ext`.
4. **Rewrite & persist** – the script JSON is updated to point at mirrored URLs and stored alongside a manifest documenting every asset.

## Project structure

- `app/page.tsx` – user-facing upload experience.
- `app/api/process/route.ts` – API endpoint handling uploads.
- `app/components/upload-form.tsx` – client component powering the UI.
- `lib/processScript.ts` – core ingestion, validation, and S3 sync logic.
- `lib/s3.ts` & `lib/env.ts` – S3 helpers and environment parsing.
- `app/lib/script-schema.json` – pinned BotC schema used for validation.

## Scripts

```powershell
npm run dev      # Start the development server (Turbopack)
npm run build    # Compile for production
npm run start    # Run the production build
npm run lint     # Lint the project
```

## Testing checklist

- ✅ Decide on storage: provide S3 credentials in `.env.local` or rely on the local mirror at `public/local-mirror`.
- ✅ Upload a sample script and confirm images appear in the chosen storage target with friendly names.
- ✅ Confirm the rewritten JSON downloads correctly and references mirrored URLs only.
## License

This project mirrors assets for personal scripts. Ensure that you have permission to redistribute any images you process.
