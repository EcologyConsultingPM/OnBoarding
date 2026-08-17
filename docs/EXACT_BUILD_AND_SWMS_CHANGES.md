# Exact Code Changes: Vercel Build and Numbered SWMS Rows

## 1. Fix the `on-boarding-ivory.vercel.app` Vercel build

The Vercel deployment fails because `next.config.js` imports `withSentryConfig` from `@sentry/nextjs`, but that package is not present in `package.json`.

Replace the whole contents of **`package.json`** with the following:

```json
{
  "name": "ecology-onboarding",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "14.2.35",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "lucide-react": "^0.383.0",
    "@supabase/supabase-js": "^2.45.4",
    "@sentry/nextjs": "^8.55.0"
  }
}
```

Then run these commands from the repository root and commit both modified files:

```bash
npm install
npm run build
git add package.json package-lock.json
git commit -m "fix: install Sentry Next.js dependency for Vercel build"
git push
```

> Do not remove `next.config.js`, `instrumentation.js`, `instrumentation-client.js`, `sentry.server.config.js` or `sentry.edge.config.js`. Installing the missing package preserves the existing monitoring setup and resolves the exact Vercel error: `Cannot find module '@sentry/nextjs'`.

## 2. Add a reusable numbered-row input component for SWMS hazards and psychosocial factors

In **`client/src/pages/Portal.tsx`** of the Ecology Staff Portal, add the following component immediately before `function WHSDraftStudioPage()` (or immediately before the WHS drafting page component if it has a slightly different name):

```tsx
type NumberedReviewRowsProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  helpText?: string;
};

function NumberedReviewRows({
  label,
  value,
  onChange,
  placeholder,
  helpText,
}: NumberedReviewRowsProps) {
  const rows = value.split("\n").length ? value.split("\n") : [""];

  const updateRow = (index: number, nextValue: string) => {
    const next = [...rows];
    next[index] = nextValue;
    onChange(next.join("\n"));
  };

  const addRow = () => onChange([...rows, ""].join("\n"));

  const removeRow = (index: number) => {
    const next = rows.filter((_, rowIndex) => rowIndex !== index);
    onChange((next.length ? next : [""]).join("\n"));
  };

  return (
    <fieldset className="numbered-review-rows">
      <legend>{label}</legend>
      {helpText ? <p>{helpText}</p> : null}

      <div className="numbered-review-row-list">
        {rows.map((row, index) => (
          <div className="numbered-review-row" key={`${label}-${index}`}>
            <span aria-hidden="true">{index + 1}</span>
            <Textarea
              value={row}
              onChange={(event) => updateRow(index, event.target.value)}
              placeholder={placeholder}
              rows={2}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove row ${index + 1}`}
              onClick={() => removeRow(index)}
            >
              <X size={16} />
            </Button>
          </div>
        ))}
      </div>

      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        <Plus size={15} /> Add row
      </Button>
    </fieldset>
  );
}
```

The existing `Portal.tsx` already imports `Plus` and `X` from `lucide-react`, and `Button`/`Textarea` are already used in the Draft Studio. No new package is needed.

## 3. Replace the existing single textarea in the WHS Draft Studio

Find this existing field in `client/src/pages/Portal.tsx`:

```tsx
<div>
  <Label>Known hazards or psychosocial factors</Label>
  <Textarea
    value={values.knownHazards}
    onChange={event => set("knownHazards", event.target.value)}
    placeholder="List known hazards. Leave unknown information blank for review prompts."
  />
</div>
```

Replace it with this:

```tsx
<NumberedReviewRows
  label={
    documentType === "psychosocial"
      ? "Known psychosocial factors"
      : "Known hazards"
  }
  value={values.knownHazards}
  onChange={(nextValue) => set("knownHazards", nextValue)}
  placeholder={
    documentType === "psychosocial"
      ? "Describe one factor, for example workload, role clarity, isolation or conflict."
      : "Describe one hazard, for example mobile plant, work near water or remote access."
  }
  helpText="Add one factor per numbered row. Unknown information must remain blank and be confirmed during competent review."
/>
```

This retains the current server contract: the values are still stored and sent as the existing newline-separated `knownHazards` string. It does not alter the controlled-document process, AI safety guardrails, offline queue rules or review workflow.

## 4. Add the CSS for readable numbered rows

Add the following to **`client/src/index.css`**:

```css
.numbered-review-rows {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding: 1rem;
  border: 1px solid rgba(59, 116, 56, 0.22);
  border-radius: 1rem;
  background: #f5f5ef;
}

.numbered-review-rows legend {
  padding: 0 0.35rem;
  color: #173920;
  font-weight: 800;
}

.numbered-review-rows > p {
  margin: -0.25rem 0 0;
  color: #52604f;
  font-size: 0.875rem;
}

.numbered-review-row-list {
  display: grid;
  gap: 0.65rem;
}

.numbered-review-row {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr) auto;
  align-items: start;
  gap: 0.65rem;
}

.numbered-review-row > span {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 999px;
  background: #3b7438;
  color: #fff;
  font-weight: 800;
}

@media (max-width: 640px) {
  .numbered-review-row {
    grid-template-columns: 1.8rem minmax(0, 1fr) auto;
    gap: 0.45rem;
  }

  .numbered-review-row > span {
    width: 1.8rem;
    height: 1.8rem;
  }
}
```

## 5. Render numbered rows in the SWMS draft preview

Where the draft preview currently renders `section.items` as a `<ul>`, use the following condition instead:

```tsx
{section.items?.length ? (
  section.heading.toLowerCase().includes("hazard") ||
  section.heading.toLowerCase().includes("psychosocial") ? (
    <ol className="draft-numbered-items">
      {section.items.map((item: string, itemIndex: number) => (
        <li key={itemIndex}>{item}</li>
      ))}
    </ol>
  ) : (
    <ul>
      {section.items.map((item: string, itemIndex: number) => (
        <li key={itemIndex}>{item}</li>
      ))}
    </ul>
  )
) : null}
```

Then add:

```css
.draft-numbered-items {
  margin: 0.75rem 0 0;
  padding-left: 1.6rem;
}

.draft-numbered-items li {
  padding: 0.35rem 0 0.35rem 0.25rem;
}

.draft-numbered-items li::marker {
  color: #3b7438;
  font-weight: 800;
}
```

[EXACT_BUILD_AND_SWMS_CHANGES.md](https://github.com/user-attachments/files/31125836/EXACT_BUILD_AND_SWMS_CHANGES.md)
