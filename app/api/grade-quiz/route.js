import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Grades a multiple-choice quiz server-side. The answer key lives in
// quiz_answer_keys, which only admins can SELECT directly — this route
// is the one legitimate way a regular signed-in user's browser ever
// learns which option was correct, and only after they've submitted.
export async function POST(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    return Response.json({ error: "Not configured on the server." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return Response.json({ error: "Not authenticated." }, { status: 401 });

  const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: userData, error: userErr } = await anon.auth.getUser(token);
  if (userErr || !userData?.user) return Response.json({ error: "Invalid session." }, { status: 401 });

  let quizId, submittedAnswers;
  try {
    const body = await request.json();
    quizId = String(body?.quizId || "");
    submittedAnswers = body?.answers || {};
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!quizId) return Response.json({ error: "Missing quizId." }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: keyRow, error: keyErr } = await admin
    .from("quiz_answer_keys")
    .select("answers")
    .eq("quiz_id", quizId)
    .maybeSingle();
  if (keyErr) return Response.json({ error: "Could not load the answer key." }, { status: 500 });
  if (!keyRow) return Response.json({ error: "No answer key found for this quiz." }, { status: 404 });

  const correctAnswers = keyRow.answers || {};
  const results = Object.keys(correctAnswers).map((questionId) => {
    const correctIndex = correctAnswers[questionId];
    const submitted = submittedAnswers[questionId];
    return { questionId, correctIndex, submitted, correct: submitted === correctIndex };
  });
  const score = results.filter((r) => r.correct).length;

  return Response.json({ score, total: results.length, results });
}
