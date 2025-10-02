import { z } from "zod";

const envSchema = z.object({
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_PUBLIC_BASE_URL: z.string().url().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === "true" || value === "1") return "true" as const;
      if (value === "false" || value === "0") return "false" as const;
      return undefined;
    }),
  USE_US_PROXY: z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) return false;
      return value === "true" || value === "1";
    }),
  US_PROXY_LIST_URL: z.string().url().optional(),
  NODE_ENV: z.string().default("development"),
});

type RawEnv = z.input<typeof envSchema>;
type ParsedEnv = z.output<typeof envSchema>;

const rawEnv: RawEnv = {
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  S3_REGION: process.env.S3_REGION,
  S3_BUCKET: process.env.S3_BUCKET,
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_PUBLIC_BASE_URL: process.env.S3_PUBLIC_BASE_URL,
  S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
  USE_US_PROXY: process.env.USE_US_PROXY,
  US_PROXY_LIST_URL: process.env.US_PROXY_LIST_URL,
  NODE_ENV: process.env.NODE_ENV ?? "development",
};

const parsedEnv = envSchema.safeParse(rawEnv);

if (!parsedEnv.success) {
  console.warn("Invalid environment configuration detected:", parsedEnv.error.format());
}

const env: ParsedEnv = parsedEnv.success
  ? parsedEnv.data
  : {
      S3_ACCESS_KEY_ID: rawEnv.S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: rawEnv.S3_SECRET_ACCESS_KEY,
      S3_REGION: rawEnv.S3_REGION,
      S3_BUCKET: rawEnv.S3_BUCKET,
      S3_ENDPOINT: rawEnv.S3_ENDPOINT,
      S3_PUBLIC_BASE_URL: rawEnv.S3_PUBLIC_BASE_URL,
      S3_FORCE_PATH_STYLE: undefined,
      USE_US_PROXY: false,
      US_PROXY_LIST_URL: rawEnv.US_PROXY_LIST_URL,
      NODE_ENV: rawEnv.NODE_ENV ?? "development",
    };

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isS3Configured() {
  return (
    hasValue(env.S3_ACCESS_KEY_ID) &&
    hasValue(env.S3_SECRET_ACCESS_KEY) &&
    hasValue(env.S3_REGION) &&
    hasValue(env.S3_BUCKET)
  );
}

export function requireS3Config() {
  const missing: string[] = [];
  if (!hasValue(env.S3_ACCESS_KEY_ID)) missing.push("S3_ACCESS_KEY_ID");
  if (!hasValue(env.S3_SECRET_ACCESS_KEY)) missing.push("S3_SECRET_ACCESS_KEY");
  if (!hasValue(env.S3_REGION)) missing.push("S3_REGION");
  if (!hasValue(env.S3_BUCKET)) missing.push("S3_BUCKET");

  if (missing.length > 0) {
    throw new Error(`Missing required S3 configuration values: ${missing.join(", ")}`);
  }

  return {
    accessKeyId: env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    region: env.S3_REGION!,
    bucket: env.S3_BUCKET!,
    endpoint: env.S3_ENDPOINT,
    publicBaseUrl: env.S3_PUBLIC_BASE_URL,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
  };
}

export const runtimeEnv = env;

export function shouldUseUsProxy() {
  return env.USE_US_PROXY;
}
