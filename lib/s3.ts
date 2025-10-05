import { S3Client, PutObjectCommand, PutObjectCommandInput, HeadObjectCommand } from "@aws-sdk/client-s3";
import { requireS3Config, runtimeEnv } from "./env";

let cachedClient: S3Client | null = null;

function getClient() {
  if (!cachedClient) {
    const config = requireS3Config();
    cachedClient = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }
  return cachedClient;
}

type BucketlessPutObjectInput = Omit<PutObjectCommandInput, "Bucket"> & { Key: string };

function applyPathPrefix(key: string): string {
  const config = requireS3Config();
  if (!config.pathPrefix) return key;
  const prefix = config.pathPrefix.replace(/\/+$/, "");
  const cleanKey = key.replace(/^\/+/, "");
  return `${prefix}/${cleanKey}`;
}

export async function putObject(input: BucketlessPutObjectInput) {
  const config = requireS3Config();
  const client = getClient();
  const prefixedKey = applyPathPrefix(input.Key!);
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    ...input,
    Key: prefixedKey,
  });

  await client.send(command);
  return {
    bucket: config.bucket,
    key: prefixedKey,
  };
}

export function buildPublicUrl(key: string) {
  const config = requireS3Config();
  const trimmedKey = key.replace(/^\/+/, "");

  if (runtimeEnv.S3_PUBLIC_BASE_URL) {
    const base = runtimeEnv.S3_PUBLIC_BASE_URL.endsWith("/")
      ? runtimeEnv.S3_PUBLIC_BASE_URL
      : `${runtimeEnv.S3_PUBLIC_BASE_URL}/`;
    return new URL(trimmedKey, base).toString();
  }

  if (config.endpoint) {
    const endpointUrl = new URL(config.endpoint);
    if (config.forcePathStyle) {
      return `${endpointUrl.origin}/${config.bucket}/${trimmedKey}`;
    }
    return `${endpointUrl.protocol}//${config.bucket}.${endpointUrl.host}/${trimmedKey}`;
  }

  return `https://${config.bucket}.s3.${config.region}.amazonaws.com/${trimmedKey}`;
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    const config = requireS3Config();
    const client = getClient();
    const prefixedKey = applyPathPrefix(key);

    await client.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: prefixedKey,
      })
    );
    return true;
  } catch {
    // HeadObject throws NotFound error if object doesn't exist
    return false;
  }
}

export async function uploadBuffer({
  key,
  buffer,
  contentType,
  cacheControl,
}: {
  key: string;
  buffer: Buffer;
  contentType?: string;
  cacheControl?: string;
}) {
  // If buffer is empty, skip upload and just return the public URL
  if (buffer.length === 0) {
    return buildPublicUrl(applyPathPrefix(key));
  }

  const result = await putObject({
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: cacheControl,
  });

  return buildPublicUrl(result.key);
}

export async function uploadJson({ key, json }: { key: string; json: unknown }) {
  const payload = typeof json === "string" ? json : JSON.stringify(json, null, 2);
  const result = await putObject({
    Key: key,
    Body: payload,
    ContentType: "application/json",
    CacheControl: "no-cache",
  });
  return buildPublicUrl(result.key);
}
