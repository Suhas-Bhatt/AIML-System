"use client";

import { QuestionBuilder } from '../../../../../components/interview/question-builder.jsx';
import { useEditInterview } from './edit-context.js';

export default function ContentTab() {
  const { interview, interviewId } = useEditInterview();

  return (
    <QuestionBuilder
      interviewId={interviewId}
      questions={interview.questions.map((q) => ({
        ...q,
        starterCode: q.starterCode,
      }))}
      assessmentCriteria={interview.assessmentCriteria}
    />
  );
}
