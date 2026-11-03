import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toast } from "@/components/ui/toast";

/** Runs the clock; a second step lets the exit transition's own timer, set after a re-render, run. */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  act(() => {
    vi.advanceTimersByTime(200);
  });
}

describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("announces a confirmation politely, with only the message as its text", () => {
    render(<Toast>Note added to the timeline.</Toast>);
    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent(/^Note added to the timeline\.$/);
  });

  it("uses an alert for errors", () => {
    render(<Toast tone="error">Could not save.</Toast>);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save.");
  });

  it("hides itself after its duration", () => {
    render(<Toast duration={4000}>Saved.</Toast>);
    act(() => {
      vi.advanceTimersByTime(3700);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    advance(300);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("waits while the pointer is over it", () => {
    render(<Toast duration={2000}>Saved.</Toast>);
    fireEvent.mouseEnter(screen.getByRole("status"));
    advance(10_000);
    expect(screen.getByRole("status")).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByRole("status"));
    advance(2500);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("can be dismissed straight away", () => {
    render(<Toast duration={60_000}>Saved.</Toast>);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    advance(0);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
