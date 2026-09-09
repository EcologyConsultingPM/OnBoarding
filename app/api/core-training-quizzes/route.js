import { requireSession, serverError } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";
import {
  catalogueByCareerLevel,
  findCoreTrainingQuiz,
  markerKeyForCoreTrainingQuiz,
  questionsForCoreTrainingQuiz,
} from "../../../lib/server/coreTrainingQuizBank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const responseError = (message, status = 400) =>
  Response.json({ error: message }, { status });

async function authoriseLearning(request) {
  const access = await requireSession(request);
  if (access.error) return { error: access.error };
  const denied = await requirePortalResource(access, "staff.learning");
  if (denied) return { error: denied };
  return { access };
}

function cleanAnswers(quiz, raw) {
  const valid = new Set(quiz.questions.map((question) => String(question.number)));
  return Object.fromEntries(
    Object.entries(raw && typeof raw === "object" ? raw : {})
      .filter(([number, answer]) => valid.has(String(number)) && ["A", "B", "C", "D"].includes(String(answer || "").trim().toUpperCase()))
      .map(([number, answer]) => [String(number), String(answer).trim().toUpperCase()]),
  );
}

function mark(quiz, answers) {
  const key = markerKeyForCoreTrainingQuiz(quiz.quizId);
  if (!key?.answers) throw new Error("The protected marking guide is unavailable for this quiz.");
  const results = quiz.questions.map((question) => {
    const questionId = String(question.number);
    const selectedAnswer = answers[questionId] || null;
    const correctAnswer = key.answers[questionId];
    return {
      questionId,
      selectedAnswer,
      correctAnswer,
      correct: selectedAnswer === correctAnswer,
      rationale: key.rationales?.[questionId] || "Review the current controlled material and discuss uncertainty with your supervisor.",
    };
  });
  const score = results.filter((result) => result.correct).length;
  const total = results.length;
  const passMark = Number(quiz.threshold?.passMark) || 30;
  return { score, total, passMark, passed: score >= passMark, results };
}

export async function GET(request) {
  try {
    const auth = await authoriseLearning(request);
    if (auth.error) return auth.error;
    const { access } = auth;
    const quizId = new URL(request.url).searchParams.get("quizId");
    if (!quizId) {
      const { data, error } = await access.admin
        .from("quiz_submissions")
        .select("id, quiz_id, submitted_at, result")
        .eq("staff_user_id", access.user.id)
        .like("quiz_id", "core-%")
        .order("submitted_at", { ascending: false })
        .limit(100);
      if (error) return responseError(error.message);
      const latestSubmissions = {};
      for (const row of data || []) if (!latestSubmissions[row.quiz_id]) latestSubmissions[row.quiz_id] = row;
      return Response.json({ careerLevels: catalogueByCareerLevel(), latestSubmissions });
    }

    const quiz = findCoreTrainingQuiz(quizId);
    const quizForStaff = questionsForCoreTrainingQuiz(quizId);
    if (!quiz || !quizForStaff) return responseError("This Core Training quiz is not available.", 404);
    const { data: draft, error: draftError } = await access.admin
      .from("core_training_quiz_drafts")
      .select("answers, updated_at")
      .eq("staff_user_id", access.user.id)
      .eq("quiz_id", quiz.quizId)
      .maybeSingle();
    if (draftError) return responseError("Quiz autosave is not ready. Ask the Portal Manager to complete the quiz migration.", 503);

    const { data: prior, error: priorError } = await access.admin
      .from("quiz_submissions")
      .select("id, answers, submitted_at, result")
      .eq("staff_user_id", access.user.id)
      .eq("quiz_id", quiz.quizId)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (priorError) return responseError(priorError.message);

    const submission = prior
      ? { id: prior.id, answers: cleanAnswers(quiz, prior.answers), submittedAt: prior.submitted_at, summary: prior.result, ...mark(quiz, cleanAnswers(quiz, prior.answers)) }
      : null;
    return Response.json({ quiz: quizForStaff, draft: draft ? { answers: cleanAnswers(quiz, draft.answers), updatedAt: draft.updated_at } : null, submission });
  } catch (caught) {
    return serverError(caught);
  }
}

// Autosave is a draft only: it neither grades a quiz nor creates a learning completion.
export async function PATCH(request) {
  try {
    const auth = await authoriseLearning(request);
    if (auth.error) return auth.error;
    const body = await request.json();
    const quiz = findCoreTrainingQuiz(body?.quizId);
    if (!quiz) return responseError("This Core Training quiz is not available.", 404);
    const answers = cleanAnswers(quiz, body?.answers);
    const { data, error } = await auth.access.admin
      .from("core_training_quiz_drafts")
      .upsert({ staff_user_id: auth.access.user.id, quiz_id: quiz.quizId, answers, updated_at: new Date().toISOString() }, { onConflict: "staff_user_id,quiz_id" })
      .select("updated_at")
      .single();
    if (error) return responseError("Could not autosave this quiz. Your answers remain in this browser; please try again.", 503);
    return Response.json({ autosavedAt: data.updated_at, answerCount: Object.keys(answers).length });
  } catch (caught) {
    return serverError(caught);
  }
}

// Grading occurs only after a deliberate submission. The protected key is never returned beforehand.
export async function POST(request) {
  try {
    const auth = await authoriseLearning(request);
    if (auth.error) return auth.error;
    const body = await request.json();
    const quiz = findCoreTrainingQuiz(body?.quizId);
    if (!quiz) return responseError("This Core Training quiz is not available.", 404);
    const answers = cleanAnswers(quiz, body?.answers);
    if (Object.keys(answers).length !== quiz.questions.length) return responseError(`Answer all ${quiz.questions.length} questions before submitting this quiz.`);
    const feedback = mark(quiz, answers);
    const result = `${feedback.passed ? "Knowledge threshold met" : "Further learning required"} — ${feedback.score}/${feedback.total} (${Math.round((feedback.score / feedback.total) * 100)}%)`;
    const { data: submission, error } = await auth.access.admin
      .from("quiz_submissions")
      .insert({ quiz_id: quiz.quizId, topic: quiz.title, level: quiz.careerLevel, staff_user_id: auth.access.user.id, answers, result })
      .select("id, submitted_at, result")
      .single();
    if (error) return responseError(error.message);
    const { error: clearError } = await auth.access.admin
      .from("core_training_quiz_drafts")
      .delete()
      .eq("staff_user_id", auth.access.user.id)
      .eq("quiz_id", quiz.quizId);
    if (clearError) console.error("Could not clear Core Training quiz draft", clearError);
    return Response.json({ submission: { id: submission.id, submittedAt: submission.submitted_at, summary: submission.result }, ...feedback });
  } catch (caught) {
    return serverError(caught);
  }
}
