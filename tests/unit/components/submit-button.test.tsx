import { render, screen, within } from "@testing-library/react";
import type * as ReactDom from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SubmitButton } from "@/components/ui/submit-button";

const formStatus = vi.hoisted(() => ({ pending: false }));

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactDom>()),
  useFormStatus: () => ({ pending: formStatus.pending }),
}));

function renderButton() {
  return render(
    <form>
      <SubmitButton pendingLabel="Submitting…">Submit report</SubmitButton>
    </form>,
  );
}

afterEach(() => {
  formStatus.pending = false;
});

describe("SubmitButton feedback", () => {
  it("when idle, is named by its label and announces nothing", () => {
    renderButton();
    const button = screen.getByRole("button");
    expect(button).toBeEnabled();
    expect(document.querySelector("[aria-live=polite]")).toBeEmptyDOMElement();
    // The pending layer is present but hidden, which is what keeps the width stable.
    expect(within(button).getByText("Submitting…").closest(".invisible")).not.toBeNull();
    expect(within(button).getByText("Submit report").closest(".invisible")).toBeNull();
  });

  it("when pending, keeps both labels in place, swaps which is visible, and announces it", () => {
    formStatus.pending = true;
    renderButton();
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(within(button).getByText("Submit report").closest(".invisible")).not.toBeNull();
    expect(within(button).getByText("Submitting…").closest(".invisible")).toBeNull();
    // Both layers share one grid cell, so the wider label sets the width in either state.
    expect(button.querySelectorAll(".col-start-1.row-start-1")).toHaveLength(2);
    expect(document.querySelector("[aria-live=polite]")).toHaveTextContent("Submitting…");
    // The spinner only fades in after a short wait, so quick saves never flash it.
    expect(button.querySelector(".animate-reveal .animate-spin")).not.toBeNull();
  });
});
