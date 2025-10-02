import { S3Client, PutObjectCommand, PutObjectCommandInput } from "@aws-sdk/client-s3";
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

export async function putObject(input: BucketlessPutObjectInput) {
  const config = requireS3Config();
  const client = getClient();
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    ...input,
  });

  await client.send(command);
  return {
    bucket: config.bucket,
    key: input.Key!,
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
  await putObject({
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: cacheControl,
  });

  return buildPublicUrl(key);
}

export async function uploadJson({ key, json }: { key: string; json: unknown }) {
  const payload = typeof json === "string" ? json : JSON.stringify(json, null, 2);
  await putObject({
    Key: key,
    Body: payload,
    ContentType: "application/json",
    CacheControl: "no-cache",
  });
  return buildPublicUrl(key);
}
