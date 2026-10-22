export const APP_ROLES = ["student", "department", "admin"] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const ROLE_LABELS: Readonly<Record<AppRole, string>> = {
  student: "Student",
  department: "Department staff",
  admin: "Administrator",
};

/** Where each role lands after signing in, and the root of the area only that role may use. */
export const ROLE_HOME_PATHS: Readonly<Record<AppRole, `/${string}`>> = {
  student: "/student/complaints",
  department: "/department",
  admin: "/admin",
};

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}
