/**
 * Light first. The dark theme is a choice a person makes (account menu), remembered on this
 * device, and never inferred from the operating system: an expo laptop in dark mode still shows
 * the designed light interface.
 */
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "mir-theme";

/**
 * Runs in <head> before the first paint, so a saved dark choice never flashes light first. It is
 * a fixed string with no user input, and storage failures (private mode) just leave it light.
 */
export const THEME_SCRIPT = `try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  if (theme === "dark") {
    document.documentElement.dataset.theme = "dark";
  } else {
    delete document.documentElement.dataset.theme;
  }
  try {
    if (theme === "dark") localStorage.setItem(THEME_STORAGE_KEY, "dark");
    else localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private browsing); the choice then lasts for this page only.
  }
}
