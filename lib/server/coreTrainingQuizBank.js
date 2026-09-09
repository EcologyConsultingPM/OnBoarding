import "server-only";
import catalogue from "../../data/core-training/quizzes.public.json";
import markerKeys from "./coreTrainingQuizKeys.json";

const byId = new Map(catalogue.map((quiz) => [quiz.quizId, quiz]));

export const CORE_TRAINING_QUIZZES = catalogue.map((quiz) => ({
  quizId: quiz.quizId,
  code: quiz.code,
  careerLevel: quiz.careerLevel,
  title: quiz.title,
  questionCount: quiz.questionCount,
  threshold: quiz.threshold,
}));

export function findCoreTrainingQuiz(quizId) {
  return byId.get(String(quizId || "")) || null;
}

export function questionsForCoreTrainingQuiz(quizId) {
  const quiz = findCoreTrainingQuiz(quizId);
  if (!quiz) return null;
  return {
    quizId: quiz.quizId,
    code: quiz.code,
    careerLevel: quiz.careerLevel,
    title: quiz.title,
    questionCount: quiz.questionCount,
    threshold: quiz.threshold,
    questions: quiz.questions,
  };
}

export function markerKeyForCoreTrainingQuiz(quizId) {
  return markerKeys[String(quizId || "")] || null;
}

export function catalogueByCareerLevel() {
  const groups = new Map();
  for (const quiz of CORE_TRAINING_QUIZZES) {
    if (!groups.has(quiz.careerLevel)) groups.set(quiz.careerLevel, []);
    groups.get(quiz.careerLevel).push(quiz);
  }
  return [...groups.entries()].map(([careerLevel, quizzes]) => ({
    careerLevel,
    quizzes: quizzes.sort((left, right) => left.code.localeCompare(right.code)),
  }));
}
