import type { AppRole } from "./roles";

export interface NavItem {
  readonly href: `/${string}`;
  readonly label: string;
}

/**
 * The areas each role can open. Navigation is a convenience only; every page enforces its own
 * role check on the server. Items are added in the phase that builds the page.
 */
export const ROLE_NAVIGATION: Readonly<Record<AppRole, readonly NavItem[]>> = {
  student: [
    { href: "/student/complaints", label: "My complaints" },
    { href: "/student/complaints/new", label: "Report an issue" },
  ],
  department: [{ href: "/department", label: "Department queue" }],
  admin: [
    { href: "/admin", label: "Overview" },
    { href: "/admin/review", label: "Review queue" },
  ],
};
