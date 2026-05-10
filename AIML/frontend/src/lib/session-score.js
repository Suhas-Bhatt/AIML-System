function averageScore(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const scores = entries
    .map((entry) => {
      if (!entry || entry.score == null) return null;
      return typeof entry.score === "number"
        ? entry.score
        : Number(entry.score);
    })
    .filter((score) => Number.isFinite(score));
  if (scores.length === 0) return null;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

export function getSessionOverallScore(
  insights,
) {
  const questionScore = averageScore(insights?.questionEvaluations);
  if (questionScore !== null) return questionScore;
  return averageScore(insights?.criteriaEvaluations);
}

export function usesQuestionEvaluationScore(
  insights,
) {
  return averageScore(insights?.questionEvaluations) !== null;
}
