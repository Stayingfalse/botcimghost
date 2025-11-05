import { NextRequest, NextResponse } from "next/server";
import { processScriptUpload, type ProcessingEvent, type ProcessedScriptResponse } from "@/lib/processScript";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type StreamPayload =
  | { type: "progress"; event: ProcessingEvent }
  | { type: "complete"; result: ProcessedScriptResponse }
  | { type: "error"; message: string };

type StreamOptions = {
  requestedName?: string;
  useProxy?: boolean;
  forceReprocess?: boolean;
  publicBaseUrl?: string;
};

function pickForwardedValue(raw: string | null) {
  if (!raw) return null;
  return raw.split(",").map((value) => value.trim()).find(Boolean) ?? null;
}

function resolvePublicBaseUrl(request: NextRequest) {
  const forwarded = pickForwardedValue(request.headers.get("forwarded"));
  if (forwarded) {
    const params = forwarded.split(";").reduce<Record<string, string>>((acc, part) => {
      const [key, value] = part.split("=");
      if (key && value) {
        acc[key.trim().toLowerCase()] = value.trim();
      }
      return acc;
    }, {});

    const proto = params["proto"];
    const host = params["host"];
    if (host) {
      const scheme = proto ?? request.nextUrl.protocol.replace(/:$/, "");
      return `${scheme}://${host}`;
    }
  }

  const forwardedProto = pickForwardedValue(request.headers.get("x-forwarded-proto"));
  const forwardedHost = pickForwardedValue(request.headers.get("x-forwarded-host"));
  const forwardedPort = pickForwardedValue(request.headers.get("x-forwarded-port"));

  if (forwardedHost) {
    const scheme = forwardedProto ?? request.nextUrl.protocol.replace(/:$/, "");
    const hostValue = forwardedHost.includes(":") || !forwardedPort || ["80", "443"].includes(forwardedPort)
      ? forwardedHost
      : `${forwardedHost}:${forwardedPort}`;
    return `${scheme}://${hostValue}`;
  }

  const hostHeader = request.headers.get("host");
  if (hostHeader) {
    const scheme = forwardedProto ?? request.nextUrl.protocol.replace(/:$/, "");
    return `${scheme}://${hostHeader}`;
  }

  return request.nextUrl.origin;
}

function streamProcessing(scriptContent: string, options?: StreamOptions) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: StreamPayload) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        const result = await processScriptUpload(
          { scriptContent, requestedName: options?.requestedName },
          {
            onEvent: (event) => send({ type: "progress", event }),
            useUsProxy: options?.useProxy,
            forceReprocess: options?.forceReprocess,
            publicBaseUrl: options?.publicBaseUrl,
          }
        );

        send({ type: "complete", result });
      } catch (error) {
        console.error("Failed to process script upload", error);
        const message = error instanceof Error ? error.message : "Unknown error";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
    },
  });
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  const publicBaseUrl = resolvePublicBaseUrl(request);

  const parseBoolean = (value: unknown): boolean => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1" || normalized === "on") return true;
      if (normalized === "false" || normalized === "0" || normalized === "off") return false;
    }
    return false;
  };

  if (contentType.includes("application/json")) {
    const body = await request.json();
    if (typeof body !== "object" || body === null || typeof body.script !== "string") {
      return NextResponse.json(
        { error: "Expected a JSON payload with a 'script' field containing the BotC script JSON string." },
        { status: 400 }
      );
    }

    return streamProcessing(body.script, {
      requestedName: typeof body.scriptName === "string" ? body.scriptName : undefined,
      useProxy: parseBoolean((body as Record<string, unknown>).useProxy),
      forceReprocess: parseBoolean((body as Record<string, unknown>).forceReprocess),
      publicBaseUrl,
    });
  }

  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      {
        error:
          "Unsupported content type. Use multipart/form-data with a 'script' file field or application/json with a 'script' string field.",
      },
      { status: 400 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("script");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing 'script' file upload in the multipart form data." },
      { status: 400 }
    );
  }

  const overrideName = formData.get("scriptName");
  const useProxyValue = formData.get("useProxy");
  const forceReprocessValue = formData.get("forceReprocess");
  const buffer = Buffer.from(await file.arrayBuffer());

  return streamProcessing(buffer.toString("utf-8"), {
    requestedName: typeof overrideName === "string" ? overrideName : undefined,
    useProxy: parseBoolean(useProxyValue),
    forceReprocess: parseBoolean(forceReprocessValue),
    publicBaseUrl,
  });
}
