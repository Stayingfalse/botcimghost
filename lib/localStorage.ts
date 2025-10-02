import { promises as fs } from "node:fs";
import path from "node:path";

const LOCAL_ROOT = path.join(process.cwd(), "public", "local-mirror");
const PUBLIC_PREFIX = "/local-mirror/";

function sanitizeKey(key: string) {
  const trimmed = key.replace(/^\/+/, "");
  if (!trimmed) {
    throw new Error("Local storage key cannot be empty");
  }
  if (trimmed.includes("..")) {
    throw new Error("Local storage key cannot contain relative segments");
  }
  return trimmed;
}

async function ensureDirectoryForKey(key: string) {
  const sanitized = sanitizeKey(key);
  const directory = path.dirname(path.join(LOCAL_ROOT, sanitized));
  await fs.mkdir(directory, { recursive: true });
  return sanitized;
}

function toPublicUrl(key: string) {
  const sanitized = sanitizeKey(key);
  return `${PUBLIC_PREFIX}${sanitized}`;
}

export async function writeLocalBuffer({
  key,
  buffer,
  baseUrl,
}: {
  key: string;
  buffer: Buffer;
  contentType?: string;
  cacheControl?: string;
  baseUrl?: string;
}) {
  const sanitized = await ensureDirectoryForKey(key);
  const filePath = path.join(LOCAL_ROOT, sanitized);
  await fs.writeFile(filePath, buffer);

  const publicPath = toPublicUrl(sanitized);
  const publicUrl = baseUrl ? new URL(publicPath, baseUrl).toString() : publicPath;

  return {
    storageKey: path.posix.join("local-mirror", sanitized.replace(/\\/g, "/")),
    publicUrl,
  };
}

export async function writeLocalJson({ key, json, baseUrl }: { key: string; json: unknown; baseUrl?: string }) {
  const payload = typeof json === "string" ? json : JSON.stringify(json, null, 2);
  const buffer = Buffer.from(payload, "utf-8");
  return writeLocalBuffer({ key, buffer, baseUrl });
}

export function buildLocalPublicUrl(key: string) {
  return toPublicUrl(key);
}

export function getLocalStorageRoot() {
  return LOCAL_ROOT;
}
