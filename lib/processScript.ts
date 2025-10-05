import { createHash } from "node:crypto";
import path from "node:path";
import { extension as mimeExtension } from "mime-types";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import scriptSchema from "@/app/lib/script-schema.json" assert { type: "json" };
import { fetch as undiciFetch, type Dispatcher } from "undici";
import { uploadBuffer, uploadJson, objectExists } from "./s3";
import { requireS3Config, isS3Configured, runtimeEnv, shouldUseUsProxy } from "./env";
import { fetchUsHttpProxyList, createProxyAgent } from "./proxy";
import { writeLocalBuffer, writeLocalJson } from "./localStorage";
import sharp from "sharp";

type ScriptEntry = unknown;
type ScriptDocument = ScriptEntry[];

type ScriptCharacter = {
  id: string;
  name?: string;
  team?: string;
  image?: string | string[];
  [key: string]: unknown;
};

type ScriptMeta = {
  id?: string;
  name?: string;
  logo?: string;
  background?: string;
  [key: string]: unknown;
};

type AssetPlan = {
  scriptIndex: number;
  entryType: "character" | "meta";
  entryId: string;
  entryName: string;
  field: string;
  originalUrl: string;
  fileBaseName: string;
  variantIndex?: number;
  variantLabel?: string;
};

type AssetUploadResult = AssetPlan & {
  storageKey: string;
  publicUrl: string;
  contentType: string;
  size: number;
};

type StorageMode = "s3" | "local";

type ProcessScriptParams = {
  scriptContent: string;
  requestedName?: string | null;
};

type ProcessingEvent =
  | { type: "planSummary"; totalAssets: number; scriptName: string }
  | { type: "assetStart"; plan: AssetPlan }
  | { type: "assetStored"; plan: AssetPlan; asset: AssetUploadResult };

type ProcessedScriptResponse = {
  scriptName: string;
  scriptSlug: string;
  storagePrefix: string;
  storageMode: StorageMode;
  bucket: string | null;
  localBasePath: string | null;
  processedAt: string;
  manifestKey: string;
  manifestUrl: string;
  originalScriptKey: string;
  originalScriptUrl: string;
  rewrittenScriptKey: string;
  rewrittenScriptUrl: string;
  rewritten256ScriptKey: string;
  rewritten256ScriptUrl: string;
  assets: AssetUploadResult[];
  rewrittenScript: ScriptDocument;
  rewritten256Script: ScriptDocument;
  proxyEnabled: boolean;
  proxiesUsed: string[];
};

type ProxyCapableRequestInit = NonNullable<Parameters<typeof undiciFetch>[1]> & { dispatcher?: Dispatcher };

type StoreBufferArgs = {
  key: string;
  buffer: Buffer;
  contentType?: string;
  cacheControl?: string;
};

type StoreJsonArgs = {
  key: string;
  json: unknown;
};

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);

const validateScript = ajv.compile<ScriptDocument>(scriptSchema as never);

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_PROXY_ATTEMPTS = 5;
const DIRECT_CONCURRENCY = 4;
const PROXY_CONCURRENCY = 6;

const proxyAgentCache = new Map<string, Dispatcher>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLikelyUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function toFriendlySegment(input: unknown, fallback: string): string {
  if (typeof input !== "string") return fallback;
  const trimmed = input.trim();
  if (!trimmed) return fallback;

  const normalized = trimmed
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  return normalized.length > 0 ? normalized : fallback;
}

function characterAlignmentLabel(team: unknown, variantIndex: number, totalVariants: number) {
  if (totalVariants > 1) {
    if (variantIndex === 0) return "Good";
    if (variantIndex === 1) return "Evil";
    return `Variant${variantIndex + 1}`;
  }

  if (typeof team === "string") {
    switch (team.toLowerCase()) {
      case "townsfolk":
      case "outsider":
        return "Good";
      case "minion":
      case "demon":
        return "Evil";
      case "fabled":
        return "Fabled";
      default:
        return "Neutral";
    }
  }

  return "Variant";
}

function isScriptCharacter(entry: ScriptEntry): entry is ScriptCharacter {
  if (!isRecord(entry)) return false;
  if (typeof entry.id !== "string") return false;
  const maybeImage = (entry as Record<string, unknown>).image;
  return typeof maybeImage === "string" || Array.isArray(maybeImage);
}

function isMeta(entry: ScriptEntry): entry is ScriptMeta {
  if (!isRecord(entry)) return false;
  const id = typeof entry.id === "string" ? entry.id.toLowerCase() : null;
  if (id === "meta") return true;
  return typeof entry.logo === "string" || typeof entry.background === "string";
}

