import {
  Building2,
  CirclePlus,
  ClipboardList,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Ticket,
  type LucideIcon,
} from "lucide-react";

import type { AppRole } from "./roles";

export interface NavItem {
  readonly href: `/${string}`;
  readonly label: string;
  /** A shorter label for the phone tab bar, where four tabs share 390 px. */
  readonly shortLabel?: string;
  readonly icon: LucideIcon;
  /** Other areas this item is the home of, e.g. the ticket pages reached from a queue. */
  readonly also?: readonly `/${string}`[];
}

/**
 * The areas each role can open. Navigation is a convenience only; every page enforces its own
 * role check on the server. Items are added in the phase that builds the page.
 */
export const ROLE_NAVIGATION: Readonly<Record<AppRole, readonly NavItem[]>> = {
  student: [
    { href: "/student/complaints", label: "My complaints", icon: ClipboardList },
    { href: "/student/complaints/new", label: "Report an issue", icon: CirclePlus },
  ],
  department: [{ href: "/department", label: "Department queue", icon: Inbox }],
  admin: [
    { href: "/admin", label: "Overview", icon: LayoutDashboard },
    { href: "/admin/tickets", label: "Tickets", icon: Ticket },
    {
      href: "/admin/review",
      label: "Review queue",
      shortLabel: "Review",
      icon: ListChecks,
      also: ["/admin/complaints"],
    },
    { href: "/admin/departments", label: "Departments", icon: Building2 },
  ],
};
