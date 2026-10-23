import { describe, expect, it } from "vitest";

import { activeHref } from "@/features/auth/components/nav-links";
import { ROLE_NAVIGATION } from "@/features/auth/navigation";

describe("activeHref", () => {
  const student = ROLE_NAVIGATION.student;

  it.each([
    ["/student/complaints", "/student/complaints"],
    ["/student/complaints/new", "/student/complaints/new"],
    ["/student/complaints/0b7a6e00-0000-4000-8000-000000000001", "/student/complaints"],
    ["/student/complaintsx", undefined],
    ["/admin", undefined],
  ])("on %s the current tab is %s", (pathname, expected) => {
    expect(activeHref(pathname, student)).toBe(expected);
  });
});
