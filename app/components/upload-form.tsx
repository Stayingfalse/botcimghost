"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProcessedScriptResponse, ProcessingEvent } from "@/lib/processScript";

type FormStatus = "idle" | "uploading" | "success" | "error";

type AssetRow = {
  id: string;
  variant: string;
  field: string;
  originalUrl: string;
  publicUrl: string;
  sizeLabel: string;
  contentType: string;
};

type StreamPayload =
  | { type: "progress"; event: ProcessingEvent }
  | { type: "complete"; result: ProcessedScriptResponse }
  | { type: "error"; message: string };

type AssetPlan = Extract<ProcessingEvent, { type: "assetStart" }>["plan"];

type ProgressItem = {
  key: string;
  label: string;
  status: "pending" | "inProgress" | "complete";
  originalUrl: string;
  publicUrl?: string;
  contentType?: string;
  size?: number;
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "-";
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(1)} KB`;
  }
  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(2)} MB`;
}

function planKey(plan: AssetPlan) {
  return `${plan.entryId}:${plan.field}:${plan.variantLabel ?? "Default"}`;
}

function planLabel(plan: AssetPlan) {
  const variant = plan.variantLabel ? ` • ${plan.variantLabel}` : "";
  return `${plan.entryName}${variant} (${plan.field})`;
}

function updateProgressCollection(
  items: ProgressItem[],
  plan: AssetPlan,
  updates: {
    status: ProgressItem["status"];
    publicUrl?: string;
    contentType?: string;
    size?: number;
  }
) {
  const key = planKey(plan);
  const baseItem: ProgressItem = {
    key,
    label: planLabel(plan),
    status: updates.status,
    originalUrl: plan.originalUrl,
  };

  const index = items.findIndex((item) => item.key === key);
  if (index === -1) {
    return [...items, { ...baseItem, ...updates }];
  }

  const next = [...items];
  next[index] = { ...next[index], ...updates };
  return next;
}

function buildAssetRows(result: ProcessedScriptResponse | null): AssetRow[] {
  if (!result) return [];
  return result.assets.map((asset) => ({
    id: `${asset.entryName} (${asset.entryId})`,
    variant: asset.variantLabel ?? "Default",
    field: asset.field,
    originalUrl: asset.originalUrl,
    publicUrl: asset.publicUrl,
    sizeLabel: formatBytes(asset.size),
    contentType: asset.contentType,
  }));
}

