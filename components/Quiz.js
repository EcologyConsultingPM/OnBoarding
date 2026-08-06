"use client";

import React, { useState, useEffect } from "react";
import { Plus, X, CheckCircle2, XCircle, Pencil, FolderLock, ChevronDown, ChevronRight } from "lucide-react";
import { C, FONT, inputStyle, addSmallBtn } from "./TrainingLibrary";
import { supabase } from "../lib/supabaseClient";
import * as db from "../lib/data";

const uid = () => Math.random().toString(36).slice(2, 10);

/* =================================================================
   ADMIN: building a quiz — question text lives in the quiz object
   (visible to everyone); correct/model answers are tracked locally
   here but saved to the admin-only answer key table, never mixed
   into the quiz object itself.
================================================================= */

function McQuestionEditor({ q, answer, onChangeQuestion, onChangeAnswer, onRemove }) {
  const setText = (text) => onChangeQuestion({ ...q, text });
  const setHeading = (heading) => onChangeQuestion({ ...q, heading });
  const setOption = (i, val) => {
    const options = [...q.options];
    options[i] = val;
    onChangeQuestion({ ...q, options });
  };
  const addOption = () => { if (q.options.length < 6) onChangeQuestion({ ...q, options: [...q.options, ""] }); };
  const removeOption = (i) => {
    if (q.options.length <= 2) return;
    const options = q.options.filter((_, idx) => idx !== i);
    const nextCorrect = answer === i ? 0 : answer > i ? answer - 1 : answer;
    onChangeQuestion({ ...q, options });
    onChangeAnswer(nextCorrect);
  };

  return (
    <div style={{ background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <input value={q.heading || ""} onChange={(e) => setHeading(e.target.value)} placeholder="Section heading (optional, e.g. TOPIC 01 — INTRODUCTION)"
        style={{ ...inputStyle, fontSize: 11, fontWeight: 900, color: C.green700, textTransform: "uppercase", letterSpacing: "0.04em" }} />
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <textarea value={q.text} onChange={(e) => setText(e.target.value)} placeholder="Question" rows={2}
          style={{ ...inputStyle, flex: 1, resize: "vertical", fontWeight: 700 }} />
        <button onClick={onRemove} style={{ background: "none", border: "none", color: C.rust, cursor: "pointer", flexShrink: 0 }}><X size={15} /></button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {q.options.map((opt, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => onChangeAnswer(i)} title="Mark as the correct answer"
              style={{
                width: 20, height: 20, borderRadius: 99, flexShrink: 0, cursor: "pointer",
                border: `2px solid ${answer === i ? C.green400 : "#c2cdb6"}`,
                background: answer === i ? C.green400 : "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {answer === i && <CheckCircle2 size={12} color="#fff" />}
            </button>
            <input value={opt} onChange={(e) => setOption(i, e.target.value)} placeholder={`Option ${i + 1}`} style={{ ...inputStyle, flex: 1 }} />
            {q.options.length > 2 && (
              <button onClick={() => removeOption(i)} style={{ background: "none", border: "none", color: C.inkFaint, cursor: "pointer" }}><X size={13} /></button>
            )}
          </div>
        ))}
      </div>
      {q.options.length < 6 && <button onClick={addOption} style={addSmallBtn}><Plus size={11} /> Add option</button>}
      <div style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint, fontStyle: "italic" }}>
        Click the circle next to the correct answer — this is saved separately and staff never see it.
      </div>
    </div>
  );
}

function WrittenQuestionEditor({ q, modelAnswer, onChangeQuestion, onChangeAnswer, onRemove }) {
  return (
    <div style={{ background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <input value={q.heading || ""} onChange={(e) => onChangeQuestion({ ...q, heading: e.target.value })} placeholder="Section heading (optional, e.g. FLORA SURVEY OBJECTIVES)"
        style={{ ...inputStyle, fontSize: 11, fontWeight: 900, color: C.green700, textTransform: "uppercase", letterSpacing: "0.04em" }} />
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <textarea value={q.text} onChange={(e) => onChangeQuestion({ ...q, text: e.target.value })} placeholder="Question" rows={2}
          style={{ ...inputStyle, flex: 1, resize: "vertical", fontWeight: 700 }} />
        <button onClick={onRemove} style={{ background: "none", border: "none", color: C.rust, cursor: "pointer", flexShrink: 0 }}><X size={15} /></button>
      </div>
      <textarea value={modelAnswer || ""} onChange={(e) => onChangeAnswer(e.target.value)} placeholder="Model answer (for the assessor only — staff never see this)" rows={2}
        style={{ ...inputStyle, resize: "vertical", background: C.amberBg || "#fbf6ea" }} />
    </div>
  );
}

function QuizEditor({ quiz, onChangeQuiz, onRemove, onDone, onToast }) {
  const [answers, setAnswers] = useState({}); // { [questionId]: correctIndex | modelAnswerText }
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    db.fetchAnswerKey(quiz.id).then((a) => { setAnswers(a); setLoaded(true); }).catch(() => { setLoaded(true); });
  }, [quiz.id]);

  const saveAnswers = (next) => {
    setAnswers(next);
    db.saveAnswerKey(quiz.id, quiz.topic, quiz.level, next).catch(() => onToast && onToast("Couldn't save the answer key"));
  };

  const setTitle = (title) => onChangeQuiz({ ...quiz, title });
  const setType = (type) => {
    if (quiz.questions.length > 0 && !window.confirm("Changing the quiz type clears its current questions. Continue?")) return;
    onChangeQuiz({ ...quiz, type, questions: [] });
  };
  const addQuestion = () => onChangeQuiz({
    ...quiz,
    questions: [...quiz.questions, quiz.type === "written"
      ? { id: uid(), heading: "", text: "" }
      : { id: uid(), heading: "", text: "", options: ["", ""] }],
  });
  const updateQuestion = (i, next) => {
    const questions = [...quiz.questions];
    questions[i] = next;
    onChangeQuiz({ ...quiz, questions });
  };
  const removeQuestion = (i) => {
    const q = quiz.questions[i];
    const { [q.id]: _, ...rest } = answers;
    saveAnswers(rest);
    onChangeQuiz({ ...quiz, questions: quiz.questions.filter((_, idx) => idx !== i) });
  };

  if (!loaded) return <div style={{ padding: 20, textAlign: "center", color: C.inkSoft }}>Loading…</div>;

  return (
    <div style={{ background: "#fff", border: `2px dashed ${C.line}`, borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={quiz.title} onChange={(e) => setTitle(e.target.value)} placeholder="Quiz title" style={{ ...inputStyle, flex: 1, fontWeight: 900, fontSize: 15 }} />
        <button onClick={onRemove} title="Delete this quiz" style={{ background: "none", border: "none", color: C.rust, cursor: "pointer", flexShrink: 0 }}><X size={17} /></button>
      </div>

      <div style={{ display: "flex", gap: 6, background: C.bg, borderRadius: 10, padding: 4, width: "fit-content" }}>
        {[["mc", "Multiple choice"], ["written", "Written response"]].map(([key, label]) => (
          <button key={key} onClick={() => setType(key)} style={{
            border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 800, fontFamily: FONT, cursor: "pointer",
            background: quiz.type === key ? "#fff" : "transparent", color: quiz.type === key ? C.green700 : C.inkSoft,
            boxShadow: quiz.type === key ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
          }}>
            {label}
          </button>
        ))}
      </div>

      {quiz.questions.map((q, i) => (
        quiz.type === "written" ? (
          <WrittenQuestionEditor key={q.id} q={q} modelAnswer={answers[q.id]}
            onChangeQuestion={(next) => updateQuestion(i, next)}
            onChangeAnswer={(text) => saveAnswers({ ...answers, [q.id]: text })}
            onRemove={() => removeQuestion(i)} />
        ) : (
          <McQuestionEditor key={q.id} q={q} answer={answers[q.id] ?? 0}
            onChangeQuestion={(next) => updateQuestion(i, next)}
            onChangeAnswer={(idx) => saveAnswers({ ...answers, [q.id]: idx })}
            onRemove={() => removeQuestion(i)} />
        )
      ))}

      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <button onClick={addQuestion} style={addSmallBtn}><Plus size={12} /> Add question</button>
        <button onClick={onDone} style={{ ...addSmallBtn, color: C.green700, marginLeft: "auto" }}>Done editing</button>
      </div>
    </div>
  );
}

/* =================================================================
   TAKING a quiz — branches by type
================================================================= */

function McRunner({ quiz, onClose, onToast }) {
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null); // { score, total, results }
  const [grading, setGrading] = useState(false);

  const answerCount = Object.keys(answers).length;
  const allAnswered = answerCount === quiz.questions.length;

  const submit = async () => {
    setGrading(true);
    try {
      const graded = await db.gradeQuiz(quiz.id, answers);
      setResult(graded);
    } catch (e) {
      onToast && onToast(e.message || "Couldn't grade the quiz");
    } finally {
      setGrading(false);
    }
  };

  return (
    <>
      {result ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{
            background: result.score === result.total ? C.greenTintSoft : C.amberBg,
            border: `1px solid ${result.score === result.total ? C.greenTint : (C.amberLight || C.line)}`,
            borderRadius: 10, padding: "14px 16px", textAlign: "center",
          }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.green700 }}>{result.score} / {result.total}</div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.inkSoft }}>correct</div>
          </div>
          {quiz.questions.map((q, i) => {
            const r = result.results.find((x) => x.questionId === q.id);
            if (!r) return null;
            return (
              <div key={q.id} style={{ borderBottom: `1px solid ${C.line}`, paddingBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13.5, fontWeight: 700, color: C.ink }}>
                  {r.correct ? <CheckCircle2 size={16} color={C.green400} style={{ flexShrink: 0, marginTop: 2 }} /> : <XCircle size={16} color={C.rust} style={{ flexShrink: 0, marginTop: 2 }} />}
                  <span>{i + 1}. {q.text}</span>
                </div>
                {!r.correct && <div style={{ marginLeft: 24, marginTop: 4, fontSize: 12.5, fontWeight: 600, color: C.inkSoft }}>Correct answer: {q.options[r.correctIndex]}</div>}
              </div>
            );
          })}
          <button onClick={onClose} style={{ alignSelf: "flex-start", background: C.green400, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>Close</button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {quiz.questions.map((q, i) => (
            <div key={q.id}>
              {q.heading && <div style={{ fontSize: 11, fontWeight: 900, color: C.green700, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>{q.heading}</div>}
              <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 8 }}>{i + 1}. {q.text}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {q.options.map((opt, oi) => (
                  <label key={oi} style={{
                    display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: C.ink,
                    background: answers[q.id] === oi ? C.greenTintSoft : "transparent", borderRadius: 8, padding: "7px 10px",
                    border: `1px solid ${answers[q.id] === oi ? C.greenTint : C.line}`,
                  }}>
                    <input type="radio" name={q.id} checked={answers[q.id] === oi} onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))} />
                    {opt || <span style={{ color: C.inkFaint, fontStyle: "italic" }}>(empty option)</span>}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <button onClick={submit} disabled={!allAnswered || grading} style={{
            alignSelf: "flex-start", background: allAnswered ? C.green400 : "#c2cdb6", color: "#fff", border: "none",
            borderRadius: 8, padding: "10px 20px", fontSize: 13.5, fontWeight: 800, fontFamily: FONT,
            cursor: allAnswered ? "pointer" : "default",
          }}>
            {grading ? "Grading…" : `Submit (${answerCount}/${quiz.questions.length} answered)`}
          </button>
        </div>
      )}
    </>
  );
}

function WrittenRunner({ quiz, onClose, onToast }) {
  const [answers, setAnswers] = useState({});
  const [existing, setExisting] = useState(undefined); // undefined = loading, null = none yet
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    db.fetchMySubmission(quiz.id).then(setExisting).catch(() => setExisting(null));
  }, [quiz.id]);

  const submit = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await db.submitWrittenQuiz(quiz.id, quiz.topic, quiz.level, session?.user?.id, answers);
      setSubmitted(true);
    } catch (e) {
      onToast && onToast(e.message || "Couldn't submit your answers");
    }
  };

  if (existing === undefined) return <div style={{ padding: 20, textAlign: "center", color: C.inkSoft }}>Loading…</div>;

  if (submitted || existing) {
    const sub = existing;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ background: C.greenTintSoft, border: `1px solid ${C.greenTint}`, borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.green700 }}>
            {submitted ? "Submitted — your assessor will review this." : "You've already submitted this quiz."}
          </div>
          {sub?.result && (
            <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: C.ink }}>
              Result: {sub.result === "competent" ? "Competent" : "Further development"}
              {sub.assessor_notes && <div style={{ marginTop: 4, fontSize: 12.5, fontWeight: 600, color: C.inkSoft }}>{sub.assessor_notes}</div>}
            </div>
          )}
          {!sub?.result && !submitted && <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 600, color: C.inkSoft }}>Not yet marked.</div>}
        </div>
        <button onClick={onClose} style={{ alignSelf: "flex-start", background: C.green400, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>Close</button>
      </div>
    );
  }

  const answerCount = Object.values(answers).filter((v) => v && v.trim()).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: C.inkSoft, lineHeight: 1.5 }}>
        Open-book — write in your own words. Your assessor will review and mark this.
      </p>
      {quiz.questions.map((q, i) => (
        <div key={q.id}>
          {q.heading && <div style={{ fontSize: 11, fontWeight: 900, color: C.green700, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>{q.heading}</div>}
          <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 6 }}>{i + 1}. {q.text}</div>
          <textarea value={answers[q.id] || ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} rows={3}
            placeholder="Your answer…" style={{ ...inputStyle, resize: "vertical" }} />
        </div>
      ))}
      <button onClick={submit} disabled={answerCount === 0} style={{
        alignSelf: "flex-start", background: answerCount > 0 ? C.green400 : "#c2cdb6", color: "#fff", border: "none",
        borderRadius: 8, padding: "10px 20px", fontSize: 13.5, fontWeight: 800, fontFamily: FONT,
        cursor: answerCount > 0 ? "pointer" : "default",
      }}>
        Submit for review
      </button>
    </div>
  );
}

