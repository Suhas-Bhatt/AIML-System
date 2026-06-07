import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function POST(request) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "Gemini API key is not configured on the server." },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const jobDescription = formData.get("jobDescription") || "General ATS Check";

    if (!file) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    // Convert file to buffer for pdf-parse
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let resumeText = "";
    if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
      const pdfData = await pdfParse(buffer);
      resumeText = pdfData.text;
    } else {
      return NextResponse.json(
        { error: "Unsupported file format. Please upload a PDF." },
        { status: 400 }
      );
    }

    // Call Gemini API
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `
You are an expert Applicant Tracking System (ATS). 
Analyze the following resume text against the provided Job Description (if any).
Provide the result strictly as a valid JSON object with the following keys:
1. "score": An integer from 0 to 100 representing the match percentage.
2. "keywordsMatched": An array of strings representing keywords from the JD found in the resume.
3. "keywordsMissing": An array of strings representing important keywords from the JD missing in the resume.
4. "feedback": A brief paragraph giving constructive feedback on how to improve the resume for this role.

Job Description:
${jobDescription}

Resume Text:
${resumeText}

Respond ONLY with the JSON. Do not use markdown blocks (\`\`\`json).
`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();
    
    // Attempt to parse JSON response
    let atsResult;
    try {
      // Sometimes models add markdown blocks even if told not to
      const cleaned = responseText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
      atsResult = JSON.parse(cleaned);
    } catch (e) {
      console.error("Failed to parse Gemini response:", responseText);
      return NextResponse.json({ error: "Failed to parse ATS response from AI." }, { status: 500 });
    }

    return NextResponse.json(atsResult, { status: 200 });
  } catch (error) {
    console.error("ATS API Error:", error);
    return NextResponse.json(
      { error: "An error occurred during ATS analysis." },
      { status: 500 }
    );
  }
}
