/**
 * Runs once when a server instance starts. Validating configuration here makes a broken
 * deployment fail at boot rather than on the first user request (master plan §13 rule 14).
 */
export async function register(): Promise<void> {
  const { getServerConfig } = await import("@/lib/config");
  getServerConfig();
}
