# INFORM Pitch Implementation Brief

Last updated: 2026-05-16

## 1. Pitch Strategy

This is a challenge-based hackathon, so do not spend time explaining the invoice-processing problem. The judges already know why the challenge matters.

Use the problem only as a one-sentence setup:

> Finance teams do not just need invoice extraction. They need answers they can verify, payments they can reconcile, and systems they can support.

Then move immediately into the value proposition, differentiation, live demo, competitive positioning, and business model.

## 2. Core Value Proposition

INFORM is evidence-first invoice intelligence.

It lets finance users:

- Upload an invoice PDF.
- Ask plain-language questions.
- Get grounded answers from the document.
- Click source chips to highlight the exact PDF region behind the answer.
- Reconcile invoice amounts against bank statement CSV data.

It also gives technical admins:

- Live visibility into client sessions.
- Request timelines.
- Error traces.
- Active document context.
- Safe diagnostic commands.

The product promise from the landing page is:

> Invoice Intelligence, Done Right.

The key message is that INFORM does not stop at extraction. It makes invoice AI verifiable, operational, and supportable.

## 3. Landing Page Message

The new landing page is the first pitch beat.

It communicates the product in seconds:

- Badge: Powered by Gemini 2.0 Flash.
- Headline: Invoice Intelligence, Done Right.
- Subcopy: Ask questions about invoices and get precise, grounded answers with the exact source region highlighted.
- Hero preview: chat question, grounded answer, source chip, PDF highlight, and live RAG status.
- Capability grid: RAG Q&A, visual source highlighting, bank reconciliation, refusal behavior, and live observability.
- Process section: upload, ask, see the source.

Use this page to establish that INFORM is a real product experience before showing the working app.

## 4. What Differentiates INFORM

### Evidence-First Answers

Many invoice tools extract fields. INFORM answers questions and ties every answer back to a source chunk and visible PDF region.

Pitch line:

> We do not ask users to trust the model. We show them the proof.

### Visual Verification Loop

The user can click a source chip and see the exact region highlighted on the rendered PDF.

This turns AI output into auditable evidence. It is stronger than a plain OCR table, a chatbot response, or a copied summary.

### Reconciliation Built Into The Workflow

The app does not end after answering questions. It connects invoice understanding to a real finance task: matching invoice totals against bank statement rows.

Current statuses:

- `PAID`
- `PARTIAL`
- `UNPAID`

### Role-Aware Product Design

INFORM has two experiences:

- Client dashboard: simple invoice workspace for everyday users.
- Admin dashboard: operational console for technical support.

That split is important because finance software is not only about the happy path. Teams need to debug failed uploads, refused answers, missing totals, and client confusion.

### Supportability And Observability

Backend telemetry records important events from:

- `/api/ingest`
- `/api/chat`
- `/api/query`
- `/api/reconcile`

Admins can inspect session timelines and run safe commands:

- `healthcheck`
- `trace`
- `errors`
- `sources`
- `capture-snapshot`
- `reset-context`
- `mark-reviewed`

Pitch line:

> Most demos show the user workflow. We also show how the system gets supported when something goes wrong.

### Safe Debug Terminal

The admin terminal does not execute arbitrary shell commands. It only calls allowlisted backend diagnostics.

This gives the demo a powerful technical moment without creating an unsafe product pattern.

## 5. Competitive Positioning

Do not frame INFORM as "we beat every mature AP platform today." Mature AP tools have payments, approval workflows, ERP integrations, and compliance depth.

Instead, frame INFORM as a focused wedge:

> INFORM wins where finance teams need explainable invoice intelligence, source-level verification, and support visibility.

### Competitor Categories

| Category | Examples | What They Are Good At | INFORM Differentiation |
| --- | --- | --- | --- |
| AP automation suites | BILL, Tipalti, Ramp Bill Pay, Stampli, AvidXchange | Bill intake, approvals, payments, vendor workflows | INFORM focuses on evidence-first Q&A, PDF source highlighting, and session-level admin diagnostics. |
| Intelligent document processing / OCR | Rossum, Nanonets, Docsumo, ABBYY, Kofax, Klippa, Hypatos | Extracting structured fields from invoices and documents | INFORM adds conversational invoice Q&A, clickable evidence, reconciliation, and support telemetry. |
| Generic AI document chat | ChatGPT, Gemini, Claude with PDF upload | Fast summarization and ad hoc questions | INFORM is workflow-specific: invoice chunks, PDF bounding boxes, reconciliation, refusal behavior, and admin observability. |
| Spreadsheet/manual workflows | Excel, bank CSVs, email inboxes | Flexible and familiar | INFORM reduces manual lookup and makes each answer traceable to the original document. |

### Simple Competitor Narrative

Use this wording:

