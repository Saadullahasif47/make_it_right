# Evidence: concurrent submission load test (local)

Run `054308af` on 2026-11-03 against `http://localhost:3100` with
`scripts/load-test.mts`. Every request is a signed-in student's `POST /api/complaints` through
the full stack (session cookie, validation, database function). Latency is measured at the client,
end to end. One unmeasured warm-up request runs first.

| Concurrent submissions | Requests | Succeeded (201) | Errors | p50    | p95    | Max    | Throughput |
| ---------------------- | -------- | --------------- | ------ | ------ | ------ | ------ | ---------- |
| 1                      | 20       | 20              | 0      | 51 ms  | 147 ms | 153 ms | 14.4 req/s |
| 5                      | 20       | 20              | 0      | 71 ms  | 103 ms | 103 ms | 57.2 req/s |
| 20                     | 20       | 20              | 0      | 217 ms | 227 ms | 227 ms | 86.6 req/s |

## Idempotency under load

20 keys were each sent twice at the same instant (40 requests).

- Both requests of a pair returned the same ticket: **20 / 20**
- Exactly one request per pair reported `created: true`: **20 / 20**

## Database ground truth

- Tickets stored for the temporary students: **81** (expected 81)
- `created` audit events for those tickets: **81** (one per ticket)

The temporary students and their tickets were deleted after the run.
