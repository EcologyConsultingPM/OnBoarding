# Generic SWMS — General ecological survey work

This upgrades the existing `ecological_field_swms` entry in Staff Forms. It does not replace the portal or change project budgets, timesheets or team allocations.

## Staff completion

The form preserves the supplied **EC-SWMS00 — General ecological survey work, Revision 1.0** wording and layout. Controlled text, tables, emergency information and training requirements are read-only. Staff complete the designated blank project/site/duration cells, relevant tick boxes, all 19 high-risk applicability Yes/No decisions and the sign-on rows used by their crew. At least one Field Lead is required; every listed crew member needs a name, role, drawn signature and date. Unused crew rows remain blank.

A high-risk tick is not permission to carry out that work. The source's limitations remain in place; applicable controlled SWMS links are provided. Conditional equipment/control boxes are not all made mandatory.

Drafts are scoped to the authenticated user and expire after eight hours in this browser tab. They are not stored under a shared localStorage key. Submission retains the completed report on screen, locks its fields and refreshes the user's own history. Retrying an unchanged submission reuses the signed timestamp and signature bytes.

## Landscape PDF and offline copy

Use **Print / Save landscape PDF**. The completed document opens separately from the portal so surrounding menus and dark dashboard styles are excluded. In the browser print dialog choose **Save as PDF**, **A4**, **Landscape**, **background graphics on**, and **browser headers/footers off**. This is browser PDF printing, not an automatic server-generated PDF download.

**Download completed HTML** saves an offline copy with embedded logo and raster signatures. Completed values and tick states are rendered as fixed record content, not empty browser inputs.

The same export controls are available for the user's own new-template submissions in Staff Forms → Submission history, and to authorised WHS reviewers in the compliance register/modal. Exporting does not change the saved record. Old submissions are not migrated, rewritten or retrospectively relabelled; a different template hash is refused rather than silently re-rendered under a newer revision.

## Technical and privacy safeguards

- New template identity: `templateVersion: 2`, `documentCode: EC-SWMS00`, `documentRevision: 1.0`, pinned original-source SHA256.
- The old model's `version: 2` does **not** activate this new template.
- Existing staff access, owner-only history, WHS reviewer gates and targeted notifications remain unchanged.
- Only allowed field values are stored. Controlled text and administrative document dates cannot be changed by staff payloads.
- New signatures pass bounded native PNG decoding. Saved signature bytes are preserved; this is not a claim to verify signatory identity.
- Existing unique owner/submission-key index prevents exact concurrent duplicates.
- No SWMS-specific database migration is required and no live test form is submitted.
- Historical WHS database permissions are not redefined by this UI/API upgrade; it preserves API-level record editing restrictions without claiming a new database-wide append-only guarantee.

## Validation

`check_general_ecological_swms_template.mjs` verifies the source hash, all controlled table cells/words, blank cells, checkbox IDs/states, valid completion, safe escaping, offline assets and landscape export. `check_general_ecological_swms_workflow.mjs` verifies real model/API behaviour, signature decoding, legacy compatibility, recipient-only history, exact/concurrent retry handling and unchanged WHS review notifications. Both are registered in the existing portal regression hook.