function collectAssetPlans(
  script: ScriptDocument,
  scriptName: string
): { plans: AssetPlan[]; metaEntry: ScriptMeta | null } {
  const plans: AssetPlan[] = [];
  let metaEntry: ScriptMeta | null = null;

  script.forEach((entry, index) => {
    if (isScriptCharacter(entry)) {
      const imageField = entry.image;
      if (!imageField) return;

      const entryName = toFriendlySegment(entry.name ?? entry.id, entry.id);
      if (typeof imageField === "string") {
        if (!isLikelyUrl(imageField)) return;
        plans.push({
          scriptIndex: index,
          entryType: "character",
          entryId: entry.id,
          entryName: entry.name ?? entry.id,
          field: "image",
          originalUrl: imageField,
          fileBaseName: `${entryName}_${characterAlignmentLabel(entry.team, 0, 1)}`,
          variantIndex: 0,
          variantLabel: characterAlignmentLabel(entry.team, 0, 1),
        });
      } else if (Array.isArray(imageField)) {
        imageField.forEach((url, variantIndex) => {
          if (!isLikelyUrl(url)) return;
          const variantLabel = characterAlignmentLabel(entry.team, variantIndex, imageField.length);
          plans.push({
            scriptIndex: index,
            entryType: "character",
            entryId: entry.id,
            entryName: entry.name ?? entry.id,
            field: "image",
            originalUrl: url,
            fileBaseName: `${entryName}_${variantLabel}`,
            variantIndex,
            variantLabel,
          });
        });
      }
    } else if (isMeta(entry)) {
      metaEntry = entry;
      const scriptSegment = toFriendlySegment(entry.name, scriptName);
      const entryId = typeof entry.id === "string" ? entry.id : `meta-${index}`;

      if (isLikelyUrl(entry.logo)) {
        plans.push({
          scriptIndex: index,
          entryType: "meta",
          entryId,
          entryName: entry.name ?? "Meta",
          field: "logo",
          originalUrl: entry.logo,
          fileBaseName: `${scriptSegment}_Logo`,
          variantLabel: "Logo",
        });
      }

      if (isLikelyUrl(entry.background)) {
        plans.push({
          scriptIndex: index,
          entryType: "meta",
          entryId,
          entryName: entry.name ?? "Meta",
          field: "background",
          originalUrl: entry.background,
          fileBaseName: `${scriptSegment}_Background`,
          variantLabel: "Background",
        });
      }
    }
  });

  return { plans, metaEntry };
}

function resolveExtension(url: string, contentType: string | null) {
  const parsedUrl = new URL(url);
  const ext = path.extname(parsedUrl.pathname).replace(/^\./, "");
  if (ext) return ext;
  if (!contentType) return "bin";
  return mimeExtension(contentType) ?? "bin";
}

function hashContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function makeStoragePrefix(scriptContent: string, scriptName: string) {
  const contentHash = hashContent(scriptContent);
  const scriptSegment = toFriendlySegment(scriptName, "Custom_Script");
  return `${scriptSegment}_${contentHash}`;
}

function ensureScriptDocument(candidate: unknown): ScriptDocument {
  if (!Array.isArray(candidate)) {
    throw new Error("Script JSON must be an array of entries.");
  }
  return candidate as ScriptDocument;
}

