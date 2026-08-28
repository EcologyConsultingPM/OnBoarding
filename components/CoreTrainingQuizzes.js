"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FolderOpen,
  GraduationCap,
  Loader2,
  RotateCcw,
  Send,
  XCircle,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const LEVEL_ORDER = ["Basics", "Early Career", "Mid Level", "Senior Level", "Additional NSW Reporting & Biodiversity Pathways", "Business Operations"];
const displayTime = (value) => value ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "Not yet saved";

function ScoreSummary({ result }) {
  if (!result || typeof result.score !== "number") return null;
  return (
    <div className={`ctq-result ${result.passed ? "passed" : "review"}`}>
      {result.passed ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
      <div><strong>{result.passed ? "Knowledge threshold met" : "Further learning required"}</strong><span>{result.score}/{result.total} correct · threshold {result.passMark}/{result.total}</span></div>
    </div>
  );
}

export default function CoreTrainingQuizzes({ onBack }) {
  const { session } = useAuth();
  const [catalogue, setCatalogue] = useState([]);
  const [submissions, setSubmissions] = useState({});
  const [level, setLevel] = useState("");
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [autosave, setAutosave] = useState("Answers autosave as you work");
  const [error, setError] = useState("");
  const timer = useRef(null);

  const headers = useCallback(() => ({ "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` }), [session?.access_token]);
  const draftKey = quiz ? `ec-core-training-draft:${quiz.quizId}` : "";

  const loadCatalogue = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const response = await fetch("/api/core-training-quizzes", { headers: headers(), cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not load Core Training modules.");
      setCatalogue(body.careerLevels || []);
      setSubmissions(body.latestSubmissions || {});
    } catch (caught) {
      setError(caught.message || "Could not load Core Training modules.");
    } finally { setLoading(false); }
  }, [headers, session?.access_token]);

  useEffect(() => { loadCatalogue(); return () => window.clearTimeout(timer.current); }, [loadCatalogue]);

  const openQuiz = async (quizId) => {
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch(`/api/core-training-quizzes?quizId=${encodeURIComponent(quizId)}`, { headers: headers(), cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not open this quiz.");
      const savedLocally = (() => { try { return JSON.parse(window.localStorage.getItem(`ec-core-training-draft:${quizId}`) || "null"); } catch { return null; } })();
      setQuiz(body.quiz);
      setResult(body.submission || null);
      setAnswers(savedLocally?.answers || body.draft?.answers || body.submission?.answers || {});
      setAutosave(body.draft?.updatedAt ? `Saved ${displayTime(body.draft.updatedAt)}` : "Answers autosave as you work");
    } catch (caught) { setError(caught.message || "Could not open this quiz."); }
    finally { setBusy(false); }
  };

  const persist = useCallback(async (nextAnswers, activeQuiz) => {
    if (!activeQuiz) return;
    setAutosave("Saving…");
    try {
      const response = await fetch("/api/core-training-quizzes", { method: "PATCH", headers: headers(), body: JSON.stringify({ quizId: activeQuiz.quizId, answers: nextAnswers }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not autosave.");
      window.localStorage.removeItem(`ec-core-training-draft:${activeQuiz.quizId}`);
      setAutosave(`Saved ${displayTime(body.autosavedAt)}`);
    } catch { setAutosave("Saved in this browser — it will retry when you next answer"); }
  }, [headers]);

  const selectAnswer = (number, answer) => {
    if (!quiz || result) return;
    const next = { ...answers, [String(number)]: answer };
    setAnswers(next);
    try { window.localStorage.setItem(draftKey, JSON.stringify({ answers: next, updatedAt: new Date().toISOString() })); } catch { /* local resilience layer only */ }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => persist(next, quiz), 650);
  };

  const submit = async () => {
    if (!quiz || result) return;
    const missing = quiz.questions.filter((question) => !answers[String(question.number)]);
    if (missing.length) {
      setError(`Please answer all ${missing.length} remaining question${missing.length === 1 ? "" : "s"} before submitting.`);
      document.getElementById(`ctq-question-${missing[0].number}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/core-training-quizzes", { method: "POST", headers: headers(), body: JSON.stringify({ quizId: quiz.quizId, answers }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not submit this quiz.");
      setResult(body);
      setSubmissions((current) => ({ ...current, [quiz.quizId]: { quiz_id: quiz.quizId, submitted_at: body.submission.submittedAt, result: body.submission.summary } }));
      window.localStorage.removeItem(draftKey);
      setAutosave("Submitted and marked");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) { setError(caught.message || "Could not submit this quiz."); }
    finally { setBusy(false); }
  };

  const levels = useMemo(() => [...catalogue].sort((a, b) => LEVEL_ORDER.indexOf(a.careerLevel) - LEVEL_ORDER.indexOf(b.careerLevel)), [catalogue]);
  const quizzes = catalogue.find((item) => item.careerLevel === level)?.quizzes || [];
  const closeQuiz = () => { window.clearTimeout(timer.current); setQuiz(null); setResult(null); setAnswers({}); setError(""); };

  if (quiz) {
    const answered = Object.keys(answers).length;
    return <section className="ctq-shell" aria-labelledby="core-quiz-heading">
      <div className="ctq-topbar"><button type="button" className="ctq-back" onClick={closeQuiz}><ArrowLeft size={16} /> Core Training modules</button><span className="ctq-save-state"><Clock3 size={14} /> {autosave}</span></div>
      <header className="ctq-hero"><span>{quiz.careerLevel} · {quiz.code}</span><h2 id="core-quiz-heading">{quiz.title}</h2><p>Select the most defensible next action under the stated facts. This assessment supports learning and does not confer delegated authority or signatory approval.</p><div className="ctq-progress"><span style={{ width: `${Math.round((answered / quiz.questionCount) * 100)}%` }} /></div><small>{answered} of {quiz.questionCount} questions answered · Knowledge threshold {quiz.threshold.passMark}/{quiz.questionCount}</small></header>
      {error ? <p className="ctq-alert error"><AlertCircle size={16} /> {error}</p> : null}<ScoreSummary result={result} />
      <div className="ctq-question-list">{quiz.questions.map((question) => {
        const feedback = result?.results?.find((item) => String(item.questionId) === String(question.number));
        return <article key={question.number} id={`ctq-question-${question.number}`} className={`ctq-question${feedback ? (feedback.correct ? " is-correct" : " is-incorrect") : ""}`}><div className="ctq-question-number">{question.number}</div><div className="ctq-question-content"><h3>{question.prompt}</h3><div className="ctq-options" role="radiogroup" aria-label={`Question ${question.number}`}>{question.options.map((option) => {
          const selected = answers[String(question.number)] === option.key;
          const isCorrect = feedback?.correctAnswer === option.key;
          const incorrectChoice = Boolean(feedback && selected && !feedback.correct);
          return <label key={option.key} className={`ctq-option${selected ? " chosen" : ""}${feedback && isCorrect ? " answer-correct" : ""}${incorrectChoice ? " answer-incorrect" : ""}`}><input type="radio" name={`quiz-${question.number}`} checked={selected} disabled={Boolean(result)} onChange={() => selectAnswer(question.number, option.key)} /><span className="ctq-option-key">{option.key}</span><span>{option.text}</span>{feedback && isCorrect ? <CheckCircle2 className="ctq-answer-icon" size={18} /> : null}{feedback && incorrectChoice ? <XCircle className="ctq-answer-icon" size={18} /> : null}</label>;
        })}</div>{feedback ? <div className={`ctq-feedback ${feedback.correct ? "correct" : "incorrect"}`}><strong>{feedback.correct ? "Correct" : `Not quite — correct answer: ${feedback.correctAnswer}`}</strong><p>{feedback.rationale}</p></div> : null}</div></article>;
      })}</div>
      {!result ? <button type="button" className="ctq-submit" disabled={busy} onClick={submit}>{busy ? <><Loader2 size={17} className="spin" /> Marking your quiz…</> : <><Send size={17} /> Submit and receive feedback</>}</button> : <div className="ctq-finished-actions"><button type="button" className="ctq-back" onClick={closeQuiz}><ArrowLeft size={16} /> Return to Core Training modules</button><button type="button" className="ctq-retake" onClick={() => { setResult(null); setAnswers({}); setAutosave("Ready to retake"); }}><RotateCcw size={16} /> Start a new attempt</button></div>}
    </section>;
  }

  if (level) return <section className="ctq-shell" aria-labelledby="core-level-heading"><div className="ctq-topbar"><button type="button" className="ctq-back" onClick={() => setLevel("")}><ArrowLeft size={16} /> Career levels</button></div><header className="ctq-hero compact"><span>01 Core Training Modules</span><h2 id="core-level-heading">{level}</h2><p>Choose a module to begin or continue its interactive knowledge check.</p></header>{error ? <p className="ctq-alert error"><AlertCircle size={16} /> {error}</p> : null}<div className="ctq-module-grid">{quizzes.map((item) => <button key={item.quizId} type="button" className="ctq-module-card" onClick={() => openQuiz(item.quizId)} disabled={busy}><span className="ctq-module-code">{item.code}</span><strong>{item.title}</strong><small>{item.questionCount} questions · threshold {item.threshold.passMark}/{item.questionCount}</small>{submissions[item.quizId] ? <em><CheckCircle2 size={14} /> {submissions[item.quizId].result || "Previously submitted"}</em> : <span className="ctq-start">Open quiz <ChevronRight size={15} /></span>}</button>)}</div>{busy ? <p className="ctq-alert"><Loader2 size={16} className="spin" /> Opening your quiz…</p> : null}</section>;

  return <section className="ctq-shell" aria-labelledby="core-training-heading"><div className="ctq-topbar"><button type="button" className="ctq-back" onClick={onBack}><ArrowLeft size={16} /> My Learning</button></div><header className="ctq-hero compact"><span>01 Core Training Modules</span><h2 id="core-training-heading"><GraduationCap size={24} /> Career levels &amp; assessments</h2><p>Choose your career level, then select the relevant module or topic. Answers autosave as you work and are marked only after you submit.</p></header>{error ? <p className="ctq-alert error"><AlertCircle size={16} /> {error}</p> : null}{loading ? <p className="ctq-alert"><Loader2 size={16} className="spin" /> Loading Core Training modules…</p> : <div className="ctq-level-grid">{levels.map((item) => <button key={item.careerLevel} type="button" className="ctq-level-card" onClick={() => setLevel(item.careerLevel)}><FolderOpen size={22} /><span><strong>{item.careerLevel}</strong><small>{item.quizzes.length} interactive module{item.quizzes.length === 1 ? "" : "s"}</small></span><ChevronRight size={18} /></button>)}</div>}<p className="ctq-footnote"><AlertCircle size={15} /> Each assessment is marked against the supplied controlled marker key only after you submit. If a question raises a live technical or authority issue, follow the current approved procedure and seek the allocated reviewer’s direction.</p></section>;
}
