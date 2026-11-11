# 12. Future improvements and research

Everything in this document is **Not built**. Cost notes are qualitative: no prices were checked,
so none are quoted.

Complexity: **S** days, **M** weeks, **L** months. Suitability: **FYP** (final-year project
extension), **Paper** (research), **Startup** (product).

## 1. Near-term fixes found during this work

| Improvement                         | Problem it fixes                                                          | Work                                                                                           | Complexity |
| ----------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------- |
| Embedding backfill                  | Reports made before duplicate detection was switched on are never matched | A SQL function or admin action that queues `embedding` for open complaints without one         | S          |
| Unlink a report from a shared case  | A wrong link needs a support fix                                          | An audited admin function that reverses `case_reports` and restores the old case               | M          |
| Notifications                       | Students only see progress by visiting the site                           | Email via a transactional provider, or WhatsApp Business; events already exist to trigger them | M          |
| Dedicated production database       | Previews and production share one project                                 | A second Supabase project (paid tier or free slot), migrations, two Vercel variables           | S          |
| In-app role management              | Staff and admins are created by script                                    | An audited admin function and screen                                                           | S          |
| Nonce-based Content Security Policy | Defence in depth against script injection                                 | Next.js middleware nonces and headers                                                          | S          |
| Update the repository README        | It predates the add-on features                                           | Documentation                                                                                  | S          |

## 2. Larger directions

### Real campus image and report collection

- **Problem:** all AI numbers are from synthetic data.
- **Technology:** the existing upload flow; a consent screen; an export for labelling.
- **Data:** a few hundred real reports and photos from one department, with consent, faces and IDs
  blurred, labelled by two people (to measure agreement).
- **Complexity:** M. **Cost:** mainly people's time; storage is small.
- **Benefit:** the first real accuracy numbers; calibrated thresholds.
- **Suitability:** FYP, Paper.

### Real-world evaluation (pilot)

- **Problem:** no evidence that the system improves outcomes.
- **Method:** a pilot in one building for a few weeks; measure time to assignment, time to
  resolution, duplicate rate, reopen rate; compare with the previous process.
- **Complexity:** M. **Suitability:** Paper, Startup.

### Fine-tuning or a smaller specialised model

- **Problem:** dependence on one provider; per-call cost at scale.
- **Technology:** fine-tune an open model or train a classic text classifier on real labelled
  reports; compare with Gemini on the same held-out set.
- **Data:** thousands of labelled real reports.
- **Complexity:** L. **Cost:** GPU time for training; hosting for inference.
- **Suitability:** Paper.

### Urdu and mixed-language reports

- **Problem:** many students will write in Urdu or Roman Urdu.
- **Technology:** Gemini already reads many languages; prompts, the safety screen and keyword
  fallback would need Urdu and Roman Urdu terms; evaluation data in those languages.
- **Complexity:** M. **Suitability:** FYP, Paper.

### Voice reporting

- **Problem:** typing on a phone is slow.
- **Technology:** speech-to-text (Gemini accepts audio, or a browser speech API), then the same
  form.
- **Complexity:** M. **Suitability:** FYP.

### Offline-first mobile experience

- **Problem:** weak campus connectivity.
- **Technology:** a Progressive Web App with a local queue that submits later; the existing
  idempotency key already prevents duplicates when it retries.
- **Complexity:** M. **Suitability:** FYP, Startup.

### Preventive maintenance

- **Problem:** fixing only after failure.
- **Technology:** schedules per equipment type; work orders generated from the equipment register;
  F6 repeat-failure alerts as inputs.
- **Complexity:** M. **Suitability:** Startup.

### Time-to-resolution prediction

- **Problem:** students and admins want an expected date.
- **Technology:** start with medians by category and department from history (SQL), then a
  regression model once real data exists.
- **Data:** months of real resolved cases.
- **Complexity:** M. **Suitability:** Paper.

### IoT equipment monitoring and sensors

- **Problem:** some faults (water leaks, power failures, overheating) can be detected before anyone
  reports them.
- **Technology:** leak sensors, smart plugs or current sensors sending events to a new API that
  opens a case automatically, labelled as sensor-generated.
- **Complexity:** L. **Cost:** hardware per room; installation; connectivity.
- **Suitability:** Paper, Startup.

### Student satisfaction analysis

- **Problem:** "closed" does not mean "satisfied".
- **Technology:** a one-question rating at confirmation; dispute notes analysed for themes.
- **Complexity:** S. **Suitability:** FYP.

### Geographic and building analytics

- **Problem:** the heatmap is schematic.
- **Technology:** real floor plans as SVG; campus map with building outlines.
- **Complexity:** M. **Suitability:** FYP.

### Better anomaly detection

- **Problem:** F6 uses fixed thresholds.
- **Technology:** statistical baselines per room and category (e.g. weekly counts compared with a
  rolling average and standard deviation), alerting on unusual spikes; keep explanations.
- **Data:** months of real history.
- **Complexity:** M. **Suitability:** Paper.

### Integration with university systems

- **Problem:** separate accounts and data.
- **Technology:** single sign-on (SAML or OpenID Connect) with university accounts; room and asset
  import from estates records.
- **Complexity:** M–L. **Suitability:** Startup.

### Multi-campus and enterprise scale

- **Problem:** one campus, one tenant.
- **Technology:** a campus column on every table and RLS by campus; paid tiers; monitoring; backups;
  an approximate vector index (HNSW) for large embedding sets.
- **Complexity:** L. **Suitability:** Startup.

## 3. The five most valuable, ranked

1. **Real data collection and a pilot evaluation.** Every other claim depends on it.
2. **Notifications.** The biggest gap in user experience.
3. **University sign-on and role management, plus a dedicated production database.** Required for
   any real deployment.
4. **Urdu and Roman Urdu support.** Required for real students in Pakistan.
5. **Embedding backfill and unlinking.** Small fixes that make F2 dependable in practice.