function QuizRunnerModal({ quiz, onClose, onToast }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,55,31,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "26px 26px", width: "100%", maxWidth: 560, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: C.ink, fontFamily: FONT }}>{quiz.title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.inkFaint, cursor: "pointer" }}><X size={18} /></button>
        </div>
        {quiz.type === "written"
          ? <WrittenRunner quiz={quiz} onClose={onClose} onToast={onToast} />
          : <McRunner quiz={quiz} onClose={onClose} onToast={onToast} />}
      </div>
    </div>
  );
}

/* =================================================================
   ADMIN-ONLY: the Answer Folder — model/correct answers, plus
   marking written submissions. Never rendered unless isAdmin.
================================================================= */

function AnswerFolderModal({ quiz, onClose, onToast }) {
  const [answers, setAnswers] = useState(null);
  const [submissions, setSubmissions] = useState(null);
  const [notes, setNotes] = useState({});

  useEffect(() => {
    db.fetchAnswerKey(quiz.id).then(setAnswers).catch(() => onToast && onToast("Couldn't load the answer key"));
    if (quiz.type === "written") {
      db.fetchQuizSubmissions(quiz.id).then(setSubmissions).catch(() => onToast && onToast("Couldn't load submissions"));
    }
  }, [quiz.id, quiz.type, onToast]);

  const mark = async (sub, result) => {
    try {
      await db.markSubmission(sub.id, { result, assessorNotes: notes[sub.id] ?? sub.assessor_notes ?? "" }, "admin");
      setSubmissions((prev) => prev.map((s) => (s.id === sub.id ? { ...s, result, assessor_notes: notes[sub.id] ?? s.assessor_notes } : s)));
      onToast && onToast("Marked");
    } catch {
      onToast && onToast("Couldn't save the mark");
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,55,31,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "26px 26px", width: "100%", maxWidth: 640, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: C.amberText || "#7a6233" }}>
              <FolderLock size={13} /> Answer folder — admin only
            </div>
            <h3 style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 900, color: C.ink, fontFamily: FONT }}>{quiz.title}</h3>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.inkFaint, cursor: "pointer" }}><X size={18} /></button>
        </div>

        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {quiz.questions.map((q, i) => (
            <div key={q.id} style={{ borderBottom: `1px solid ${C.line}`, paddingBottom: 10 }}>
              {q.heading && <div style={{ fontSize: 10.5, fontWeight: 900, color: C.green700, textTransform: "uppercase", marginBottom: 4 }}>{q.heading}</div>}
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{i + 1}. {q.text}</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.green700, marginTop: 4 }}>
                {quiz.type === "mc"
                  ? <>Correct: {q.options[answers?.[q.id]] ?? "—"}</>
                  : <>Model answer: {answers?.[q.id] || "—"}</>}
              </div>
            </div>
          ))}
        </div>

        {quiz.type === "written" && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: C.inkFaint, marginBottom: 10 }}>Submissions</div>
            {submissions === null && <div style={{ color: C.inkSoft, fontSize: 13 }}>Loading…</div>}
            {submissions?.length === 0 && <div style={{ color: C.inkFaint, fontStyle: "italic", fontSize: 13 }}>No submissions yet.</div>}
            {submissions?.map((sub) => (
              <div key={sub.id} style={{ background: C.greenTintSoft, borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: C.inkSoft, marginBottom: 6 }}>
                  Submitted {new Date(sub.submitted_at).toLocaleString()}
                </div>
                {quiz.questions.map((q, i) => (
                  <div key={q.id} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: C.ink }}>{i + 1}. {q.text}</div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: C.inkSoft }}>{sub.answers?.[q.id] || <em>(no answer)</em>}</div>
                  </div>
                ))}
                <textarea
                  defaultValue={sub.assessor_notes || ""} placeholder="Notes for this submission…"
                  onChange={(e) => setNotes((n) => ({ ...n, [sub.id]: e.target.value }))}
                  rows={2} style={{ ...inputStyle, resize: "vertical", marginTop: 6 }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button onClick={() => mark(sub, "competent")} style={{
                    background: sub.result === "competent" ? C.green400 : "#fff", color: sub.result === "competent" ? "#fff" : C.green700,
                    border: `1px solid ${C.green400}`, borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: FONT,
                  }}>
                    Competent
                  </button>
                  <button onClick={() => mark(sub, "further_development")} style={{
                    background: sub.result === "further_development" ? C.amberText || "#7a6233" : "#fff", color: sub.result === "further_development" ? "#fff" : (C.amberText || "#7a6233"),
                    border: `1px solid ${C.amberText || "#7a6233"}`, borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: FONT,
                  }}>
                    Further development
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* =================================================================
   The folder itself
================================================================= */

export default function QuizFolder({ quizzes, isAdmin, onSave, onToast, topic, level }) {
  const [local, setLocal] = useState(quizzes);
  const [editingId, setEditingId] = useState(null);
  const [runningQuiz, setRunningQuiz] = useState(null);
  const [answerFolderQuiz, setAnswerFolderQuiz] = useState(null);

  const save = (next) => {
    setLocal(next);
    onSave(next).catch(() => onToast && onToast("Couldn't save — try again"));
  };

  const addQuiz = () => {
    const q = { id: uid(), title: "New quiz", type: "mc", questions: [], topic, level };
    save([...local, q]);
    setEditingId(q.id);
  };
  const updateQuiz = (id, next) => save(local.map((q) => (q.id === id ? next : q)));
  const removeQuiz = (id) => {
    if (!window.confirm("Delete this quiz? Its answer key and any submissions will also be removed.")) return;
    db.deleteAnswerKey(id).catch(() => {});
    save(local.filter((q) => q.id !== id));
    if (editingId === id) setEditingId(null);
  };

  if (!isAdmin && local.length === 0) {
    return <div style={{ color: C.inkFaint, fontSize: 13, fontWeight: 600, fontStyle: "italic" }}>No quizzes here yet.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {local.map((quiz) => {
        const ready = quiz.type === "written"
          ? quiz.questions.length > 0 && quiz.questions.every((q) => q.text.trim())
          : quiz.questions.length > 0 && quiz.questions.every((q) => q.text.trim() && q.options.every((o) => o.trim()));

        if (isAdmin && editingId === quiz.id) {
          return <QuizEditor key={quiz.id} quiz={{ ...quiz, topic, level }} onChangeQuiz={(next) => updateQuiz(quiz.id, next)} onRemove={() => removeQuiz(quiz.id)} onDone={() => setEditingId(null)} onToast={onToast} />;
        }
        return (
          <div key={quiz.id} style={{ display: "flex", alignItems: "center", gap: 10, background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 16px", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: C.ink }}>{quiz.title}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.inkSoft }}>
                {quiz.type === "written" ? "Written response" : "Multiple choice"} · {quiz.questions.length} question{quiz.questions.length === 1 ? "" : "s"}
              </div>
            </div>
            {isAdmin && (
              <button onClick={() => setAnswerFolderQuiz(quiz)} title="Admin-only answer folder" style={{
                background: C.amberBg || "#fbf6ea", border: `1px solid ${C.amberText || "#7a6233"}`, borderRadius: 8, padding: "7px 12px",
                fontSize: 12, fontWeight: 800, color: C.amberText || "#7a6233", cursor: "pointer", fontFamily: FONT,
                display: "flex", alignItems: "center", gap: 5,
              }}>
                <FolderLock size={12} /> Answer folder
              </button>
            )}
            {isAdmin && (
              <button onClick={() => setEditingId(quiz.id)} style={{ background: "none", border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 800, color: C.green700, cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", gap: 5 }}>
                <Pencil size={12} /> Edit
              </button>
            )}
            <button
              onClick={() => ready && setRunningQuiz(quiz)} disabled={!ready}
              title={ready ? "" : "This quiz needs at least one complete question first"}
              style={{
                background: ready ? C.green400 : "#c2cdb6", color: "#fff", border: "none", borderRadius: 8,
                padding: "9px 16px", fontSize: 12.5, fontWeight: 800, cursor: ready ? "pointer" : "default", fontFamily: FONT,
              }}
            >
              Start Quiz
            </button>
          </div>
        );
      })}
      {isAdmin && <button onClick={addQuiz} style={{ ...addSmallBtn, marginTop: 4 }}><Plus size={12} /> Add quiz</button>}
      {runningQuiz && <QuizRunnerModal quiz={runningQuiz} onClose={() => setRunningQuiz(null)} onToast={onToast} />}
      {answerFolderQuiz && <AnswerFolderModal quiz={answerFolderQuiz} onClose={() => setAnswerFolderQuiz(null)} onToast={onToast} />}
    </div>
  );
}
