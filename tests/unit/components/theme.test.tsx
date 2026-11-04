import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  THEME_SCRIPT,
  THEME_STORAGE_KEY,
  applyTheme,
  currentTheme,
} from "@/components/theme/theme";
import { ThemeToggle } from "@/components/theme/theme-toggle";

afterEach(() => {
  delete document.documentElement.dataset.theme;
  localStorage.clear();
});

describe("light-first theme", () => {
  it("is light unless dark was chosen", () => {
    expect(currentTheme()).toBe("light");
    applyTheme("dark");
    expect(currentTheme()).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("the head script reads only the saved choice and sets only dark", () => {
    // It runs before React, so it must stay a fixed string with no user data in it.
    expect(THEME_SCRIPT).toBe(
      `try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`,
    );
  });

  it("the toggle says what it will do and switches both ways", async () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(currentTheme()).toBe("dark");
    // The label follows the page's theme, which it observes asynchronously.
    fireEvent.click(await screen.findByRole("button", { name: "Switch to light theme" }));
    expect(currentTheme()).toBe("light");
    expect(await screen.findByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument();
  });
});
