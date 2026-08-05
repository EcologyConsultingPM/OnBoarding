"use client";

import React, { useState } from "react";
import { Plus, X, ChevronDown, ChevronRight, CheckCircle2, XCircle, Pencil } from "lucide-react";
import { C, FONT, inputStyle, addSmallBtn } from "./TrainingLibrary";

const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------------------------------------------------------------
   Admin: edit one question — text, 2-4 options, which one's correct
----------------------------------------------------------------- */

function QuestionEditor({ q, onChange, onRemove }) {
  const setText = (text) => onChange({ ...q, text });
  const setOption = (i, val) => {
    const options = [...q.options];
    options[i] = val;
    onChange({ ...q, options });
  };
  const addOption = () => {
    if (q.options.length >= 6) return;
    onChange({ ...q, options: [...q.options, ""] });
  };
  const removeOption = (i) => {
    if (q.options.length <= 2) return;
    const options = q.options.filter((_, idx) => idx !== i);
    const correctIndex = q.correctIndex === i ? 0 : q.correctIndex > i ? q.correctIndex - 1 : q.correctIndex;
    onChange({ ...q, options, correctIndex });
  };

  return (
    <div style={{ background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <textarea value={q.text} onChange={(e) => setText(e.target.value)} placeholder="Question" rows={2}
          style={{ ...inputStyle, flex: 1, resize: "vertical", fontWeight: 700 }} />
        <button onClick={onRemove} style={{ background: "none", border: "none", color: C.rust, cursor: "pointer", flexShrink: 0 }}><X size={15} /></button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {q.options.map((opt, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => onChange({ ...q, correctIndex: i })}
              title="Mark as the correct answer"
              style={{
                width: 20, height: 20, borderRadius: 99, flexShrink: 0, cursor: "pointer",
                border: `2px solid ${q.correctIndex === i ? C.green400 : "#c2cdb6"}`,
                background: q.correctIndex === i ? C.green400 : "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {q.correctIndex === i && <CheckCircle2 size={12} color="#fff" />}
            </button>
            <input value={opt} onChange={(e) => setOption(i, e.target.value)} placeholder={`Option ${i + 1}`} style={{ ...inputStyle, flex: 1 }} />
            {q.options.length > 2 && (
              <button onClick={() => removeOption(i)} style={{ background: "none", border: "none", color: C.inkFaint, cursor: "pointer" }}><X size={13} /></button>
            )}
          </div>
        ))}
      </div>
      {q.options.length < 6 && (
        <button onClick={addOption} style={addSmallBtn}><Plus size={11} /> Add option</button>
      )}
      <div style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint, fontStyle: "italic" }}>Click the circle next to the correct answer.</div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Admin: edit one quiz — title + its questions
----------------------------------------------------------------- */

function QuizEditor({ quiz, onChange, onRemove, onDone }) {
  const setTitle = (title) => onChange({ ...quiz, title });
  const addQuestion = () => onChange({
    ...quiz,
    questions: [...quiz.questions, { id: uid(), text: "", options: ["", ""], correctIndex: 0 }],
  });
  const updateQuestion = (i, next) => {
    const questions = [...quiz.questions];
    questions[i] = next;
    onChange({ ...quiz, questions });
  };
  const removeQuestion = (i) => onChange({ ...quiz, questions: quiz.questions.filter((_, idx) => idx !== i) });

  return (
    <div style={{ background: "#fff", border: `2px dashed ${C.line}`, borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={quiz.title} onChange={(e) => setTitle(e.target.value)} placeholder="Quiz title" style={{ ...inputStyle, flex: 1, fontWeight: 900, fontSize: 15 }} />
        <button onClick={onRemove} title="Delete this quiz" style={{ background: "none", border: "none", color: C.rust, cursor: "pointer", flexShrink: 0 }}><X size={17} /></button>
      </div>
      {quiz.questions.map((q, i) => (
        <QuestionEditor key={q.id} q={q} onChange={(next) => updateQuestion(i, next)} onRemove={() => removeQuestion(i)} />
      ))}
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <button onClick={addQuestion} style={addSmallBtn}><Plus size={12} /> Add question</button>
        <button onClick={onDone} style={{ ...addSmallBtn, color: C.green700, marginLeft: "auto" }}>Done editing</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Staff (or anyone): take a quiz, see the score
----------------------------------------------------------------- */

function QuizRunner({ quiz, onClose }) {
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const answerCount = Object.keys(answers).length;
  const allAnswered = answerCount === quiz.questions.length;
  const score = quiz.questions.filter((q) => answers[q.id] === q.correctIndex).length;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,55,31,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "26px 26px", width: "100%", maxWidth: 560, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: C.ink, fontFamily: FONT }}>{quiz.title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.inkFaint, cursor: "pointer" }}><X size={18} /></button>
        </div>

        {submitted ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{
              background: score === quiz.questions.length ? C.greenTintSoft : C.amberBg,
              border: `1px solid ${score === quiz.questions.length ? C.greenTint : (C.amberLight || C.line)}`,
              borderRadius: 10, padding: "14px 16px", textAlign: "center",
            }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: C.green700 }}>{score} / {quiz.questions.length}</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.inkSoft }}>correct</div>
            </div>
            {quiz.questions.map((q, i) => {
              const correct = answers[q.id] === q.correctIndex;
              return (
                <div key={q.id} style={{ borderBottom: `1px solid ${C.line}`, paddingBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13.5, fontWeight: 700, color: C.ink }}>
                    {correct ? <CheckCircle2 size={16} color={C.green400} style={{ flexShrink: 0, marginTop: 2 }} /> : <XCircle size={16} color={C.rust} style={{ flexShrink: 0, marginTop: 2 }} />}
                    <span>{i + 1}. {q.text}</span>
                  </div>
                  {!correct && (
                    <div style={{ marginLeft: 24, marginTop: 4, fontSize: 12.5, fontWeight: 600, color: C.inkSoft }}>
                      Correct answer: {q.options[q.correctIndex]}
                    </div>
                  )}
                </div>
              );
            })}
            <button onClick={onClose} style={{
              alignSelf: "flex-start", background: C.green400, color: "#fff", border: "none", borderRadius: 8,
              padding: "9px 18px", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT,
            }}>
              Close
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {quiz.questions.map((q, i) => (
              <div key={q.id}>
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
            <button
              onClick={() => setSubmitted(true)} disabled={!allAnswered}
              style={{
                alignSelf: "flex-start", background: allAnswered ? C.green400 : "#c2cdb6", color: "#fff", border: "none",
                borderRadius: 8, padding: "10px 20px", fontSize: 13.5, fontWeight: 800, fontFamily: FONT,
                cursor: allAnswered ? "pointer" : "default",
              }}
            >
              Submit ({answerCount}/{quiz.questions.length} answered)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   The folder itself — admin sees build/edit controls, everyone
   sees a "Start Quiz" card
----------------------------------------------------------------- */

export default function QuizFolder({ quizzes, isAdmin, onSave, onToast }) {
  const [local, setLocal] = useState(quizzes);
  const [editingId, setEditingId] = useState(null);
  const [runningQuiz, setRunningQuiz] = useState(null);

  const save = (next) => {
    setLocal(next);
    onSave(next).catch(() => onToast && onToast("Couldn't save — try again"));
  };

  const addQuiz = () => {
    const q = { id: uid(), title: "New quiz", questions: [] };
    save([...local, q]);
    setEditingId(q.id);
  };
  const updateQuiz = (id, next) => save(local.map((q) => (q.id === id ? next : q)));
  const removeQuiz = (id) => {
    if (!window.confirm("Delete this quiz?")) return;
    save(local.filter((q) => q.id !== id));
    if (editingId === id) setEditingId(null);
  };

  if (!isAdmin && local.length === 0) {
    return <div style={{ color: C.inkFaint, fontSize: 13, fontWeight: 600, fontStyle: "italic" }}>No quizzes here yet.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {local.map((quiz) => {
        const ready = quiz.questions.length > 0 && quiz.questions.every((q) => q.text.trim() && q.options.every((o) => o.trim()));
        if (isAdmin && editingId === quiz.id) {
          return <QuizEditor key={quiz.id} quiz={quiz} onChange={(next) => updateQuiz(quiz.id, next)} onRemove={() => removeQuiz(quiz.id)} onDone={() => setEditingId(null)} />;
        }
        return (
          <div key={quiz.id} style={{ display: "flex", alignItems: "center", gap: 12, background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: C.ink }}>{quiz.title}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.inkSoft }}>{quiz.questions.length} question{quiz.questions.length === 1 ? "" : "s"}</div>
            </div>
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
      {isAdmin && (
        <button onClick={addQuiz} style={{ ...addSmallBtn, marginTop: 4 }}><Plus size={12} /> Add quiz</button>
      )}
      {runningQuiz && <QuizRunner quiz={runningQuiz} onClose={() => setRunningQuiz(null)} />}
    </div>
  );
}