export function UploadForm() {
  const [status, setStatus] = useState<FormStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessedScriptResponse | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [progressItems, setProgressItems] = useState<ProgressItem[]>([]);
  const [totalAssets, setTotalAssets] = useState<number | null>(null);
  const [processedCount, setProcessedCount] = useState<number>(0);
  const [useProxy, setUseProxy] = useState(false);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const totalAssetsRef = useRef<number | null>(null);

  useEffect(() => {
    totalAssetsRef.current = totalAssets;
  }, [totalAssets]);

  useEffect(() => {
    return () => {
      uploadAbortRef.current?.abort();
    };
  }, []);

  const assets = useMemo(() => buildAssetRows(result), [result]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;

    setMessage(null);
    setResult(null);
    setProgressItems([]);
    setTotalAssets(null);
    setProcessedCount(0);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const fileInput = form.elements.namedItem("script") as HTMLInputElement | null;

    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
      setStatus("error");
      setMessage("Please select a Blood on the Clocktower script JSON file to upload.");
      return;
    }

    const file = fileInput.files[0];
    if (file.type && !file.type.includes("json")) {
      setStatus("error");
      setMessage("The selected file must be JSON.");
      return;
    }

    setStatus("uploading");

    try {
      const payload = new FormData();
      payload.append("script", file);
      const scriptName = formData.get("scriptName");
      if (typeof scriptName === "string" && scriptName.trim().length > 0) {
        payload.append("scriptName", scriptName.trim());
      }
      payload.append("useProxy", useProxy ? "true" : "false");

      const controller = new AbortController();
      uploadAbortRef.current = controller;

      const response = await fetch("/api/process", {
        method: "POST",
        body: payload,
        signal: controller.signal,
      });

      if (!response.ok) {
        let detail = `Upload failed with status ${response.status}`;
        try {
          const errorPayload = (await response.json()) as { error?: string } | null;
          if (errorPayload?.error) {
            detail = errorPayload.error;
          }
        } catch {
          // ignore non-JSON error bodies
        }
        throw new Error(detail);
      }

      if (!response.body) {
        throw new Error("Streaming response is not supported in this environment.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      let finalResult: ProcessedScriptResponse | null = null;
      let encounteredError: string | null = null;

      const requestedProxy = useProxy;

      const handlePayload = (payload: StreamPayload) => {
        switch (payload.type) {
          case "progress": {
            const event = payload.event;
            if (event.type === "planSummary") {
              setTotalAssets(event.totalAssets);
              const suffix = event.totalAssets === 1 ? "asset" : "assets";
              const proxySuffix = requestedProxy ? " via US proxy" : "";
              setMessage(`Mirroring ${event.totalAssets} ${suffix} for ${event.scriptName}${proxySuffix}…`);
            } else if (event.type === "assetStart") {
              setProgressItems((items) => updateProgressCollection(items, event.plan, { status: "inProgress" }));
              setMessage(`Downloading ${event.plan.entryName} (${event.plan.variantLabel})…`);
            } else if (event.type === "assetStored") {
              setProgressItems((items) =>
                updateProgressCollection(items, event.plan, {
                  status: "complete",
                  publicUrl: event.asset.publicUrl,
                  contentType: event.asset.contentType,
                  size: event.asset.size,
                })
              );
              setProcessedCount((current) => {
                const next = current + 1;
                const total = totalAssetsRef.current;
                if (typeof total === "number" && total > 0) {
                  setMessage(`Mirrored ${next} of ${total} asset${total === 1 ? "" : "s"}…`);
                } else {
                  setMessage(`Mirrored ${next} asset${next === 1 ? "" : "s"}…`);
                }
                return next;
              });
            }
            break;
          }
          case "complete": {
            finalResult = payload.result;
            break;
          }
          case "error": {
            encounteredError = payload.message;
            break;
          }
          default:
            break;
        }
      };

      let done = false;
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        buffered += decoder.decode(value ?? undefined, { stream: !done });

        let newlineIndex = buffered.indexOf("\n");
        while (newlineIndex >= 0) {
          const rawLine = buffered.slice(0, newlineIndex).trim();
          buffered = buffered.slice(newlineIndex + 1);
          if (rawLine.length > 0) {
            try {
              const parsed = JSON.parse(rawLine) as StreamPayload;
              handlePayload(parsed);
            } catch {
              throw new Error("Failed to parse streaming progress update.");
            }
          }
          newlineIndex = buffered.indexOf("\n");
        }
      }

      const remaining = buffered.trim();
      if (remaining.length > 0) {
        try {
          const parsed = JSON.parse(remaining) as StreamPayload;
          handlePayload(parsed);
        } catch {
          throw new Error("Failed to parse final streaming payload.");
        }
      }

      if (encounteredError) {
        throw new Error(encounteredError);
      }

      const completedResult = finalResult;
      if (!completedResult) {
        throw new Error("Processing ended unexpectedly without a completion event.");
      }

      const ensuredResult: ProcessedScriptResponse = completedResult;

      setProgressItems((items) =>
        items.map((item) => (item.status === "complete" ? item : { ...item, status: "complete" }))
      );
      setResult(ensuredResult);
      setStatus("success");
      const storageDescriptor =
        ensuredResult.storageMode === "s3"
          ? `uploaded to bucket ${ensuredResult.bucket ?? "unknown bucket"}`
          : `stored under ${ensuredResult.localBasePath ?? "/local-mirror"}`;
      const proxyDescriptor = ensuredResult.proxyEnabled
        ? ` using US proxy (${ensuredResult.proxiesUsed.length} endpoint${ensuredResult.proxiesUsed.length === 1 ? "" : "s"})`
        : "";
      setMessage(
        `Processed ${ensuredResult.assets.length} image${ensuredResult.assets.length === 1 ? "" : "s"} and rewrote the script (${storageDescriptor})${proxyDescriptor}.`
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      if ((error as { name?: string } | undefined)?.name === "AbortError") {
        return;
      }
      console.error(error);
      const detail = error instanceof Error ? error.message : "Unexpected error";
      setStatus("error");
      setMessage(detail);
    } finally {
      uploadAbortRef.current = null;
    }
  }

  const processing = status === "uploading";

  return (
    <div className="w-full max-w-5xl space-y-8">
      <form onSubmit={handleSubmit} className="space-y-6 rounded-xl border border-dashed border-slate-400/60 bg-white/70 p-6 shadow-sm transition hover:shadow-md dark:border-slate-600/60 dark:bg-slate-900/60">
        <div className="space-y-1">
          <label htmlFor="script" className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Upload Blood on the Clocktower Script
          </label>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Provide a JSON file that follows the official script schema (see README for details). Images referenced within the script will be downloaded and mirrored to your configured S3-compatible bucket.
          </p>
        </div>

        <div className="flex flex-col gap-3 text-sm">
          <input
            id="script"
            name="script"
            type="file"
            accept="application/json,.json"
            className="w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            disabled={processing}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label htmlFor="scriptName" className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Override Script Name (optional)
            </label>
            <input
              id="scriptName"
              name="scriptName"
              type="text"
              placeholder="e.g. Garden of Superbeings"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              disabled={processing}
            />
          </div>
          <label className="flex items-start gap-3 rounded-md border border-transparent px-2 py-1.5 text-sm transition hover:border-indigo-200 dark:hover:border-indigo-700">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600"
              checked={useProxy}
              onChange={(event) => setUseProxy(event.target.checked)}
              disabled={processing}
              name="useProxyToggle"
            />
            <span className="text-slate-700 dark:text-slate-200">
              Use US proxy for downloads
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                Helpful if source hosts geo-block UK visitors. Uncheck to fall back to direct downloads.
              </span>
            </span>
          </label>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-600 dark:text-slate-400">
            Provide S3 environment variables to upload into your bucket, or omit them to use the local mirror fallback.
          </span>
          <button
            type="submit"
            disabled={processing}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {processing ? "Processing…" : "Sync Images"}
          </button>
        </div>

        {message && (
          <div
            className={
              status === "error"
                ? "rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-950/60 dark:text-red-300"
                : "rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/60 dark:text-emerald-300"
            }
          >
            {message}
          </div>
        )}
      </form>

      {(processing || progressItems.length > 0) && (
        <section className="space-y-4 rounded-xl border border-indigo-200/70 bg-indigo-50/60 p-6 shadow-sm dark:border-indigo-800/60 dark:bg-indigo-950/40">
          <header className="space-y-1">
            <h2 className="text-base font-semibold text-indigo-900 dark:text-indigo-200">Live Progress</h2>
            <p className="text-sm text-indigo-900/80 dark:text-indigo-200/80">
              {typeof totalAssets === "number"
                ? `Mirrored ${processedCount} of ${totalAssets} asset${totalAssets === 1 ? "" : "s"}.`
                : progressItems.length > 0
                ? `Mirrored ${processedCount} asset${processedCount === 1 ? "" : "s"}.`
                : "Preparing processing plan…"}
            </p>
            {useProxy ? (
              <p className="text-xs text-indigo-900/70 dark:text-indigo-200/70">US proxy requested for this upload.</p>
            ) : null}
          </header>
          {progressItems.length > 0 ? (
            <ul className="space-y-2">
              {progressItems.map((item) => {
                const icon =
                  item.status === "complete" ? "✅" : item.status === "inProgress" ? "⏳" : "•";
                const iconClass =
                  item.status === "complete"
                    ? "text-emerald-600"
                    : item.status === "inProgress"
                    ? "text-indigo-600"
                    : "text-slate-500";
                return (
                  <li
                    key={item.key}
                    className="flex flex-col gap-2 rounded-md border border-indigo-100/80 bg-white/80 px-3 py-2 text-sm shadow-sm transition dark:border-indigo-900/40 dark:bg-slate-900/60"
                  >
                    <div className="flex items-start gap-3">
                      <span className={`text-lg leading-none ${iconClass}`}>{icon}</span>
                      <div className="flex-1 space-y-1">
                        <p className="font-medium text-slate-900 dark:text-slate-100">{item.label}</p>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                          <a
                            href={item.originalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline-offset-2 hover:underline"
                          >
                            Source
                          </a>
                          {item.status === "complete" && item.publicUrl ? (
                            <>
                              <span aria-hidden="true">•</span>
                              <a
                                href={item.publicUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline-offset-2 hover:underline"
                              >
                                Mirrored
                              </a>
                              {typeof item.size === "number" && item.size > 0 ? (
                                <span className="text-[0.7rem] text-slate-500 dark:text-slate-500/80">
                                  ({formatBytes(item.size)})
                                </span>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-300">Waiting for download tasks to begin…</p>
          )}
        </section>
      )}

      {result && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white/80 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/70">
          <header className="space-y-2">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Processing Summary</h2>
            <div className="grid gap-2 text-sm text-slate-700 dark:text-slate-300 sm:grid-cols-2">
              <div>
                <span className="font-medium">Script Name:</span> {result.scriptName}
              </div>
              <div>
                <span className="font-medium">Storage Prefix:</span> <code>{result.storagePrefix}</code>
              </div>
              <div>
                <span className="font-medium">Storage Mode:</span> {result.storageMode === "s3" ? "S3 Bucket" : "Local Disk"}
              </div>
              <div>
                {result.storageMode === "s3" ? (
                  <>
                    <span className="font-medium">Bucket:</span> <code>{result.bucket ?? "—"}</code>
                  </>
                ) : (
                  <>
                    <span className="font-medium">Mirror Path:</span> <code>{result.localBasePath ?? "/local-mirror"}</code>
                  </>
                )}
              </div>
              <div>
                <span className="font-medium">Processed At:</span> {new Date(result.processedAt).toLocaleString()}
              </div>
              <div className="sm:col-span-2">
                <span className="font-medium">Proxy Mode:</span> {result.proxyEnabled ? "US Proxy" : "Direct"}
                {result.proxyEnabled && result.proxiesUsed.length > 0 ? (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {" "}
                    ({result.proxiesUsed.length} endpoint{result.proxiesUsed.length === 1 ? "" : "s"} used)
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <a
                href={result.manifestUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-indigo-600 transition hover:border-indigo-400 hover:text-indigo-700 dark:border-slate-600 dark:text-indigo-300"
              >
                View Manifest
              </a>
              <a
                href={result.rewrittenScriptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-indigo-600 transition hover:border-indigo-400 hover:text-indigo-700 dark:border-slate-600 dark:text-indigo-300"
              >
                Download Rewritten JSON
              </a>
              <a
                href={result.originalScriptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-indigo-600 transition hover:border-indigo-400 hover:text-indigo-700 dark:border-slate-600 dark:text-indigo-300"
              >
                Download Original JSON
              </a>
              <button
                type="button"
                onClick={() => setPreviewOpen((value) => !value)}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 transition hover:border-slate-400 dark:border-slate-600 dark:text-slate-300"
              >
                {previewOpen ? "Hide" : "Show"} Updated JSON Preview
              </button>
            </div>
          </header>

          {previewOpen && (
            <pre className="max-h-64 overflow-y-auto rounded-md bg-slate-950/80 p-4 text-xs text-slate-100">
              {JSON.stringify(result.rewrittenScript, null, 2)}
            </pre>
          )}

          {result.proxiesUsed.length > 0 && (
            <div className="space-y-2 text-sm">
              <p className="font-medium text-slate-900 dark:text-slate-100">Proxy Endpoints Used</p>
              <ul className="list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-300">
                {result.proxiesUsed.map((proxyUrl) => (
                  <li key={proxyUrl} className="break-all">
                    {proxyUrl}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3">Entry</th>
                  <th className="px-4 py-3">Variant</th>
                  <th className="px-4 py-3">Field</th>
                  <th className="px-4 py-3">Content Type</th>
                  <th className="px-4 py-3">Size</th>
                  <th className="px-4 py-3">Mirrored URL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {assets.map((asset) => (
                  <tr key={`${asset.id}-${asset.variant}-${asset.field}`} className="bg-white/60 text-slate-700 transition hover:bg-indigo-50 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800/70">
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium">{asset.id}</span>
                        <a
                          href={asset.originalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-indigo-600 hover:text-indigo-500 dark:text-indigo-300"
                        >
                          Original
                        </a>
                      </div>
                    </td>
                    <td className="px-4 py-3">{asset.variant}</td>
                    <td className="px-4 py-3">{asset.field}</td>
                    <td className="px-4 py-3">{asset.contentType}</td>
                    <td className="px-4 py-3">{asset.sizeLabel}</td>
                    <td className="px-4 py-3">
                      <a
                        href={asset.publicUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-indigo-600 hover:text-indigo-500 dark:text-indigo-300"
                      >
                        {asset.publicUrl}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
