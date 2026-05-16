"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[INFORM global error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f7f5f0", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem" }}>
          <div style={{ textAlign: "center", maxWidth: 360 }}>
            <p style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#e96a3d", marginBottom: "0.5rem" }}>
              Error
            </p>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 900, color: "#1a1714", marginBottom: "0.75rem" }}>
              Something went wrong
            </h1>
            <p style={{ fontSize: "0.875rem", color: "#6b6257", marginBottom: "2rem", lineHeight: 1.6 }}>
              An unexpected error occurred. Please try again.
            </p>
            <button
              onClick={reset}
              style={{ padding: "0.625rem 1.5rem", borderRadius: "0.75rem", background: "#e96a3d", color: "#1a1714", fontWeight: 700, fontSize: "0.875rem", border: "none", cursor: "pointer" }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
