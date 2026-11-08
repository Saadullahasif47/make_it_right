# 10. Comparison with existing systems

**How this was checked.** The commercial product descriptions below come from the vendors' own
public pages, looked up on 2026-11-08 (links at the end). We have **not** used or tested these
products. Feature availability depends on paid plans and changes often, so treat the comparison as
**provisional** and say so if asked.

## 1. What exists already

| System                                    | What it is                                                                                                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| University complaint portals              | Web forms or email addresses run by an office; usually no routing, no status tracking for the reporter                                                                                                                       |
| **Jira Service Management** (Atlassian)   | IT and business service desk. Request types, queues, SLAs, automation, knowledge base; a virtual service agent answering in the help centre, Slack, Teams and email; AI features for triage and responses (plan-dependent)   |
| **Freshservice** (Freshworks)             | Service management for IT and other departments, including facilities; catalogs, workflows, SLAs; "Freddy AI" for ticket handling and agent assistance (plan-dependent)                                                      |
| **ServiceNow Workplace Service Delivery** | Enterprise workplace and facilities suite: case management with routing and approvals, space and reservations, maintenance; "Predictive Intelligence" machine learning to categorise and route; AI agents in recent releases |
| Dedicated CMMS / facilities tools         | Asset registers, preventive maintenance schedules, work orders, technician mobile apps                                                                                                                                       |

## 2. Feature comparison

"Yes (vendor)" means the vendor says the product does it; we did not verify it.

| Capability                                             | MakeItRight                                     | Jira Service Mgmt            | Freshservice              | ServiceNow WSD                             |
| ------------------------------------------------------ | ----------------------------------------------- | ---------------------------- | ------------------------- | ------------------------------------------ |
| Ticket submission, status, history                     | Yes                                             | Yes                          | Yes                       | Yes                                        |
| Department queues, SLAs                                | Queues yes; per-category target days for alerts | Yes (vendor)                 | Yes (vendor)              | Yes (vendor)                               |
| AI categorisation / routing                            | Yes, bounded agent + rules + DB re-check        | Yes (vendor, plan-dependent) | Yes (vendor)              | Yes (vendor, ML)                           |
| Chat / virtual agent for requesters                    | No                                              | Yes (vendor)                 | Yes (vendor)              | Yes (vendor)                               |
| Knowledge base, self-service answers                   | No                                              | Yes (vendor)                 | Yes (vendor)              | Yes (vendor)                               |
| Email / Slack / Teams channels, notifications          | No                                              | Yes (vendor)                 | Yes (vendor)              | Yes (vendor)                               |
| Mobile apps                                            | Responsive web only                             | Yes (vendor)                 | Yes (vendor)              | Yes (vendor)                               |
| Room / equipment model                                 | Yes (rooms, equipment codes)                    | Via configuration/assets     | Asset management (vendor) | Yes (vendor, spaces and assets)            |
| Photo analysis by AI                                   | Yes (F1), cautious, human-confirmed             | Not found in what we read    | Not found in what we read | Not found in what we read                  |
| Semantic duplicate suggestions with linked shared case | Yes (F2), admin decides                         | Not found in what we read    | Not found in what we read | Not found in what we read                  |
| AI before/after repair photo check                     | Yes (F4), never closes                          | Not found in what we read    | Not found in what we read | Not found in what we read                  |
| Reporter must confirm the fix                          | Yes, built into the lifecycle                   | Configurable (workflow)      | Configurable              | Configurable                               |
| Heatmap by room, recurrence alerts                     | Yes (SQL, explainable)                          | Reporting/dashboards         | Reporting/analytics       | Yes (vendor: space, proactive maintenance) |
| Preventive maintenance scheduling                      | No                                              | Not a focus                  | Not a focus               | Yes (vendor, with asset management)        |
| Integrations, SSO, enterprise admin, compliance        | No                                              | Yes                          | Yes                       | Yes                                        |
| Scale, uptime guarantees, support                      | Free tiers, no SLA                              | Yes (commercial)             | Yes (commercial)          | Yes (commercial)                           |
| Cost to a university                                   | Free tiers for the prototype                    | Per-agent licence            | Per-agent licence         | Enterprise licence                         |

"Not found in what we read" is not "the product cannot do it". These platforms are configurable,
have marketplaces, and change quickly.

## 3. What is genuinely distinctive about MakeItRight

1. **Designed for one domain:** campus maintenance reported by students, with rooms and equipment,
   rather than a general service desk configured for it.
2. **Reports vs shared cases:** several students' reports linked into one case, while each
   student keeps and confirms their own report.
3. **Visible, explainable AI controls:** every AI step is bounded (tools, budgets, schemas),
   checked by deterministic code and again in SQL, and recorded with its prompt version.
4. **Photo-based features that stay cautious:** F1 says what a photo cannot show; F4 always says no
   functional test was done and can never close a case.
5. **Evidence:** six labelled evaluation sets and scripts that run the production code path, with
   limitations written down.

## 4. What is standard practice (not our invention)

Ticket lifecycles, queues, role-based access, audit logs, SLAs, AI-assisted categorisation, and
dashboards all exist in mature products. Using an LLM to classify tickets is now common.

## 5. Where the commercial products are clearly stronger

Channels and notifications; knowledge bases and chatbots; mobile apps; integrations (email, HR,
identity providers, SSO); enterprise reporting; preventive maintenance and asset life cycles;
security certifications, support and uptime; years of real-world use.

## 6. Why build this instead of adopting one?

- **For the course:** the goal was to design and build a cloud system end to end. Configuring a
  commercial tool would not demonstrate databases, security, queues, serverless functions or AI
  integration.
- **For a university:** licences are per agent and can be expensive; a focused tool can fit a
  student-first workflow (reporter confirmation, shared cases, room-level insight). But a real
  institution could reasonably choose a commercial product for support and integrations.

## 7. What real adoption would still need

- A dedicated production database (not shared with previews) and a paid tier with backups.
- University single sign-on, role management in the app, and onboarding of real staff.
- Notifications (email or WhatsApp Business) and a mobile-friendly reporting flow.
- Urdu and mixed-language support; real-data evaluation.
- Privacy policy, data retention, consent for photos; a security review.
- Operational ownership: who monitors jobs and quotas.

## Sources

- [Jira Service Management ITSM features (Atlassian)](https://www.atlassian.com/software/jira/service-management/features/itsm)
- [Jira Service Management virtual service agent, product guide (Atlassian)](https://www.atlassian.com/software/jira/service-management/product-guide/tips-and-tricks/virtual-agent)
- [Atlassian Intelligence features in Jira Service Management (Atlassian support)](https://support.atlassian.com/jira-service-management-cloud/docs/atlassian-intelligence-features-in-jira-service-management)
- [ServiceNow Workplace Service Delivery (product page)](https://www.servicenow.com/products/workplace-service-delivery.html)
- [ServiceNow Workplace Service Delivery plans and packages](https://www.servicenow.com/products/workplace-service-delivery/pricing.html)
- [Freshservice IT collaboration (Freshworks)](https://www.freshworks.com/freshservice/it-collaboration/)
- [Freshworks AI use cases](https://www.freshworks.com/ai-use-cases/)
