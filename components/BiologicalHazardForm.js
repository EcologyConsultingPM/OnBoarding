"use client";

import { useEffect, useRef, useState } from "react";
import SignaturePad from "./SignaturePad";
import BiologicalHazardRegister from "./BiologicalHazardRegister";
import {
  BIOLOGICAL_CATEGORIES,
  BIOLOGICAL_DOCUMENT_CODE,
  BIOLOGICAL_DOCUMENT_REVISION,
  BIOLOGICAL_FIELD_SECTIONS,
  createEmptyBiologicalHazardForm,
  normaliseBiologicalHazardDetails,
} from "../lib/biologicalHazardRegister";
import styles from "./BiologicalHazardRegister.module.css";

const API = "/api/biological-hazards";
const DRAFT_TTL = 8 * 60 * 60 * 1000;
const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const CATEGORY_GUIDANCE = {
  obs: ["Hazard seen; no known exposure", "Ticks observed on vegetation; leech concentration at creek crossing"],
  pot: ["Work occurred in an area or task with exposure potential, but no known bite or contact", "Working in dense tick habitat; sampling near contaminated water"],
  exp: ["Actual or suspected contact with a biological hazard", "Attached tick; leech attachment; splash to intact skin"],
  inj: ["Exposure resulted in injury, symptoms or illness", "Bite with wound; sting reaction; suspected infection"],
  nm: ["No harm occurred, but controls failed or harm could have occurred", "No satellite communication at a remote site; PPE failure"],
};
const SECTION_NUMBERS = { bio_date: 2, bio_haz: 3, bio_hot: 4, bio_dur: 5, bio_extype: 6, bio_sym: 7, bio_fail: 8, bio_ca: 10, bio_fu: 11 };
const SECTION_HINTS = {
  4: "Sightings and concentrations without a bite. Thirty ticks on a survey with no bite is still exposure information — it may show the controls are not enough for that site.",
  5: "Work happened where contact was possible, but nobody knows of a bite or contact. Recording this lets us see which tasks and sites carry the most exposure.",
  6: "Actual or suspected contact. Record what was attached or touched, where, and the first aid given. These choices record actions taken; they are not first aid instructions. Follow your training and the Site-Specific ERP; do not delay first aid to complete this record.",
  7: "Exposure that caused a wound, symptoms or illness. Any incident needing medical treatment is also reported through the Incident Report form.",
  8: "No one was harmed, but a control failed or harm could easily have happened. Record the failure and potential outcome.",
  10: "Every exposure, injury and near miss needs a decision on whether controls change. Observations need one where the site is a hotspot.",
  11: "Ticks and some bites can cause illness weeks later. Check in with the worker and record the outcome before closing. Final follow-up and closure are managed by an authorised reviewer.",
};
const PLACEHOLDERS = {
  bio_worker: "Person affected or observing", bio_rec: "If different from the worker", bio_proj: "Project name or job number",
  bio_loc: "Site, property or general location", bio_coord: "Lat, long or GPS waypoint", bio_ident: "e.g. paralysis tick, land leech",
  bio_num: "Count or estimate", bio_rep: "Product and time applied", bio_extent: "e.g. 50 m of creek crossing",
  bio_rec_ctrl: "e.g. avoid crossing after rain; gaiters mandatory; reroute access track", bio_dur: "e.g. 3 hours",
  bio_why: "Habitat, task, conditions", bio_fadet: "What was done, by whom, and when",
  bio_meddet: "What the doctor or hospital found and advised", bio_action: "Additional or changed controls",
};

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function draftKey(userId) { return `ecology-consulting:biological-hazard:${userId}`; }
function sectionNumber(section) {
  const first = (section.fields || []).find((field) => SECTION_NUMBERS[field.key]);
  return first ? SECTION_NUMBERS[first.key] : Number(String(section.title).match(/^\s*(\d+)/)?.[1] || section.id);
}
function sectionTitle(section) {
  const number = sectionNumber(section);
  return /^\s*\d+\./.test(section.title) ? section.title : `${number}. ${section.title}`;
}
function applies(section, category) { return !section.categories?.length || section.categories.includes(category); }
function errorMessages(errors) {
  if (!errors) return [];
  if (Array.isArray(errors)) return errors.map((error) => typeof error === "string" ? error : error.message || error.error || "Check the highlighted form fields.");
  return Object.values(errors).flat().map(String);
}
async function responseData(response, fallback) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || fallback);
  return data;
}

