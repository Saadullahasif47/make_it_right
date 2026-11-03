import { Notice } from "@/components/ui/notice";

const NOTICES: Readonly<Record<string, string>> = {
  "password-updated": "Your password has been updated.",
  "department-activated": "Department activated. It can receive tickets and routing rules again.",
  "department-deactivated": "Department deactivated. It no longer receives new tickets.",
  "department-deactivated-routes":
    "Department deactivated. Categories routed to it now go to the review queue until you choose another department below.",
  "routing-saved": "Routing rule saved. New reports in this category follow it straight away.",
  "no-change": "Nothing changed: that is already the current setting.",
};

/** Renders a one-off confirmation passed via `?notice=`; unknown values render nothing. */
export async function PageNotice({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).notice;
  const text = NOTICES[Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "")];
  return text === undefined ? null : <Notice tone="success">{text}</Notice>;
}
