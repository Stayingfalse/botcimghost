import { NextRequest, NextResponse } from "next/server";
import { getLocalStorageRoot } from "@/lib/localStorage";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { lookup as mimeLookup } from "mime-types";

export const dynamic = "force-dynamic";

async function serveAsset(params: { asset?: string[] }) {
  const segments = Array.isArray(params.asset) ? params.asset : [];
  if (segments.length === 0) {
    return NextResponse.json({ error: "Missing asset path" }, { status: 400 });
  }

  const relativePath = segments.join("/");
  if (relativePath.includes("..")) {
    return NextResponse.json({ error: "Invalid asset path" }, { status: 400 });
  }

  const root = path.resolve(getLocalStorageRoot());
  const resolvedPath = path.resolve(root, relativePath);

  if (resolvedPath !== root && !resolvedPath.startsWith(`${root}${path.sep}`)) {
    return NextResponse.json({ error: "Invalid asset path" }, { status: 400 });
  }

  try {
    const fileStats = await stat(resolvedPath);
    if (!fileStats.isFile()) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    const nodeStream = createReadStream(resolvedPath);
    const body = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    const contentType = mimeLookup(resolvedPath) || "application/octet-stream";

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": fileStats.size.toString(),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    console.error("Failed to serve local-mirror asset", error);
    return NextResponse.json({ error: "Failed to read asset" }, { status: 500 });
  }
}

export async function GET(_request: NextRequest, context: { params: Promise<{ asset: string[] }> }) {
  const params = await context.params;
  return serveAsset(params);
}

export async function HEAD(_request: NextRequest, context: { params: Promise<{ asset: string[] }> }) {
  const params = await context.params;
  const response = await serveAsset(params);
  if (response.body) {
    response.body.cancel();
  }
  return new NextResponse(null, {
    status: response.status,
    headers: new Headers(response.headers),
  });
}
