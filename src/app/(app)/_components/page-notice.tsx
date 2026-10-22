import { Notice } from "@/components/ui/notice";

const NOTICES: Readonly<Record<string, string>> = {
  "password-updated": "Your password has been updated.",
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