> Existing AP platforms automate pieces of the invoice workflow, but they often hide the reasoning behind the output. Generic AI tools can answer questions, but they are not built for finance verification or support. INFORM combines invoice Q&A, visual evidence, reconciliation, and admin observability in one focused workflow.

## 6. Business Model

INFORM can make money as a SaaS product for small finance teams, accounting firms, and operational back-office teams that process invoices but do not want a heavy enterprise AP implementation.

### Target Customers

- Small and mid-sized businesses with recurring invoice review.
- Accounting firms that process client invoices.
- Finance operations teams that need faster invoice inspection.
- Back-office service providers that need auditability and support tooling.

### Pricing Model

Recommended pitch model:

- Subscription per organization.
- Usage tier based on monthly invoice volume.
- Admin/observability features as a premium tier.
- Optional enterprise plan for SSO, persistent audit logs, ERP integrations, and private deployment.

Example tiers for the pitch:

| Tier | Customer | Pricing Logic | Included Value |
| --- | --- | --- | --- |
| Starter | Small business | Low monthly subscription plus document limit | Upload, Q&A, source highlighting, basic reconciliation. |
| Team | Finance/accounting team | Higher document volume and more users | Shared workspace, admin console, telemetry, more reconciliation runs. |
| Enterprise | Larger finance orgs | Custom annual contract | SSO, audit logs, ERP/accounting integrations, data retention controls, private deployment. |

### Revenue Drivers

- Monthly SaaS subscriptions.
- Per-invoice processing overage.
- Premium admin diagnostics and audit history.
- Integration fees for accounting/ERP systems.
- Enterprise support and private deployment.

### Why Customers Pay

Customers pay because INFORM reduces manual invoice review time and lowers verification risk.

The value is not just "AI extraction." The value is:

- Faster answers.
- Less manual PDF searching.
- Fewer unsupported claims.
- Clear evidence for finance review.
- Faster payment matching.
- Better support when client sessions fail.

## 7. Live Demo Plan

The live demo should carry most of the pitch.

### Demo Timing

Recommended flow for a short hackathon presentation:

1. Landing page and value prop: 20-30 seconds.
2. Client workflow: 2-3 minutes.
3. Admin workflow: 1-2 minutes.
4. Competitor differentiation: 30-45 seconds.
5. Business model and close: 45-60 seconds.

### Step 1: Landing Page

Show:

- Headline: Invoice Intelligence, Done Right.
- Animated app preview.
- Source highlight preview.
- Capability grid.

Say:

> The product promise is simple: ask invoices questions, verify the answer on the original PDF, and reconcile payment data.

### Step 2: Client Sign-In

Use:

- `demo@inform.app`
- `inform2026`

Explain:

> This is the client workspace. We intentionally keep it simple: chat and reconciliation.

### Step 3: Upload Invoice

Show:

- PDF upload.
- Indexed chunk count.
- PDF appears in viewer.

Say:

> The backend parses the invoice, chunks it semantically, embeds it, and keeps the page coordinates so evidence can be highlighted later.

### Step 4: Ask Invoice Questions

Ask:

- What is the total amount due?
- Who is the vendor?
- What are the payment terms?
- List the line items.

Show:

- Grounded answer.
- Source chips.
- Clicked source highlight on PDF.

Say:

> This is our main differentiator. The answer is not just text. It is tied back to the exact place in the document.

### Step 5: Reconcile

Show:

- Bank CSV upload.
- Indexed invoice source selection.
- `PAID`, `PARTIAL`, or `UNPAID` results.

Say:

> We connect invoice intelligence to payment review, which is where the extracted data becomes operationally useful.

### Step 6: Admin Sign-In

Use:

- `admin@inform.app`
- `inform2026`

Show:

- Admin dashboard.
- Active sessions.
- Request count.
- Error count.
- Active document.
- Timeline.

Say:

> Finance tools need supportability. If a client reports a failure, the admin can inspect the session without guessing from screenshots.

### Step 7: Admin Terminal

Run:

1. `healthcheck`
2. `trace`
3. `sources`
4. `errors`
5. `capture-snapshot`

Say:

> This terminal is intentionally safe. It is not arbitrary shell access; it is a curated diagnostic layer.

## 8. Recommended Presentation Structure

### Slide 1: Product Promise

INFORM: Invoice Intelligence, Done Right.

One-liner:

> Evidence-first invoice AI for question answering, source verification, reconciliation, and support.

### Slide 2: Value Proposition

Focus on:

- Ask invoice questions in natural language.
- Verify every answer on the PDF.
- Reconcile payment data.
- Give admins live support context.

Do not spend more than 15 seconds on the known challenge context.

### Slide 3: Differentiators

Use four pillars:

- Grounded Q&A.
- Visual source highlighting.
- Reconciliation workflow.
- Admin observability.

### Slide 4: Live Demo

Use most of the presentation time here.

Show:

