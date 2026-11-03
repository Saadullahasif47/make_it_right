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
    expect(headings[0]).toHaveTextContent("A better way to get campus problems fixed.");
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
      "A better way to get campus problems fixed.",
      "What you can report",
      "How a report gets resolved",
      "Built for the people who fix things",
      "AI that helps, without taking control",
      "One platform, three clear roles",
      "Spotted something broken on campus?",
    ]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
  });

  it("sends every report call-to-action to the report form (sign-in happens on the way)", () => {
    render(<HomePage />);

    const ctas = screen.getAllByRole("link", { name: /report an issue/i });
    expect(ctas.length).toBeGreaterThan(0);
    for (const cta of ctas) {
      expect(cta).toHaveAttribute("href", "/student/complaints/new");
    }
  });

  it("hides the decorative product mock-ups from assistive technology", () => {
    render(<HomePage />);
    for (const text of ["MIR-1024", "MIR-1031"]) {
      expect(screen.getByText(text).closest("[aria-hidden='true']")).not.toBe(null);
    }
  });

  it("labels the product preview's numbers as example data", () => {
    render(<HomePage />);
    expect(screen.getByText(/^Example data\./)).toBeInTheDocument();
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
