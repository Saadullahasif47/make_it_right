import { describe, expect, it } from "vitest";

import {
  newPasswordSchema,
  passwordResetRequestSchema,
  signInSchema,
  signUpSchema,
} from "@/features/auth/schemas";
import { fieldErrorsFrom } from "@/lib/forms/form-state";

describe("signUpSchema", () => {
  const valid = {
    displayName: "Aisha Khan",
    email: "Aisha@Example.test ",
    password: "campus2026ok",
  };

  it("normalises the email and accepts a valid submission", () => {
    expect(signUpSchema.parse(valid)).toEqual({ ...valid, email: "aisha@example.test" });
  });

  it.each([
    ["too short", "abc123", "Use at least 10 characters."],
    ["no digit", "onlyletters", "Include at least one number."],
    ["no letter", "1234567890", "Include at least one letter."],
    ["over 72 characters", `a1${"x".repeat(80)}`, "Use at most 72 characters."],
  ])("rejects a password that is %s", (_label, password, message) => {
    const result = signUpSchema.safeParse({ ...valid, password });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrorsFrom(result.error).password).toBe(message);
    }
  });

  it("rejects control characters in the display name", () => {
    expect(signUpSchema.safeParse({ ...valid, displayName: "Ai\u0000sha" }).success).toBe(false);
  });

  it.each(["role", "department_id", "isAdmin"])(
    "rejects an injected %s field instead of ignoring it",
    (field) => {
      expect(signUpSchema.safeParse({ ...valid, [field]: "admin" }).success).toBe(false);
    },
  );

  it("rejects an invalid email", () => {
    const result = signUpSchema.safeParse({ ...valid, email: "not-an-email" });
    expect(result.success).toBe(false);
  });
});

describe("signInSchema", () => {
  it("accepts any non-empty password (strength is checked at sign-up)", () => {
    expect(signInSchema.safeParse({ email: "a@b.test", password: "x" }).success).toBe(true);
  });

  it("requires a password", () => {
    const result = signInSchema.safeParse({ email: "a@b.test", password: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrorsFrom(result.error).password).toBe("Enter your password.");
    }
  });
});

describe("passwordResetRequestSchema", () => {
  it("only accepts an email", () => {
    expect(passwordResetRequestSchema.safeParse({ email: "a@b.test" }).success).toBe(true);
    expect(passwordResetRequestSchema.safeParse({ email: "a@b.test", extra: 1 }).success).toBe(
      false,
    );
  });
});

describe("newPasswordSchema", () => {
  it("requires the confirmation to match", () => {
    const result = newPasswordSchema.safeParse({
      password: "campus2026ok",
      confirmPassword: "campus2026no",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrorsFrom(result.error).confirmPassword).toBe("Passwords do not match.");
    }
  });
});