- Landing page.
- Client upload.
- Chat answer with source chip.
- PDF highlight.
- Reconciliation.
- Admin timeline.
- Safe diagnostics.

### Slide 5: Competitive Positioning

Explain the market in categories:

- AP automation suites.
- OCR/IDP platforms.
- Generic AI document chat.
- Manual spreadsheets.

Key line:

> We are not just extracting fields. We are making invoice AI verifiable and supportable.

### Slide 6: Business Model

Explain:

- SaaS subscription.
- Usage tiers by invoice volume.
- Premium admin/audit features.
- Enterprise integrations and private deployment.

### Slide 7: Close

Close with:

> INFORM turns invoice review from manual searching into a verified, supportable workflow.

## 9. Technical Proof Points

Use these only if asked or if there is time after the demo.

### Frontend

- Next.js 14 App Router.
- React.
- Tailwind CSS.
- Framer Motion landing page.
- NextAuth.
- PDF.js browser rendering.
- Theme toggle.
- Greek/English language toggle.

Key frontend files:

- `frontend/src/app/page.tsx`
- `frontend/src/app/login/page.tsx`
- `frontend/src/app/dashboard/page.tsx`
- `frontend/src/app/client/page.tsx`
- `frontend/src/app/admin/page.tsx`
- `frontend/src/lib/auth.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/middleware.ts`

### Backend

- FastAPI.
- Pydantic models.
- PyMuPDF chunk extraction.
- ChromaDB vector storage.
- Gemini/OpenAI-compatible API client.
- Pandas CSV parsing.
- In-memory telemetry for demo sessions.

Key backend files:

- `backend/app/main.py`
- `backend/app/models.py`
- `backend/app/routes/ingest.py`
- `backend/app/routes/chat.py`
- `backend/app/routes/query.py`
- `backend/app/routes/reconcile.py`
- `backend/app/routes/admin.py`
- `backend/app/services/telemetry.py`

## 10. Current Implementation

### Client Dashboard

The client dashboard has two tabs:

1. Chat.
2. Reconcile.

The Metrics tab was removed from the client-facing flow because it is more useful to technical users than business clients.

### Admin Dashboard

The admin dashboard lives at `/admin`.

It shows:

- Active and idle sessions.
- User identity.
- Active document.
- Request count.
- Error count.
- Recent event timeline.
- Client environment.
- Safe diagnostic terminal.

### Auth And Routes

Demo credentials:

- Client: `demo@inform.app` / `inform2026`
- Admin: `admin@inform.app` / `inform2026`

Routes:

- `/`: landing page.
- `/login`: sign-in.
- `/dashboard`: client dashboard.
- `/client`: client dashboard alias.
- `/admin`: admin dashboard.

Middleware protects `/dashboard`, `/client`, and `/admin`.

## 11. Current Limitations

Frame these as roadmap, not weaknesses.

### Reconciliation

Current reconciliation is amount-centric.

Future:

- Date tolerance.
- Invoice reference matching.
- Vendor matching.
- Confidence scores.
- Manual review workflow.

### Telemetry

Telemetry is in-memory and resets when the backend restarts.

Future:

- Persist sessions and events in Postgres, Redis, or an observability provider.

### Admin Control

`reset-context` records a marker but does not remotely reset the browser.

Future:

- Add websockets or server-sent events for live client support actions.

### Auth

Roles are demo-oriented.

Future:

- Database-backed users.
- Organization accounts.
- Admin audit logs.
- Enterprise SSO.

## 12. Short Pitch

INFORM is evidence-first invoice intelligence. A finance user can upload an invoice, ask natural-language questions, and verify every answer on the original PDF through clickable source highlights. The same workflow supports bank reconciliation, while a separate admin dashboard gives technical teams session telemetry, error traces, and safe diagnostics. INFORM is not just invoice extraction. It is a verified and supportable invoice workflow.

## 13. Technical Pitch

INFORM uses a Next.js frontend and FastAPI backend. Uploaded invoices are parsed into semantic chunks with page coordinates, embedded, and stored in ChromaDB. Chat requests retrieve relevant chunks and send them to the LLM for grounded answers. The frontend maps returned bounding boxes back onto the PDF viewer so users can verify source evidence visually. The backend records telemetry for ingest, chat, query, and reconciliation routes. Admin users can inspect sessions and run allowlisted operational diagnostics.

## 14. Money Slide Pitch

INFORM can be sold as a SaaS product for finance teams and accounting firms that need fast invoice review without a heavy AP implementation.

Revenue comes from:

- Monthly subscriptions.
- Usage tiers by invoice volume.
- Premium admin/audit features.
- ERP/accounting integrations.
- Enterprise private deployments.

The customer pays because INFORM saves review time, reduces verification risk, and gives finance teams an audit-friendly way to use AI on invoice documents.
