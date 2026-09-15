# NSW/ACT Ecology Brief — Week of {{WEEK_OF}}

**Prepared:** {{DATE}} ({{TZ}}) · **Scan window:** {{WINDOW_START}} → {{WINDOW_END}}
**Audience:** Senior Ecologist / ecology consulting · **Jurisdictions:** NSW, ACT, Commonwealth

---

## 1. Bottom line

> Three sentences maximum. If a Senior Ecologist reads only this, what must they know?
> If nothing material changed, say exactly that here. Do not manufacture a headline.

**Overdue register items:** {{OVERDUE_COUNT}} — see §6.

---

## 2. Developments

> Only items that passed the consequentiality gate (CLAUDE.md §3).
> Ordered by severity, then by how soon they bite.
> If there are none, write: "No developments met the consequentiality threshold this week."
> and go straight to §3.

### D1 — {{TITLE}}

| | |
|---|---|
| **Jurisdiction** | NSW / ACT / Commonwealth |
| **Status** | `{{STATUS_LABEL}}` |
| **Severity** | HIGH / MEDIUM / LOW |
| **Published** | {{DATE}} |
| **Commences / effective** | {{DATE}} ({{MECHANISM}}) |
| **Applies from** | {{on lodgement / on determination / to assessments started after…}} |
| **Triggers fired** | {{T01, T03, …}} |

**What changed.** Two to four sentences. Factual. Quote the operative words where the exact
wording matters.

**Transitional treatment.** Does this affect a BDAR/BAR in preparation, one already lodged,
or one already determined? If the source is silent, say "no transitional provision located"
— not "no transitional arrangements apply".

**Projects affected.** Be specific: project types, pathways (LDA / SSD / SSI / clearing),
regions, species groups.

**Why it matters commercially.** The consulting consequence — fee, scope, programme, credit
estimate, approval risk, liability.

**Sources.**
- Primary: {{URL}} (accessed {{DATE}})
- Cross-check: {{URL}} (accessed {{DATE}})
- *(If sources conflicted, state both positions and which is more credible and why.)*

**Action.**
- [ ] {{Specific, assignable action — not "monitor"}}
- [ ] {{…}}

---

*(repeat D2, D3 … as required)*

---

## 3. Watchlist

> Drafts, consultations, future commencements, emerging practice, and unverified leads.
> **Nothing here creates an obligation today.** State that if there is any risk of confusion.

| # | Item | Jurisdiction | Status | Key date | Why it's here | Source |
|---|---|---|---|---|---|---|
| W1 | | | `DRAFT / EXHIBITED` | Submissions close {{DATE}} | | |
| W2 | | | `CONSULTATION PROPOSAL` | | | |
| W3 | | | `MADE, NOT COMMENCED` | Commences {{DATE}} | | |
| W4 | | | `UNVERIFIED` | | Announced via {{channel}}; primary source not located | |

**Carried from previous brief:** {{list, with "no change since <date>"}}
**Overdue (expected date passed, nothing published):** {{list}}

---

## 4. No material change

> One line per weekly category in `config/sources.yaml`. This is a positive statement that
> the category was checked.

- **NSW BOS / BAM / BAM-C:** {{No material change this week. Last checked {{DATE}}.}}
- **NSW legislation and instruments:** {{…}}
- **BioNet / TBDC / species data:** {{…}}
- **NSW planning system and Portal:** {{…}}
- **Commonwealth EPBC:** {{…}}
- **ACT environment and planning:** {{…}}
- **Councils (active LGAs):** {{…}}

---

## 5. Actions for this week

> Consolidated from §2. Assignable. Each one names a person or `TBA`, and a real artefact.

| # | Action | Owner | Artefact affected | By when | Register ID |
|---|---|---|---|---|---|
| A1 | | | | | ECR-#### |
| A2 | | | | | |

---

## 6. Register status

> Output of `python3 scripts/register.py report`.

- Open items: {{n}} (HIGH {{n}} / MEDIUM {{n}} / LOW {{n}})
- Effective within 30 days and not started: {{n}}
- **Overdue:** {{n}} — {{list, these are the professional-risk items}}
- HIGH severity items still unassigned after two briefs: {{list}}

---

## 7. Confidence & gaps

> Mandatory. Never omit, never leave as "nil".

**Confidence in this brief:** HIGH / MEDIUM / LOW — one line why.

**Where sources conflicted.**
- {{Item}}: {{Source A says X; Source B says Y. I prefer A because …}}
- If none: "No material conflicts identified this week."

**Where coverage was thin.**
- {{Category or source that could not be reached, was paywalled, was not updated, or where
  the agency publishes irregularly.}}

**What I could not check.**
- {{Named categories, with the reason. Never leave a category silently unchecked.}}

**What remains uncertain.**
- {{Open questions — undetermined commencement dates, unclear transitional treatment,
  unpublished supporting regulations, guidance foreshadowed but not released.}}

**Known blind spots in this method.**
- Council-level changes are only swept for active LGAs.
- Changes communicated only in assessor-portal notices, direct agency email or closed
  briefings will not be detected until they surface publicly.
- Emerging practice is inherently anecdotal and is labelled as such.

---

*Sources are recorded with access dates because agency pages are edited in place without
version history. Where a page has changed since the access date, the access date governs.*
