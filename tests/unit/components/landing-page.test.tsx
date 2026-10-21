import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PrototypeNotice } from "@/app/(public)/_components/prototype-notice";
import HomePage from "@/app/(public)/page";
import { CATEGORY_LABELS, COMPLAINT_CATEGORIES } from "@/features/complaints/categories";

describe("landing page", () => {
  it("has exactly one h1 that states the product purpose", () => {
    render(<HomePage />);

    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(/reported once and fixed right/i);
  });

  it("lists all six reportable categories", () => {
    render(<HomePage />);

    const region = screen.getByRole("region", { name: "What you can report" });
    const items = within(region).getAllByRole("listitem");
    expect(items).toHaveLength(COMPLAINT_CATEGORIES.length);
    for (const category of COMPLAINT_CATEGORIES) {
      expect(within(region).getByText(CATEGORY_LABELS[category])).toBeInTheDocument();
    }
  });

  it("gives every section an accessible name", () => {
    render(<HomePage />);

    for (const name of [
      /reported once and fixed right/i,
      "What you can report",
      "From report to resolved in three steps",
      "One platform, three clear roles",
      "AI that helps, without taking control",
      "Spotted something broken on campus?",
    ]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
  });

  it("sends every report call-to-action to sign-in", () => {
    render(<HomePage />);

    const ctas = screen.getAllByRole("link", { name: /report an issue/i });
    expect(ctas.length).toBeGreaterThan(0);
    for (const cta of ctas) {
      expect(cta).toHaveAttribute("href", "/login");
    }
  });

  it("hides the decorative ticket mock-up from assistive technology", () => {
    render(<HomePage />);
    expect(screen.queryByText("MIR-2041 · Electrical")?.closest("[aria-hidden='true']")).not.toBe(
      null,
    );
  });
});

describe("PrototypeNotice", () => {
  it("states this is not an official channel and asks for fictional data", () => {
    render(<PrototypeNotice />);

    const note = screen.getByRole("note", { name: "Prototype notice" });
    expect(note).toHaveTextContent(/not an official university reporting channel/i);
    expect(note).toHaveTextContent(/fictional/i);
  });
});
