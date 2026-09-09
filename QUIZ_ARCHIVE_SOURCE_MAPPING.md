# Core Training Quiz Source Mapping

**Source:** The user-supplied `Quiz's(2).zip` archive, received on 28 August 2026.

The archive was integrity-tested and passively converted. It contains 122 PDFs, arranged by career level and module. Forty-one modules now have a complete questionnaire and marker guide, yielding forty 40-question interactive assessments plus one 50-question assessment. Their distribution is Basics (1), Early Career (19), Mid Level (5), Senior Level (5), Additional NSW Reporting & Biodiversity Pathways (6), and Business Operations (5).

The staff Learning & Development hierarchy already includes **01 Core Training Modules**. The interactive module browser opens from this existing folder and displays the supplied career-level group before the named module/topic.

**M09 marker key received:** `M09 Threatened Fauna and Flora Species Identification` is now published as an interactive Early Career quiz. Its separately supplied marker key was matched to the questionnaire and contains 50 answers; it uses the source threshold of **32/50**.

Question text is packaged separately from the answer-key/rationale data. The answer key is loaded only in the protected server endpoint after a deliberate staff submission.

## Approved autosave persistence

On 28 August 2026, the portal owner expressly approved and the connected Ecology Consulting Supabase project received the additive `core_training_quiz_autosave` migration. The new `core_training_quiz_drafts` table exists with row-level security enabled and three indexes. It stores only unsent answers for the signed-in staff member and is deleted by the protected server endpoint after a deliberate assessment submission.
