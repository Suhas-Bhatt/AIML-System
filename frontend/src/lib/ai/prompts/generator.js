export function buildGeneratorPrompt(
  description,
  durationMinutes,
  language,
  jobDescription,
  resumeText,
) {
  const languageInstruction = language && language !== "en"
    ? `\nLANGUAGE: All generated content (title, description, objective, assessment criteria names & descriptions, question texts & descriptions, follow-up prompts, and aiName) MUST be written in ${language}. Only the JSON keys and enum values (e.g. "OPEN_ENDED", "PROFESSIONAL") should remain in English.\n`
    : "";

  const contextInstruction = (jobDescription || resumeText)
    ? `\nCONTEXT DOCUMENTS:\n${jobDescription ? "- A JOB DESCRIPTION has been provided. Tailor questions to assess the specific skills, qualifications, and responsibilities listed in the JD. Derive assessment criteria from the role requirements." : ""}\n${resumeText ? "- A CANDIDATE RESUME has been provided. Include questions that probe the candidate's claimed experience, validate key skills, and explore any gaps or transitions in their background." : ""}\n${jobDescription && resumeText ? "- When both are provided, focus on the intersection: how well the candidate's experience maps to the role requirements, and probe areas where there may be gaps." : ""}\n`
    : "";

  return [
    {
      role: "system",
      content: `You are an expert interview designer. Create a comprehensive interview structure based on the user's requirements.\n${languageInstruction}${contextInstruction}\nTASK:\nDesign a complete interview with:\n1. A compelling title\n2. A brief description (1-2 sentences summarizing the interview purpose)\n3. Clear objective statement\n4. 3-6 specific, measurable assessment criteria based on the interview objective\n5. 5-15 well-crafted questions in logical flow\n6. Recommended question types for each\n7. Optimal AI persona configuration\n\nGUIDELINES:\n- Start with an ice-breaker/warm-up question\n- Group related topics together\n- Place most important questions in the middle (when engagement is highest)\n- End with an open "anything else" question\n- Use OPEN_ENDED for free-text/verbal responses, SINGLE_CHOICE when the participant must pick exactly one option, MULTIPLE_CHOICE when multiple selections are allowed, CODING for programming/algorithm questions, and RESEARCH when the goal is to extract as much detailed information as possible on a topic\n- For SINGLE_CHOICE and MULTIPLE_CHOICE questions, ALWAYS provide 2-6 clear option strings in the "options" field\n- For CODING questions, set "options" to null. Write a clear problem statement in the question text. Include a "starterCode" object with "language" and "code" fields containing a code template for the participant.\n- Suggest time limits where appropriate\n- Assessment criteria should be specific dimensions the participant will be evaluated on (e.g. "Communication Skills", "Problem Solving Ability", "Cultural Fit")\n\nQUESTION TYPES:\n- "OPEN_ENDED": Free-form text or verbal response. Set "options" to null.\n- "SINGLE_CHOICE": Participant picks exactly one option. MUST include "options" with 2-6 option strings.\n- "MULTIPLE_CHOICE": Participant can select more than one option. MUST include "options" with 2-6 option strings.\n- "CODING": A coding/programming question where the participant writes code using a built-in code editor. Set "options" to null. The question text should clearly describe the problem to solve.\n- "RESEARCH": A deep-dive question designed to extract comprehensive information on a topic. The interviewer will apply deeper follow-ups to explore every angle. Set "options" to null. Use when the goal is thorough knowledge extraction rather than evaluation.\n\nOUTPUT VALID JSON ONLY (no markdown, no explanation):\n{\n  "title": "string",\n  "description": "string (1-2 sentence summary of the interview purpose)",\n  "objective": "string",\n  "assessmentCriteria": [\n    { "name": "string (criterion name)", "description": "string (what this criterion measures)" }\n  ],\n  "estimatedDurationMinutes": number,\n  "questions": [\n    {\n      "order": number,\n      "text": "string",\n      "type": "OPEN_ENDED" | "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "CODING" | "WHITEBOARD" | "RESEARCH",\n      "description": "string (helper text for the question)",\n      "timeLimitSeconds": number | null,\n      "isRequired": true,\n      "options": { "options": ["string", "string", ...], "allowMultiple": false } | null,\n      "followUpPrompts": ["string"],\n      "starterCode": { "language": "string", "code": "string" } | null\n    }\n  ],\n  "recommendedSettings": {\n    "mode": "CHAT" | "VOICE" | "HYBRID",\n    "followUpDepth": "LIGHT" | "MODERATE" | "DEEP",\n    "aiTone": "CASUAL" | "PROFESSIONAL" | "FORMAL" | "FRIENDLY",\n    "aiName": "string suggestion"\n  }\n}`,
    },
    {
      role: "user",
      content: `Create an interview for the following goal:\n\n"${description}"\n\n${durationMinutes ? `Target duration: approximately ${durationMinutes} minutes.` : ""}\n${jobDescription ? `\n--- JOB DESCRIPTION ---\n${jobDescription}\n--- END JOB DESCRIPTION ---\n` : ""}\n${resumeText ? `\n--- CANDIDATE RESUME ---\n${resumeText}\n--- END CANDIDATE RESUME ---\n` : ""}\nPlease generate the complete interview structure as JSON.`,
    },
  ];
}

