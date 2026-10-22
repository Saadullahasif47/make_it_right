import { z } from "zod";

/** Mirrors the Supabase Auth policy in supabase/config.toml (minimum 10, letters and digits). */
export const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_MAX_LENGTH = 72; // bcrypt ignores bytes beyond 72

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email address is too long.")
  .pipe(z.email("Enter a valid email address."));

const newPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`)
  .regex(/[A-Za-z]/, "Include at least one letter.")
  .regex(/[0-9]/, "Include at least one number.");

const displayName = z
  .string()
  .trim()
  .min(2, "Enter at least 2 characters.")
  .max(80, "Use at most 80 characters.")
  .regex(/^[^\p{Cc}]+$/u, "Remove unsupported characters.");

export const signInSchema = z.strictObject({
  email,
  // Existing passwords are checked by Supabase; only reject obviously empty input here.
  password: z.string().min(1, "Enter your password.").max(PASSWORD_MAX_LENGTH),
  next: z.string().max(512).optional(),
});

export const signUpSchema = z.strictObject({
  displayName,
  email,
  password: newPassword,
});

export const passwordResetRequestSchema = z.strictObject({ email });

export const newPasswordSchema = z
  .strictObject({
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
