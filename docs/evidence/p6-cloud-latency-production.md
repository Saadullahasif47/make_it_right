# Evidence: live cloud latency (production)

Measured on 2026-11-03 from the developer's machine (Pakistan) against
`https://makeitright-takeasy1.vercel.app` (deployment `bce1355`, production) with `scripts/cloud-latency.mts`.
Read-only: public endpoints only, no accounts and no data written. Latency includes the network
round trip from the client to Vercel. One unmeasured warm-up request precedes each probe.

| Endpoint                          | Concurrent | Requests | Errors | p50    | p95    | Max     |
| --------------------------------- | ---------- | -------- | ------ | ------ | ------ | ------- |
| GET /api/health                   | 1          | 20       | 0      | 338 ms | 389 ms | 396 ms  |
| GET /api/health                   | 5          | 20       | 0      | 336 ms | 542 ms | 982 ms  |
| GET /api/health                   | 20         | 20       | 0      | 504 ms | 538 ms | 543 ms  |
| GET /login                        | 1          | 20       | 0      | 386 ms | 604 ms | 611 ms  |
| GET /login                        | 5          | 20       | 0      | 430 ms | 842 ms | 1663 ms |
| GET /login                        | 20         | 20       | 0      | 589 ms | 933 ms | 1126 ms |
| POST /api/complaints (signed out) | 1          | 20       | 0      | 350 ms | 411 ms | 476 ms  |
| POST /api/complaints (signed out) | 5          | 20       | 0      | 332 ms | 874 ms | 874 ms  |
| POST /api/complaints (signed out) | 20         | 20       | 0      | 512 ms | 868 ms | 953 ms  |

"Errors" counts any response other than the expected status (200, or 401 for the signed-out
submission, which proves the function ran its session check).
