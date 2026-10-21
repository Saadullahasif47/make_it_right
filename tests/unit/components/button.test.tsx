import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button, ButtonLink, buttonClassName } from "@/components/ui/button";

describe("Button", () => {
  it("defaults to type=button so it never submits a surrounding form by accident", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("type", "button");
  });

  it("allows an explicit submit type", () => {
    render(<Button type="submit">Send</Button>);
    expect(screen.getByRole("button", { name: "Send" })).toHaveAttribute("type", "submit");
  });

  it("calls onClick when activated with mouse or keyboard", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Retry</Button>);

    const button = screen.getByRole("button", { name: "Retry" });

    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    await user.click(button);

    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it("does not fire when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Retry
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("ButtonLink", () => {
  it("renders a real link with button styling", () => {
    render(
      <ButtonLink href="/login" variant="secondary">
        Sign in
      </ButtonLink>,
    );

    const link = screen.getByRole("link", { name: "Sign in" });
    expect(link).toHaveAttribute("href", "/login");
    expect(link.className).toContain("border-line-strong");
  });
});

describe("buttonClassName", () => {
  it("lets a caller override conflicting utilities", () => {
    const classes = buttonClassName({ size: "sm", className: "h-14" });
    expect(classes).toContain("h-14");
    expect(classes).not.toContain("h-9");
  });
});
