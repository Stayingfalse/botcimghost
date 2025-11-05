"use client";

import { useEffect, useState } from "react";

export default function BetaNotice() {
  const [isBeta, setIsBeta] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const host = window.location.hostname.toLowerCase();

    // Check if we're on beta subdomain
    if (host.includes("beta-imghost") || host.includes("beta.")) {
      setIsBeta(true);
    }
  }, []);

  if (!isBeta) return null;

  return (
    <div className="w-full bg-gradient-to-r from-orange-500 to-orange-600 py-2 text-center text-sm font-semibold text-white shadow-md">
      <span className="inline-flex items-center gap-2">
        <svg
          className="h-4 w-4"
          fill="currentColor"
          viewBox="0 0 20 20"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
        STAGING — All script assets reset nightly
      </span>
    </div>
  );
}