// Re-encoding pixels removes EXIF/GPS metadata. Never persist the file or preview bytes.
async function preparePhoto(file, clientId) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPEG, PNG or WebP photograph (not SVG or HEIC).");
  if (file.size > MAX_PHOTO_BYTES) throw new Error("Each original photograph must be 8 MB or smaller.");
  let image;
  let objectUrl;
  try {
    if (typeof createImageBitmap === "function") image = await createImageBitmap(file);
    else {
      objectUrl = URL.createObjectURL(file);
      image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("This photograph could not be decoded. Choose another image."));
        img.src = objectUrl;
      });
    }
    const width = image.width || image.naturalWidth;
    const height = image.height || image.naturalHeight;
    if (!width || !height) throw new Error("This photograph could not be decoded.");
    const scale = Math.min(1, 1600 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photo preparation is unavailable in this browser.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size > MAX_PHOTO_BYTES) throw new Error("The photograph could not be prepared within the 8 MB limit.");
    const uploadName = `biological-${clientId}.jpg`;
    const prepared = new File([blob], uploadName, { type: "image/jpeg" });
    return { id: clientId, name: file.name, originalSize: file.size, uploadName, file: prepared, preview: URL.createObjectURL(prepared), status: "pending", error: "" };
  } finally {
    image?.close?.();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function Field({ field, form, onChange, disabled }) {
  const value = form.fields[field.key] ?? "";
  const required = field.required || (field.key === "bio_ident" && form.fields.bio_haz === "Other (describe)") ||
    (field.key === "bio_ca" && (["exp", "inj", "nm"].includes(form.category) || String(form.fields.bio_hot).startsWith("Yes"))) ||
    (["bio_action", "bio_owner", "bio_due"].includes(field.key) && form.fields.bio_ca === "Yes");
  const options = (field.options || []).map((option) => typeof option === "string" ? { value: option, label: option } : option);
  const isMultiple = ["chips", "checkboxes", "multiselect", "multi-select", "checkbox-group", "checkboxGroup"].includes(field.type) || Array.isArray(value);
  if (isMultiple) {
    const selected = Array.isArray(value) ? value : [];
    return <fieldset className={`${styles.choiceField} ${styles.wide}`} disabled={disabled}>
      <legend>{field.label}{required && <span className={styles.required}> *</span>}</legend>
      <div className={styles.chips}>{options.map((option, index) => <label key={option.value} className={styles.checkboxLabel}>
        <input type="checkbox" id={`bio-field-${field.key}-${index}`} checked={selected.includes(option.value)} onChange={(event) => onChange(field.key, event.target.checked ? [...selected, option.value] : selected.filter((item) => item !== option.value))} />
        <span>{option.label}</span>
      </label>)}</div>
    </fieldset>;
  }
  const props = { id: `bio-field-${field.key}`, value, required: !!required, disabled, onChange: (event) => onChange(field.key, event.target.value) };
  return <div className={`${styles.field} ${field.type === "textarea" ? styles.wide : ""}`}>
    <label htmlFor={props.id}>{field.label}{required && <span className={styles.required}> *</span>}</label>
    {field.type === "select" ? <select {...props}><option value="">Select…</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> :
      field.type === "textarea" ? <textarea {...props} rows={3} maxLength={4000} placeholder={PLACEHOLDERS[field.key]} /> :
        <input {...props} type={["date", "time", "number", "email", "tel"].includes(field.type) ? field.type : "text"} min={field.type === "number" ? 0 : undefined} step={field.type === "number" ? 1 : undefined} maxLength={field.type === "text" ? 200 : undefined} placeholder={PLACEHOLDERS[field.key]} />}
  </div>;
}

export default function BiologicalHazardForm({ authFetch, userId, onBack, onSubmitted, onToast }) {
  const [form, setForm] = useState(createEmptyBiologicalHazardForm);
  const [submissionKey, setSubmissionKey] = useState("");
  const [loadedUser, setLoadedUser] = useState(null);
  const [restored, setRestored] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  const [photos, setPhotos] = useState([]);
  const [photoConsent, setPhotoConsent] = useState(false);
  const [declared, setDeclared] = useState(false);
  const [savedEvent, setSavedEvent] = useState(null);
  const [complete, setComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [errors, setErrors] = useState([]);
  const [error, setError] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [signatureKey, setSignatureKey] = useState(0);
  const photosRef = useRef([]);
  const draftRef = useRef(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const errorRef = useRef(null);
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const signatureRef = useRef(null);

  const persist = (patch = {}) => {
    const draft = { ...draftRef.current, ...patch };
    draftRef.current = draft;
    if (!userId || loadedUser !== userId || complete) return;
    try {
      sessionStorage.setItem(draftKey(userId), JSON.stringify({ ...draft, savedAt: Date.now(), photos: (draft.photos || []).map(({ id, name, originalSize, uploadName, status }) => ({ id, name, originalSize, uploadName, status })) }));
    } catch { setStorageWarning("Temporary draft storage is unavailable. Keep this page open until submission and photo uploads finish."); }
  };
  const commitPhotos = (next) => {
    photosRef.current = next;
    if (mountedRef.current) setPhotos(next);
    persist({ photos: next });
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      photosRef.current.forEach((photo) => { if (photo.preview) URL.revokeObjectURL(photo.preview); });
    };
  }, []);

  useEffect(() => {
    if (!userId) { setLoadedUser(null); return; }
    let draft;
    try {
      const raw = sessionStorage.getItem(draftKey(userId));
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && Number(saved.savedAt) > Date.now() - DRAFT_TTL && Number(saved.savedAt) <= Date.now() && /^[0-9a-f-]{36}$/i.test(saved.submissionKey || "")) draft = saved;
        else sessionStorage.removeItem(draftKey(userId));
      }
    } catch { setStorageWarning("Temporary draft storage is unavailable. Keep this page open until submission finishes."); }
    const empty = createEmptyBiologicalHazardForm();
    const nextForm = draft?.form ? {
      ...empty,
      category: BIOLOGICAL_CATEGORIES.some((category) => category.value === draft.form.category) ? draft.form.category : "",
      fields: Object.fromEntries(Object.entries(empty.fields).map(([key, value]) => [key, draft.form.fields?.[key] ?? value])),
      declaration: { ...empty.declaration, ...draft.form.declaration },
    } : empty;
    const nextPhotos = (draft?.photos || []).slice(0, MAX_PHOTOS).map((photo) => ({ ...photo, status: photo.status === "uploaded" ? "uploaded" : "missing", error: "", file: null, preview: "" }));
    photosRef.current.forEach((photo) => { if (photo.preview) URL.revokeObjectURL(photo.preview); });
    photosRef.current = nextPhotos;
    const key = draft?.submissionKey || uuid();
    setForm(nextForm); setPhotos(nextPhotos); setSubmissionKey(key); setSavedEvent(draft?.savedEvent || null);
    setDeclared(!!draft?.declared); setPhotoConsent(!!draft?.photoConsent); setComplete(false); setErrors([]); setError("");
    setRestored(!!draft); setLoadedUser(userId); setSignatureKey((current) => current + 1);
    draftRef.current = { form: nextForm, submissionKey: key, savedEvent: draft?.savedEvent || null, photos: nextPhotos, declared: !!draft?.declared, photoConsent: !!draft?.photoConsent };
  }, [userId]);

  useEffect(() => {
    if (loadedUser === userId && userId && !complete) persist({ form, submissionKey, savedEvent, photos, declared, photoConsent });
    // Draft writes are synchronous so a saved event ID survives navigation immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, submissionKey, savedEvent, photos, declared, photoConsent, loadedUser, userId, complete]);

  useEffect(() => {
    const warn = (event) => {
      if (busyRef.current || photosRef.current.some((photo) => photo.status !== "uploaded" && photo.file)) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  useEffect(() => { if (error || errors.length) errorRef.current?.focus(); }, [error, errors]);

  const setField = (key, value) => setForm((current) => ({ ...current, fields: { ...current.fields, [key]: value } }));
  const setDeclaration = (key, value) => setForm((current) => ({ ...current, declaration: { ...current.declaration, [key]: value } }));
  const captureSignature = (signature) => {
    if (!signature) { setDeclaration("signature", ""); return; }
    const canvas = signatureRef.current?.querySelector("canvas");
    const context = canvas?.getContext("2d");
    if (!context) return;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = false;
    for (let index = 3; index < pixels.length; index += 4) { if (pixels[index] > 0) { ink = true; break; } }
    setDeclaration("signature", ink ? signature : "");
  };
  const chooseCategory = (category) => {
    setForm((current) => {
      const fields = { ...current.fields };
      const defaults = createEmptyBiologicalHazardForm().fields;
      BIOLOGICAL_FIELD_SECTIONS.filter((section) => !applies(section, category)).forEach((section) => section.fields.forEach((field) => { fields[field.key] = defaults[field.key] ?? ""; }));
      return { ...current, category, fields };
    });
    setErrors([]);
  };

  const addPhotos = async (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selectedFiles.length || busyRef.current || preparing) return;
    setPreparing(true); setPhotoError("");
    const failures = [];
    try {
      for (const file of selectedFiles) {
        const existing = photosRef.current.find((photo) => photo.status !== "uploaded" && !photo.file && photo.name === file.name && (!photo.originalSize || photo.originalSize === file.size));
        if (!existing && photosRef.current.length >= MAX_PHOTOS) { failures.push(`${file.name}: no more than five photographs may be attached.`); continue; }
        if (savedEvent && !existing) { failures.push(`${file.name}: reselect a pending photograph by its original file name. This report has already been signed and saved.`); continue; }
        try {
          const preparedPhoto = await preparePhoto(file, existing?.id || uuid());
          if (!mountedRef.current) { URL.revokeObjectURL(preparedPhoto.preview); break; }
          if (existing) preparedPhoto.uploadName = existing.uploadName;
          commitPhotos(existing ? photosRef.current.map((photo) => photo.id === existing.id ? preparedPhoto : photo) : [...photosRef.current, preparedPhoto]);
        } catch (failure) { failures.push(`${file.name}: ${failure.message || "Could not prepare this photograph."}`); }
      }
      if (mountedRef.current) setPhotoError(failures.join(" "));
    } finally { if (mountedRef.current) setPreparing(false); }
  };
  const removePhoto = (id) => {
    if (savedEvent || busyRef.current) return;
    const photo = photosRef.current.find((item) => item.id === id);
    if (photo?.preview) URL.revokeObjectURL(photo.preview);
    commitPhotos(photosRef.current.filter((item) => item.id !== id));
  };

  const finish = (event) => {
    try { sessionStorage.removeItem(draftKey(userId)); } catch {}
    setComplete(true); setError(""); setErrors([]);
    window.dispatchEvent(new CustomEvent("biological-register-updated", { detail: { eventId: event.id } }));
    onToast?.("Biological hazard report and all selected photographs submitted.");
    onSubmitted?.(event);
  };

  const uploadPending = async (event) => {
    const pending = photosRef.current.filter((photo) => photo.status !== "uploaded");
    if (!pending.length) { finish(event); return; }
    // Reconcile an uncertain prior response before retrying; a stored attachment must not be uploaded twice.
    const record = await responseData(await authFetch("GET", `${API}/${encodeURIComponent(event.id)}?scope=mine`), "Could not check existing photographs. No retry uploads were attempted.");
    const existingNames = new Set((record.photos || []).map((photo) => photo.file_name));
    commitPhotos(photosRef.current.map((photo) => existingNames.has(photo.uploadName) ? { ...photo, status: "uploaded", error: "" } : photo));
    const failures = [];
    for (const photo of photosRef.current.filter((item) => item.status !== "uploaded")) {
      if (!photo.file) { failures.push(`${photo.name}: reselect this photograph; image bytes are not retained after leaving the page.`); continue; }
      commitPhotos(photosRef.current.map((item) => item.id === photo.id ? { ...item, status: "uploading", error: "" } : item));
      try {
        const multipart = new FormData();
        multipart.append("file", photo.file, photo.uploadName);
        await responseData(await authFetch("POST", `${API}/${encodeURIComponent(event.id)}/photos?scope=mine`, multipart), "Photograph was not confirmed as attached.");
        commitPhotos(photosRef.current.map((item) => item.id === photo.id ? { ...item, status: "uploaded", error: "" } : item));
      } catch (failure) {
        const message = failure.message || "Photograph was not confirmed as attached.";
        failures.push(`${photo.name}: ${message}`);
        commitPhotos(photosRef.current.map((item) => item.id === photo.id ? { ...item, status: "failed", error: message } : item));
      }
    }
    window.dispatchEvent(new CustomEvent("biological-register-updated", { detail: { eventId: event.id } }));
    if (failures.length) throw new Error(`The signed report ${event.register_number || ""} is saved. Some photographs are not confirmed as attached. ${failures.join(" ")} Retry below; the existing report will be reused.`);
    finish(event);
  };

  const submit = async (domEvent) => {
    domEvent?.preventDefault();
    if (busyRef.current || preparing || loadedUser !== userId) return;
    setError(""); setErrors([]);
    if (!userId || !authFetch || !submissionKey) { setError("Sign in before submitting this report."); return; }
    let details;
    if (!savedEvent) {
      const checked = normaliseBiologicalHazardDetails(form);
      const problems = errorMessages(checked.errors);
      if (!declared) problems.push("Confirm the declaration before submitting.");
      if (photosRef.current.length && !photoConsent) problems.push("Confirm that photographs are appropriate and the affected person agrees.");
      if (photosRef.current.some((photo) => !photo.file && photo.status !== "uploaded")) problems.push("Reselect or remove the missing photographs before submitting.");
      if (problems.length) { setErrors(problems); return; }
      details = checked.details;
    }
    busyRef.current = true; setSubmitting(true);
    try {
      let event = savedEvent;
      if (!event) {
        const data = await responseData(await authFetch("POST", API, { details, submission_key: submissionKey }), "The report could not be submitted. Your draft and retry key have been retained.");
        if (!data.event?.id) throw new Error("The server did not confirm a report ID. Retry with this same draft; no new retry key will be generated.");
        event = data.event;
        const signedDetails = event.details || details;
        setSavedEvent(event); setForm(signedDetails);
        persist({ savedEvent: event, form: signedDetails });
        window.dispatchEvent(new CustomEvent("biological-register-updated", { detail: { eventId: event.id } }));
      }
      await uploadPending(event);
    } catch (failure) { if (mountedRef.current) setError(failure.message || "Submission was not completed. Your draft has been retained."); }
    finally { busyRef.current = false; if (mountedRef.current) setSubmitting(false); }
  };

  const startAnother = () => {
    photosRef.current.forEach((photo) => { if (photo.preview) URL.revokeObjectURL(photo.preview); });
    photosRef.current = []; setPhotos([]); setForm(createEmptyBiologicalHazardForm()); setSubmissionKey(uuid()); setSavedEvent(null);
    setPhotoConsent(false); setDeclared(false); setRestored(false); setErrors([]); setError(""); setPhotoError(""); setComplete(false); setSignatureKey((current) => current + 1);
  };
  const back = () => {
    if (submitting || preparing) return;
    if (photosRef.current.some((photo) => photo.file && photo.status !== "uploaded") && !window.confirm("Your temporary text draft will remain in this tab, but pending photographs must be reselected when you return. Leave this form?")) return;
    onBack?.();
  };
  const medicalTreatment = form.category === "inj" && !!form.fields.bio_med && form.fields.bio_med !== "Not required";
  const visibleSections = BIOLOGICAL_FIELD_SECTIONS.filter((section) => applies(section, form.category) && ![1, 9, 12].includes(sectionNumber(section)));
  const disabled = submitting || preparing || !!savedEvent;
  const renderSection = (section) => <section className={styles.card} key={section.id} aria-labelledby={`bio-section-${section.id}`}>
    <header className={styles.sectionHeader}><h2 id={`bio-section-${section.id}`}>{sectionTitle(section)}</h2>{[2, 3].includes(sectionNumber(section)) && <span className={styles.badge}>Mandatory</span>}</header>
    <div className={styles.cardBody}>
      {SECTION_HINTS[sectionNumber(section)] && <p className={styles.hint}><strong>How to complete — </strong>{SECTION_HINTS[sectionNumber(section)]}</p>}
      {sectionNumber(section) === 2 && <p className={styles.hint}>Register ID: <strong>{savedEvent?.register_number || "Assigned by the server on submission"}</strong></p>}
      <div className={styles.fieldGrid}>{section.fields.filter((field) => !["bio_id", "bio_status", "bio_closer", "bio_dname", "bio_ddate"].includes(field.key)).map((field) => <Field key={field.key} field={field} form={form} onChange={setField} disabled={disabled} />)}</div>
      {sectionNumber(section) === 10 && <p className={styles.hint}>Status starts as <strong>Open</strong>. Only authorised reviewers can change status or close the record.</p>}
      {sectionNumber(section) === 7 && medicalTreatment && <div className={styles.notice} role="note"><strong>Lodge an Incident Report — </strong>Medical treatment has been recorded, so this event must also go through the separate Incident Report form. The WHS Officer decides whether it is notifiable; this register does not make that determination.</div>}
    </div>
  </section>;

  return <div className={styles.root}>
    <header className={styles.hero}>
      <div className={styles.toolbar}>{onBack && <button type="button" className={styles.secondary} onClick={back} disabled={submitting || preparing}>← WHS & Field forms</button>}<span className={styles.documentCode}>{BIOLOGICAL_DOCUMENT_CODE} · Rev {BIOLOGICAL_DOCUMENT_REVISION}</span></div>
      <p className={styles.eyebrow}>Biological hazards · field register</p>
      <h1>Biological Hazard and Hotspot Register</h1>
      <p>Record every biological hazard event — a sighting, a possible exposure, an actual contact, an injury or illness, or a control that failed. Complete it on site where you can, and always the same day.</p>
      <p className={styles.documentMeta}>Supports EC-WHS-BIO-001 · Ecology Consulting</p>
    </header>
    <div className={styles.body}>
      {complete ? <section className={styles.success} aria-live="polite"><h2>Report submitted</h2><p><strong>{savedEvent?.register_number}</strong> has been saved to the private register, together with all {photos.length ? `${photos.length} selected photograph${photos.length === 1 ? "" : "s"}` : "selected evidence (no photographs)"}. Your temporary draft has been cleared.</p><p>Reviewers manage follow-up and closure. You can view your own record below.</p><button type="button" className={styles.primary} onClick={startAnother}>Start another report</button></section> : <>
        <div className={styles.notice}><strong>Purpose — </strong>One register for every biological hazard event in the field, from a sighting with no contact through to an illness needing medical care. Choosing the category shows only the fields that apply. Repeated reports contribute to location and project hotspot indicators.</div>
        <p className={styles.hint}>{savedEvent ? `The signed report ${savedEvent.register_number || ""} is already saved and cannot be edited here. Complete or retry the remaining photograph uploads below.` : "Sensitive working draft: saved only in this browser tab’s session storage, scoped to your account, for up to 8 hours without edits. Nothing is saved to the server until you submit. Photograph bytes are kept in memory only; reselect them after leaving or reloading."}{restored && " Your temporary draft has been restored."}</p>
        {storageWarning && <div className={styles.notice} role="status">{storageWarning}</div>}
        {(error || errors.length > 0) && <div className={styles.error} role="alert" ref={errorRef} tabIndex={-1}>{error && <p>{error}</p>}{errors.length > 0 && <><strong>Please complete the following:</strong><ul>{errors.map((message, index) => <li key={index}>{message}</li>)}</ul></>}</div>}
        {!userId || loadedUser !== userId ? <p className={styles.hint}>{userId ? "Loading your private working draft…" : "Sign in to complete and submit a biological hazard report."}</p> : <form onSubmit={submit} noValidate autoComplete="off" className={styles.form}>
          <section className={styles.card} aria-labelledby="bio-category-title">
            <header className={styles.sectionHeader}><h2 id="bio-category-title">1. Register category</h2><span className={styles.badge}>Mandatory</span></header>
            <div className={styles.cardBody}><p className={styles.hint}><strong>How to complete — </strong>Choose the one category that best describes what happened. If you are unsure between two, choose the more serious.</p>
              <fieldset className={styles.categoryField} disabled={disabled}><legend className={styles.srOnly}>Register category (required)</legend><div className={styles.categories}>{BIOLOGICAL_CATEGORIES.map((category) => <label key={category.value} className={`${styles.categoryCard} ${form.category === category.value ? styles.categorySelected : ""}`}>
                <input type="radio" name="bio-category" value={category.value} checked={form.category === category.value} onChange={() => chooseCategory(category.value)} required />
                <span><strong>{category.label}</strong><span className={styles.categoryHint}><b>When to use: </b>{CATEGORY_GUIDANCE[category.value]?.[0]}</span><span className={styles.categoryHint}><b>Example: </b>{CATEGORY_GUIDANCE[category.value]?.[1]}</span></span>
              </label>)}</div></fieldset>
              {form.category === "inj" && <div className={styles.emergency} role="alert"><strong>Call <a href="tel:000">000</a> first</strong> for anaphylaxis, serious envenomation or any life-threatening reaction, then follow the Site-Specific ERP. Complete this register once the person is safe.</div>}
            </div>
          </section>
          {visibleSections.filter((section) => sectionNumber(section) < 9).map(renderSection)}
          <section className={styles.card} aria-labelledby="bio-photo-title">
            <header className={styles.sectionHeader}><h2 id="bio-photo-title">9. Photograph</h2><span className={styles.badge}>Optional · maximum 5</span></header>
            <div className={styles.cardBody}><p className={styles.hint}><strong>How to complete — </strong>Of the vector, the site or the affected area — only where it is appropriate and the person agrees. Do not include sensitive areas without agreement. JPEG, PNG or WebP, up to 8 MB each; prepared as a JPEG with a longest edge of 1,600 px or less, without EXIF/GPS metadata.</p>
              <label className={styles.checkboxLabel}><input type="checkbox" checked={photoConsent} disabled={disabled} onChange={(event) => setPhotoConsent(event.target.checked)} /><span>I confirm the photographs are appropriate and any affected person agrees to them being recorded.</span></label>
              <div className={styles.inlineActions}><button type="button" className={styles.secondary} onClick={() => cameraRef.current?.click()} disabled={submitting || preparing || complete || (!savedEvent && photos.length >= MAX_PHOTOS)}>Use camera</button><button type="button" className={styles.secondary} onClick={() => fileRef.current?.click()} disabled={submitting || preparing || complete || (!savedEvent && photos.length >= MAX_PHOTOS)}>Choose photographs</button><span className={styles.hint}>{preparing ? "Preparing private previews…" : `${photos.length} of ${MAX_PHOTOS} selected`}</span></div>
              <input ref={cameraRef} className={styles.fileInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple onChange={addPhotos} aria-label="Take biological hazard photographs" />
              <input ref={fileRef} className={styles.fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={addPhotos} aria-label="Choose biological hazard photographs" />
              {photoError && <p className={styles.error} role="alert">{photoError}</p>}
              {photos.length === 0 ? <p className={styles.hint}>No photograph added. Photographs are not required to submit.</p> : <div className={styles.photoGrid}>{photos.map((photo) => <figure key={photo.id} className={styles.photoCard}>{photo.preview ? <img src={photo.preview} alt={`Selected evidence: ${photo.name}`} /> : <div className={styles.photoPlaceholder}>{photo.status === "uploaded" ? "Attached to saved report" : "Reselect original photograph"}</div>}<figcaption><strong>{photo.name}</strong><span>{photo.status === "uploaded" ? "Upload confirmed" : photo.status === "uploading" ? "Uploading…" : photo.status === "missing" ? "Not in memory — reselect this file" : photo.status === "failed" ? "Upload not confirmed — retry required" : "Prepared locally — not uploaded"}</span>{photo.error && <span className={styles.errorText}>{photo.error}</span>}</figcaption>{!savedEvent && <button type="button" className={styles.textButton} onClick={() => removePhoto(photo.id)} disabled={submitting || preparing} aria-label={`Remove photograph ${photo.name}`}>Remove</button>}</figure>)}</div>}
            </div>
          </section>
          {visibleSections.filter((section) => sectionNumber(section) > 9).map(renderSection)}
          <section className={styles.card} aria-labelledby="bio-declaration-title">
            <header className={styles.sectionHeader}><h2 id="bio-declaration-title">12. Declaration</h2><span className={styles.badge}>Mandatory</span></header>
            <div className={styles.cardBody}><div className={styles.fieldGrid}><div className={styles.field}><label htmlFor="bio-dname">Name <span className={styles.required}>*</span></label><input id="bio-dname" value={form.declaration.name} maxLength={200} required disabled={disabled} placeholder="Full name" onChange={(event) => setDeclaration("name", event.target.value)} /></div><div className={styles.field}><label htmlFor="bio-ddate">Date <span className={styles.required}>*</span></label><input id="bio-ddate" type="date" value={form.declaration.date} required disabled={disabled} onChange={(event) => setDeclaration("date", event.target.value)} /></div></div>
              <div ref={signatureRef} className={styles.signature} style={submitting || preparing ? { pointerEvents: "none" } : undefined} aria-disabled={submitting || preparing || undefined}><label>Signature <span className={styles.required}>*</span></label>{savedEvent ? <img className={styles.signatureImage} src={form.declaration.signature} alt={`Signed declaration by ${form.declaration.name}`} /> : <SignaturePad key={`${loadedUser}:${signatureKey}`} value={form.declaration.signature} onChange={captureSignature} label="Sign here with your finger or mouse" />}</div>
              <label className={styles.checkboxLabel}><input type="checkbox" checked={declared} disabled={disabled} onChange={(event) => setDeclared(event.target.checked)} required /><span>I confirm this record accurately describes what is known to have occurred, the controls and the actions recorded above.</span></label>
              <p className={styles.hint}>Submission preserves the original signed record. Authorised WHS reviewers record subsequent actions separately.</p>
            </div>
          </section>
          <div className={styles.submitBar}><p>{savedEvent ? "Retry photographs only — no second report will be created." : "Submit securely to the WHS register. Keep this page open until all selected uploads are confirmed."}</p><button type="submit" className={styles.primary} disabled={submitting || preparing}>{submitting ? (savedEvent ? "Completing uploads…" : "Submitting report…") : savedEvent ? "Retry pending photographs / finish" : "Sign & submit report"}</button></div>
        </form>}
      </>}
      <details className={styles.history}><summary>My previous biological hazard reports</summary><BiologicalHazardRegister audience="staff" onToast={onToast} /></details>
      <footer className={styles.footer}>Ecology Consulting · Evidence you can stand behind<br />{BIOLOGICAL_DOCUMENT_CODE} · Rev {BIOLOGICAL_DOCUMENT_REVISION} · Controlled internal document. Request revisions through the admin portal.</footer>
    </div>
  </div>;
}
