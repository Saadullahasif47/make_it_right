"use client";

import { ImagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

import { EVIDENCE_MIME_TYPES, MAX_EVIDENCE_BYTES, isEvidenceMimeType } from "../image";

type UploadState =
  | { readonly kind: "idle" }
  | { readonly kind: "working"; readonly step: string }
  | { readonly kind: "done" }
  | { readonly kind: "error"; readonly message: string };

const GENERIC_FAILURE =
  "The photo could not be uploaded. Your report is saved; you can try adding the photo again.";

/** Reads `{ error: { message } }` from our API, which is always safe to show. */
async function apiMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "message" in body.error &&
      typeof body.error.message === "string"
    ) {
      return body.error.message;
    }
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return GENERIC_FAILURE;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface PhotoUploaderProps {
  /** The reserve endpoint; its `/finalize` sibling confirms the upload. */
  readonly endpoint: string;
  /** Extra fields for the reserve request (a repair photo's kind). */
  readonly fields?: Readonly<Record<string, string>>;
  readonly label?: string;
  readonly hint?: string;
  readonly doneMessage?: string;
}

/**
 * Adds a photo in three steps: reserve it, upload it straight to the private bucket, then
 * confirm it. Used for report photos (F1) and repair photos (F4); the report or case itself never
 * depends on this succeeding.
 */
export function PhotoUploader({
  endpoint,
  fields = {},
  label = "Add a photo",
  hint = "JPEG, PNG or WebP, up to 2 MB. Photos are private to you, the assigned department and administrators.",
  doneMessage = "Photo added. It will be analysed shortly.",
}: PhotoUploaderProps) {
  const router = useRouter();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });

  async function upload(file: File): Promise<void> {
    if (!isEvidenceMimeType(file.type)) {
      setState({ kind: "error", message: "Choose a JPEG, PNG or WebP photo." });
      return;
    }
    if (file.size === 0 || file.size > MAX_EVIDENCE_BYTES) {
      setState({ kind: "error", message: "Photos can be at most 2 MB." });
      return;
    }

    try {
      setState({ kind: "working", step: "Preparing upload…" });
      const reserved = await postJson(endpoint, {
        ...fields,
        mimeType: file.type,
        byteSize: file.size,
      });
      if (!reserved.ok) {
        setState({ kind: "error", message: await apiMessage(reserved) });
        return;
      }
      const slot = (await reserved.json()) as { attachmentId: string; uploadUrl: string };

      setState({ kind: "working", step: "Uploading photo…" });
      const stored = await fetch(slot.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type, "x-upsert": "false" },
        body: file,
      });
      if (!stored.ok) {
        setState({ kind: "error", message: GENERIC_FAILURE });
        return;
      }

      setState({ kind: "working", step: "Checking photo…" });
      const finalized = await postJson(`${endpoint}/finalize`, {
        attachmentId: slot.attachmentId,
      });
      if (!finalized.ok) {
        setState({ kind: "error", message: await apiMessage(finalized) });
        return;
      }
      setState({ kind: "done" });
      router.refresh();
    } catch {
      setState({ kind: "error", message: GENERIC_FAILURE });
    } finally {
      if (input.current !== null) {
        input.current.value = "";
      }
    }
  }

  const working = state.kind === "working";
  return (
    <div className="space-y-3">
      <input
        ref={input}
        id={inputId}
        type="file"
        accept={EVIDENCE_MIME_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file !== undefined) {
            void upload(file);
          }
        }}
      />
      <Button
        variant="secondary"
        size="sm"
        disabled={working}
        onClick={() => input.current?.click()}
        aria-describedby={`${inputId}-hint`}
      >
        <ImagePlus aria-hidden="true" className="size-4" />
        {working ? state.step : label}
      </Button>
      <p id={`${inputId}-hint`} className="text-sm text-ink-muted">
        {hint}
      </p>
      <div aria-live="polite">
        {state.kind === "done" ? <Notice tone="success">{doneMessage}</Notice> : null}
        {state.kind === "error" ? <Notice tone="error">{state.message}</Notice> : null}
      </div>
    </div>
  );
}
