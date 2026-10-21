export const REQUEST_ID_HEADER = "x-request-id";

const REQUEST_ID_PATTERN = /^req_[A-Za-z0-9]{16,64}$/;

export function createRequestId(): string {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function isRequestId(value: string): boolean {
  return REQUEST_ID_PATTERN.test(value);
}

/**
 * Reuses an inbound request ID only when it matches our own format, so a client
 * cannot inject arbitrary text into log lines; otherwise a fresh ID is issued.
 */
export function resolveRequestId(headers: Headers): string {
  const inbound = headers.get(REQUEST_ID_HEADER);
  return inbound !== null && isRequestId(inbound) ? inbound : createRequestId();
}
