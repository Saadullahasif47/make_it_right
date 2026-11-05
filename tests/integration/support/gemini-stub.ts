import { spawn, type ChildProcess } from "node:child_process";

/** The port the local worker's GEMINI_BASE_URL points at (supabase/config.toml). */
export const STUB_PORT = 3199;
const HEALTH = `http://127.0.0.1:${String(STUB_PORT)}/health`;

async function healthy(): Promise<boolean> {
  try {
    return (await fetch(HEALTH, { signal: AbortSignal.timeout(1_000) })).ok;
  } catch {
    return false;
  }
}

/**
 * Makes sure the Gemini stub (tests/support/gemini-stub.mts) is listening, starting it if
 * needed. Returns a function that stops only a stub this call started.
 */
export async function ensureGeminiStub(): Promise<() => void> {
  if (await healthy()) {
    return () => undefined;
  }
  const child: ChildProcess = spawn(
    process.execPath,
    // CI's Linux Docker reaches the host only through the bridge gateway (see the stub).
    [
      "tests/support/gemini-stub.mts",
      String(STUB_PORT),
      process.env.CI === "true" ? "0.0.0.0" : "127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await healthy()) {
      return () => {
        child.kill();
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error("the Gemini stub did not start on port 3199");
}
