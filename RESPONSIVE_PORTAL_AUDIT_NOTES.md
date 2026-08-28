# Responsive Portal Audit — WHS & EC Forms Repair

**Date:** 28 August 2026

## Verified issue

The WHS & EC Forms domain was rendered inside a simulated `desktop`/`tablet`/`mobile` device frame. The default frame was desktop, so the operational form area retained a constrained, preview-like layout rather than responding naturally to the staff member’s actual device width.

## Repair

The simulated preview frame and its fixed width constraints were removed from `WhsEcFormsDomain`. The live workspace now renders directly in the portal canvas and follows the browser viewport. The existing domain tabs and Internal Governance Back control remain unchanged.

Targeted responsive rules now provide the following layout behaviour.

| Screen range | WHS & EC Forms behaviour |
|---|---|
| Desktop, over 1040px | Full operational canvas with multi-column form and governance layouts where space permits. |
| Tablet, 761–1040px | WHS picker moves to two columns; governance metrics use three columns and content remains full-width. |
| Mobile, 481–760px | Form grids, field pairs and governance actions stack into a single readable column; tabs wrap rather than overflow. |
| Narrow mobile, 480px and below | Domain tabs become full-width and governance metrics stack into one column. |

A portal-wide shell safeguard prevents horizontal page overflow, while designated dense-data wrappers retain local horizontal scrolling rather than forcing the entire page beyond the viewport.

## Static verification

The responsive contract completed successfully. It confirmed removal of the simulated frame, full-width WHS content, 1040px/760px/480px breakpoint coverage, portal overflow protection, locally scrollable dense tables, and pre-existing general 900px/640px portal breakpoints.

## Limitation

The browser automation interface used for this check does not provide viewport resizing. The audit therefore verifies the responsive code paths and the removal of the fixed WHS frame. A final real-device visual check should be made on one tablet and one mobile phone after the review branch is deployed.