function shuffle<T>(input: T[]): T[] {
  const array = input.slice();
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function buildProxyAttempts(preferred: string | undefined, pool: string[], maxExtra: number) {
  if (maxExtra <= 0) {
    return preferred ? [preferred] : [];
  }

  const attempts: string[] = [];
  const seen = new Set<string>();

  if (preferred) {
    attempts.push(preferred);
    seen.add(preferred);
  }

  for (const proxy of shuffle(pool)) {
    if (seen.has(proxy)) continue;
    attempts.push(proxy);
    seen.add(proxy);
    if (attempts.length >= (preferred ? 1 + maxExtra : maxExtra)) break;
  }

  return attempts;
}

async function fetchWithTimeout(url: string, proxyUrl: string | undefined, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let dispatcher: Dispatcher | undefined;
    if (proxyUrl) {
      const cached = proxyAgentCache.get(proxyUrl);
      if (cached) {
        dispatcher = cached;
      } else {
        dispatcher = createProxyAgent(proxyUrl);
        proxyAgentCache.set(proxyUrl, dispatcher);
      }
    }

  const init: ProxyCapableRequestInit = { signal: controller.signal } as ProxyCapableRequestInit;
    if (dispatcher) {
      init.dispatcher = dispatcher;
    }

    return await undiciFetch(url, init);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function downloadAssetPlan(
  plan: AssetPlan,
  prefix: string,
  storeBuffer: (args: StoreBufferArgs) => Promise<{ storageKey: string; publicUrl: string }>,
  checkExists: (key: string) => Promise<boolean>,
  preferProxy: boolean,
  proxyPool: string[],
  preferredProxy: string | undefined,
  proxiesUsed: Set<string>,
  forceReprocess: boolean
): Promise<AssetUploadResult[]> {
  const shouldAllowDirectFallback = !preferProxy || proxyPool.length === 0;

  const attempts: Array<string | undefined> = preferProxy && proxyPool.length > 0
    ? buildProxyAttempts(preferredProxy, proxyPool, MAX_PROXY_ATTEMPTS - 1)
    : [];

  if (shouldAllowDirectFallback || attempts.length === 0) {
    attempts.push(undefined);
  }

  let lastError: string | null = null;

  for (const proxyCandidate of attempts) {
    try {
      const response = await fetchWithTimeout(plan.originalUrl, proxyCandidate);
      if (!response.ok) {
        lastError = `status ${response.status}`;
        await response.body?.cancel?.();
        continue;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      const extension = resolveExtension(plan.originalUrl, contentType);

      // Generate content-based hash for the image
      const imageHash = hashContent(buffer);
      const sanitizedBase = plan.fileBaseName.replace(/[^\w.-]/g, "_");
      const key = `${prefix}/${sanitizedBase}_${imageHash}.${extension}`;

      // Check if asset already exists (deduplication) - skip if force reprocess is enabled
      const exists = !forceReprocess && await checkExists(key);
      if (exists) {
        // Asset already exists, return existing reference without re-uploading
        const { publicUrl } = await storeBuffer({
          key,
          buffer: Buffer.alloc(0), // Empty buffer as signal to skip upload
          contentType,
          cacheControl: "public, max-age=31536000, immutable",
        });

        if (typeof proxyCandidate === "string") {
          proxiesUsed.add(proxyCandidate);
        }

        const results: AssetUploadResult[] = [{
          ...plan,
          storageKey: key,
          publicUrl,
          contentType,
          size: buffer.byteLength,
        }];

        // For character images, create or reuse 256px version
        if (plan.entryType === "character" && plan.field === "image") {
          const resizedKey = `${prefix}/${sanitizedBase}_${imageHash}_256.${extension}`;
          const resizedExists = !forceReprocess && await checkExists(resizedKey);

          if (resizedExists) {
            // Resized version already exists, reuse it
            const { publicUrl: resizedPublicUrl } = await storeBuffer({
              key: resizedKey,
              buffer: Buffer.alloc(0),
              contentType,
              cacheControl: "public, max-age=31536000, immutable",
            });
            results.push({
              ...plan,
              fileBaseName: `${plan.fileBaseName}_256`,
              variantLabel: plan.variantLabel ? `${plan.variantLabel} (256px)` : "256px",
              storageKey: resizedKey,
              publicUrl: resizedPublicUrl,
              contentType,
              size: 0,
            });
          } else {
            // Resized version doesn't exist, create it from the existing original
            try {
              const resizedBuffer = await sharp(buffer)
                .resize(256, 256, { fit: "cover" })
                .toBuffer();

              const { storageKey: resizedStorageKey, publicUrl: resizedPublicUrl } = await storeBuffer({
                key: resizedKey,
                buffer: resizedBuffer,
                contentType,
                cacheControl: "public, max-age=31536000, immutable",
              });

              results.push({
                ...plan,
                fileBaseName: `${plan.fileBaseName}_256`,
                variantLabel: plan.variantLabel ? `${plan.variantLabel} (256px)` : "256px",
                storageKey: resizedStorageKey,
                publicUrl: resizedPublicUrl,
                contentType,
                size: resizedBuffer.byteLength,
              });
            } catch (resizeError) {
              console.warn(`Failed to resize existing character image ${plan.originalUrl}:`, resizeError);
              // Continue without resized version if resize fails
            }
          }
        }

        return results;
      }

      const { storageKey, publicUrl } = await storeBuffer({
        key,
        buffer,
        contentType,
        cacheControl: "public, max-age=31536000, immutable",
      });

      if (typeof proxyCandidate === "string") {
        proxiesUsed.add(proxyCandidate);
      }

      const results: AssetUploadResult[] = [{
        ...plan,
        storageKey,
        publicUrl,
        contentType,
        size: buffer.byteLength,
      }];

      // For character images, also create and store 256px version
      if (plan.entryType === "character" && plan.field === "image") {
        try {
          const resizedBuffer = await sharp(buffer)
            .resize(256, 256, { fit: "cover" })
            .toBuffer();

          const resizedKey = `${prefix}/${sanitizedBase}_${imageHash}_256.${extension}`;
          const { storageKey: resizedStorageKey, publicUrl: resizedPublicUrl } = await storeBuffer({
            key: resizedKey,
            buffer: resizedBuffer,
            contentType,
            cacheControl: "public, max-age=31536000, immutable",
          });

          results.push({
            ...plan,
            fileBaseName: `${plan.fileBaseName}_256`,
            variantLabel: plan.variantLabel ? `${plan.variantLabel} (256px)` : "256px",
            storageKey: resizedStorageKey,
            publicUrl: resizedPublicUrl,
            contentType,
            size: resizedBuffer.byteLength,
          });
        } catch (resizeError) {
          console.warn(`Failed to resize character image ${plan.originalUrl}:`, resizeError);
          // Continue without resized version if resize fails
        }
      }

      return results;
    } catch (error) {
      const detail = error instanceof Error && error.name === "AbortError"
        ? `timed out after ${REQUEST_TIMEOUT_MS}ms`
        : error instanceof Error
        ? error.message
        : String(error);
      lastError = proxyCandidate ? `${proxyCandidate} -> ${detail}` : detail;
    }
  }

  const proxyHint = lastError ? ` (${lastError})` : "";
  throw new Error(`Failed to download image: ${plan.originalUrl}${proxyHint}`);
}

export async function processScriptUpload(
  { scriptContent, requestedName }: ProcessScriptParams,
  options?: { onEvent?: (event: ProcessingEvent) => void; useUsProxy?: boolean; forceReprocess?: boolean; publicBaseUrl?: string }
): Promise<ProcessedScriptResponse> {
  const emit = options?.onEvent ?? (() => {});
  const parsed = JSON.parse(scriptContent);
  const script = ensureScriptDocument(parsed);

  if (!validateScript(script)) {
    throw new Error(`Script did not match the required schema: ${ajv.errorsText(validateScript.errors)}`);
  }

  const { plans, metaEntry } = collectAssetPlans(script, requestedName ?? "Script");
  if (plans.length === 0) {
    throw new Error("No image URLs were found in the provided script.");
  }

  const scriptName = requestedName ?? metaEntry?.name ?? "Custom Script";
  const scriptSlug = toFriendlySegment(scriptName, "Custom_Script");
  const prefix = makeStoragePrefix(scriptContent, scriptName);
  emit({ type: "planSummary", totalAssets: plans.length, scriptName });

  const storageMode: StorageMode = isS3Configured() ? "s3" : "local";
  const s3Config = storageMode === "s3" ? requireS3Config() : null;
  const basePublicUrl = options?.publicBaseUrl;

  const preferProxy = options?.useUsProxy ?? shouldUseUsProxy();
  const proxyListUrl = runtimeEnv.US_PROXY_LIST_URL;
  const proxyPool = preferProxy ? await fetchUsHttpProxyList(proxyListUrl) : [];
  if (preferProxy && proxyPool.length === 0) {
    console.warn("US proxy mode requested, but no proxies were available in the fetched list.");
  }
  const proxiesUsed = new Set<string>();

  const storeBuffer = async (args: StoreBufferArgs) =>
    storageMode === "s3"
      ? {
          storageKey: args.key,
          publicUrl: await uploadBuffer(args),
        }
      : writeLocalBuffer({ ...args, baseUrl: basePublicUrl });

  const checkExists = async (key: string) =>
    storageMode === "s3" ? await objectExists(key) : false;

  const storeJson = async ({ key, json }: StoreJsonArgs) =>
    storageMode === "s3"
      ? {
          storageKey: key,
          publicUrl: await uploadJson({ key, json }),
        }
      : writeLocalJson({ key, json, baseUrl: basePublicUrl });

  const assetResults: (AssetUploadResult[] | undefined)[] = new Array(plans.length);

  const baseConcurrency = preferProxy ? PROXY_CONCURRENCY : DIRECT_CONCURRENCY;
  const concurrency = Math.max(1, Math.min(plans.length, baseConcurrency));
  const proxyAssignments = preferProxy && proxyPool.length > 0 ? shuffle(proxyPool).slice(0, concurrency) : [];

  let nextPlanIndex = 0;

  const workers = Array.from({ length: concurrency }, (_, workerIndex) => {
    const preferredProxy = proxyAssignments[workerIndex];

    return (async () => {
      while (true) {
        const currentIndex = nextPlanIndex;
        nextPlanIndex += 1;
        if (currentIndex >= plans.length) break;

        const plan = plans[currentIndex];
        emit({ type: "assetStart", plan });

        const assets = await downloadAssetPlan(
          plan,
          prefix,
          storeBuffer,
          checkExists,
          preferProxy,
          proxyPool,
          preferredProxy,
          proxiesUsed,
          options?.forceReprocess ?? false
        );

        assetResults[currentIndex] = assets;
        // Emit for the primary asset (first in array)
        emit({ type: "assetStored", plan, asset: assets[0] });
      }
    })();
  });

  await Promise.all(workers);

  const processedAssets = assetResults.flatMap((assets, index) => {
    if (!assets) {
      throw new Error(`Asset plan at index ${index} did not complete processing.`);
    }
    return assets;
  });

  const rewrittenScript = (typeof structuredClone === "function"
    ? structuredClone(script)
    : JSON.parse(JSON.stringify(script))) as ScriptDocument;

  const rewritten256Script = (typeof structuredClone === "function"
    ? structuredClone(script)
    : JSON.parse(JSON.stringify(script))) as ScriptDocument;

  // Separate original and resized assets
  const originalAssets = processedAssets.filter(asset => !asset.variantLabel?.includes("(256px)"));
  const resizedAssets = processedAssets.filter(asset => asset.variantLabel?.includes("(256px)"));

  // Create a map for quick lookup of resized versions
  const resizedMap = new Map<string, AssetUploadResult>();
  resizedAssets.forEach(asset => {
    const key = `${asset.scriptIndex}:${asset.variantIndex ?? 0}`;
    resizedMap.set(key, asset);
  });

  originalAssets.forEach((asset) => {
    const entry = rewrittenScript[asset.scriptIndex];
    const entry256 = rewritten256Script[asset.scriptIndex];
    if (!isRecord(entry)) return;
    if (!isRecord(entry256)) return;

    if (asset.field === "image") {
      const imageValue = (entry as ScriptCharacter).image;
      const imageValue256 = (entry256 as ScriptCharacter).image;

      // Find corresponding 256px version if it exists
      const resizedKey = `${asset.scriptIndex}:${asset.variantIndex ?? 0}`;
      const resizedAsset = resizedMap.get(resizedKey);

      if (Array.isArray(imageValue)) {
        const index = asset.variantIndex ?? 0;
        imageValue[index] = asset.publicUrl;
        if (Array.isArray(imageValue256)) {
          imageValue256[index] = resizedAsset?.publicUrl ?? asset.publicUrl;
        }
      } else {
        (entry as ScriptCharacter).image = asset.publicUrl;
        (entry256 as ScriptCharacter).image = resizedAsset?.publicUrl ?? asset.publicUrl;
      }
    } else {
      // For logo and background, use full size in both scripts
      (entry as Record<string, unknown>)[asset.field] = asset.publicUrl;
      (entry256 as Record<string, unknown>)[asset.field] = asset.publicUrl;
    }
  });

  const manifestBaseKey = `${prefix}/manifest.json`;
  const originalScriptBaseKey = `${prefix}/original.json`;
  const rewrittenScriptBaseKey = `${prefix}/rewritten.json`;
  const rewritten256ScriptBaseKey = `${prefix}/rewritten_256.json`;

  const [manifestResult, originalResult, rewrittenResult, rewritten256Result] = await Promise.all([
    storeJson({ key: manifestBaseKey, json: processedAssets }),
    storeJson({ key: originalScriptBaseKey, json: script }),
    storeJson({ key: rewrittenScriptBaseKey, json: rewrittenScript }),
    storeJson({ key: rewritten256ScriptBaseKey, json: rewritten256Script }),
  ]);

  return {
    scriptName,
    scriptSlug,
    storagePrefix: prefix,
    storageMode,
    bucket: s3Config?.bucket ?? null,
    localBasePath: storageMode === "local" ? "/local-mirror" : null,
    processedAt: new Date().toISOString(),
    manifestKey: manifestResult.storageKey,
    manifestUrl: manifestResult.publicUrl,
    originalScriptKey: originalResult.storageKey,
    originalScriptUrl: originalResult.publicUrl,
    rewrittenScriptKey: rewrittenResult.storageKey,
    rewrittenScriptUrl: rewrittenResult.publicUrl,
    rewritten256ScriptKey: rewritten256Result.storageKey,
    rewritten256ScriptUrl: rewritten256Result.publicUrl,
    assets: processedAssets,
    rewrittenScript,
    rewritten256Script,
    proxyEnabled: preferProxy && proxyPool.length > 0,
    proxiesUsed: Array.from(proxiesUsed),
  };
}

export type { ProcessedScriptResponse, AssetUploadResult, ProcessingEvent };
