"use client";

/**
 * Last-resort boundary for failures in the root layout itself. It replaces the whole
 * document, so it cannot rely on fonts or global CSS and uses inline styles only.
 */
export default function GlobalError({ retry }: { readonly retry: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#f5f7f6",
          color: "#0b1f2a",
          textAlign: "center",
          padding: "1rem",
        }}
      >
        <main>
          <h1 style={{ fontSize: "1.75rem", margin: "0 0 0.5rem" }}>MakeItRight is unavailable</h1>
          <p style={{ color: "#475a63", margin: "0 0 1.5rem" }}>
            Something went wrong while loading the app. Please try again.
          </p>
          <button
            type="button"
            onClick={retry}
            style={{
              background: "#0b7a6e",
              color: "#ffffff",
              border: 0,
              borderRadius: "0.75rem",
              padding: "0.75rem 1.25rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