export function buildImprovePrompt(
  currentInterview,
  feedback,
  language,
  jobDescription,
  resumeText,
) {
  const questionsText = currentInterview.questions
    .map((q, i) => `${i + 1}. [${q.type}] ${q.text}`)
    .join("\n");

  const criteriaText = currentInterview.assessmentCriteria?.length
    ? currentInterview.assessmentCriteria
        .map((c) => `- ${c.name}: ${c.description}`)
        .join("\n")
    : "None defined";

  return [
    {
      role: "system",
      content: `You are an expert interview designer. Improve an existing interview based on user feedback.\n${language && language !== "en" ? `\nLANGUAGE: All generated content (title, description, objective, assessment criteria names & descriptions, question texts & descriptions, follow-up prompts, and aiName) MUST be written in ${language}. Only the JSON keys and enum values (e.g. "OPEN_ENDED", "PROFESSIONAL") should remain in English.\n` : ""}\nQUESTION TYPES:\n- "OPEN_ENDED": Free-form text or verbal response. Set "options" to null.\n- "SINGLE_CHOICE": Participant picks exactly one option. MUST include "options" with 2-6 option strings.\n- "MULTIPLE_CHOICE": Participant can select more than one option. MUST include "options" with 2-6 option strings.\n- "CODING": A coding/programming question where the participant writes code. Set "options" to null.\n- "RESEARCH": A deep-dive question for extracting comprehensive information on a topic. Set "options" to null.\n\nOUTPUT VALID JSON ONLY (no markdown, no explanation):\n{\n  "title": "string",\n  "description": "string (1-2 sentence summary of the interview purpose)",\n  "objective": "string",\n  "assessmentCriteria": [\n    { "name": "string (criterion name)", "description": "string (what this criterion measures)" }\n  ],\n  "estimatedDurationMinutes": number,\n  "questions": [\n    {\n      "order": number,\n      "text": "string",\n      "type": "OPEN_ENDED" | "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "CODING" | "WHITEBOARD" | "RESEARCH",\n      "description": "string (helper text for the question)",\n      "timeLimitSeconds": number | null,\n      "isRequired": true,\n      "options": { "options": ["string", "string", ...], "allowMultiple": false } | null,\n      "followUpPrompts": ["string"],\n      "starterCode": { "language": "string", "code": "string" } | null\n    }\n  ],\n  "recommendedSettings": {\n    "mode": "CHAT" | "VOICE" | "HYBRID",\n    "followUpDepth": "LIGHT" | "MODERATE" | "DEEP",\n    "aiTone": "CASUAL" | "PROFESSIONAL" | "FORMAL" | "FRIENDLY",\n    "aiName": "string suggestion"\n  }\n}\n\nIMPORTANT: Each question MUST have a "text" field with the question content.\nIMPORTANT: Always include 3-6 assessment criteria.\nIMPORTANT: Always include a "description" field with a 1-2 sentence summary.\nIMPORTANT: For SINGLE_CHOICE and MULTIPLE_CHOICE questions, ALWAYS include "options" with 2-6 clear choices.`,
    },
    {
      role: "user",
      content: `Current interview:\nTitle: ${currentInterview.title}\nDescription: ${currentInterview.description ?? "Not set"}\nObjective: ${currentInterview.objective ?? "Not set"}\nAssessment Criteria:\n${criteriaText}\nQuestions:\n${questionsText}\n\n${jobDescription ? `\n--- JOB DESCRIPTION ---\n${jobDescription}\n--- END JOB DESCRIPTION ---\n` : ""}\n${resumeText ? `\n--- CANDIDATE RESUME ---\n${resumeText}\n--- END CANDIDATE RESUME ---\n` : ""}\nUser feedback: "${feedback}"\n\nPlease improve this interview based on the feedback. Output ONLY valid JSON.`,
    },
  ];
}
