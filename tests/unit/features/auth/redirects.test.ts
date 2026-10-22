import { describe, expect, it } from "vitest";

import {
  isPathAllowedForRole,
  loginPathFor,
  postSignInPath,
  toSafeInternalPath,
} from "@/features/auth/redirects";
import { ROLE_NAVIGATION } from "@/features/auth/navigation";
import { APP_ROLES, ROLE_HOME_PATHS } from "@/features/auth/roles";

describe("toSafeInternalPath", () => {
  it.each([
    "/student/complaints",
    "/admin?tab=review",
    "/department#queue",
    "/student/complaints/3f1c9a",
  ])("keeps the same-site path %s", (path) => {
    expect(toSafeInternalPath(path)).toBe(path);
  });

  it.each([
    ["protocol-relative URL", "//evil.example/steal"],
    ["absolute URL", "https://evil.example"],
    ["javascript URL", "javascript:alert(1)"],
    ["backslash trick", "/\\evil.example"],
    ["raw tab character", "/\tevil"],
    ["leading whitespace", " /admin"],
    ["newline injection", "/admin\nSet-Cookie: x=1"],
    ["empty string", ""],
    ["relative path", "admin"],
    ["over-long path", `/${"a".repeat(600)}`],
    ["loop back to login", "/login?next=/admin"],
    ["loop back to the auth callback", "/auth/confirm?token_hash=abc"],
  ])("rejects a %s", (_label, path) => {
    expect(toSafeInternalPath(path)).toBeUndefined();
  });

  it("rejects null and undefined", () => {
    expect(toSafeInternalPath(null)).toBeUndefined();
    expect(toSafeInternalPath(undefined)).toBeUndefined();
  });

  it("normalises dot segments without escaping the site", () => {
    expect(toSafeInternalPath("/student/../admin")).toBe("/admin");
  });
});

describe("isPathAllowedForRole", () => {
  it.each([
    ["student", "/student/complaints", true],
    ["student", "/admin", false],
    ["student", "/department", false],
    ["department", "/department", true],
    ["department", "/student/complaints", false],
    ["admin", "/admin/review", true],
    ["admin", "/student/complaints", false],
    ["student", "/account/password", true],
    ["student", "/administrator-lookalike", true],
  ] as const)("%s → %s is %s", (role, path, allowed) => {
    expect(isPathAllowedForRole(path, role)).toBe(allowed);
  });
});

describe("postSignInPath", () => {
  it("honours a safe next path inside the user's own area", () => {
    expect(postSignInPath("admin", "/admin?tab=review")).toBe("/admin?tab=review");
  });

  it("ignores a next path that belongs to another role", () => {
    expect(postSignInPath("student", "/admin")).toBe(ROLE_HOME_PATHS.student);
  });

  it("ignores an unsafe next path", () => {
    expect(postSignInPath("department", "//evil.example")).toBe(ROLE_HOME_PATHS.department);
  });

  it("falls back to the role home without a next path", () => {
    for (const role of APP_ROLES) {
      expect(postSignInPath(role, undefined)).toBe(ROLE_HOME_PATHS[role]);
    }
  });
});

describe("loginPathFor", () => {
  it("encodes the page to return to", () => {
    expect(loginPathFor("/admin?tab=review")).toBe("/login?next=%2Fadmin%3Ftab%3Dreview");
  });

  it("drops an unsafe return path", () => {
    expect(loginPathFor("//evil.example")).toBe("/login");
  });
});

describe("role areas", () => {
  it("every role's home and navigation stay inside that role's area", () => {
    for (const role of APP_ROLES) {
      expect(isPathAllowedForRole(ROLE_HOME_PATHS[role], role)).toBe(true);
      for (const item of ROLE_NAVIGATION[role]) {
        expect(isPathAllowedForRole(item.href, role), `${role} → ${item.href}`).toBe(true);
      }
    }
  });

  it("no role's home is reachable by another role", () => {
    for (const role of APP_ROLES) {
      for (const other of APP_ROLES.filter((candidate) => candidate !== role)) {
        expect(isPathAllowedForRole(ROLE_HOME_PATHS[other], role)).toBe(false);
      }
    }
  });
});
