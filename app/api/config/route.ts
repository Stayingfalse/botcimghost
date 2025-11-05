import { isProxyOptionEnabled } from "@/lib/env";
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    proxyOptionEnabled: isProxyOptionEnabled(),
  });
}
