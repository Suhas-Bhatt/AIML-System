"use client";

import { useState } from "react";
import { IntervieweeOnboarding } from "../../../components/session/interviewee-onboarding.jsx";
import { IntegratedInterviewApp } from "../../../components/interview/integrated-interview-app.jsx";

export default function InterviewPage({ params }) {
  // phase can be "setup", "interview", "completed"
  const [phase, setPhase] = useState("setup");

  const handleSetupComplete = () => {
    // Optional: Request Fullscreen before starting interview
    try { 
      document.documentElement.requestFullscreen({ navigationUI: "hide" }); 
    } catch { 
      // fallback if fullscreen fails 
    }
    setPhase("interview");
  };

  const handleInterviewComplete = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    }
    setPhase("completed");
  };

  if (phase === "setup") {
    return (
      <IntervieweeOnboarding
        initialStep="info"
        onDone={handleSetupComplete}
        interview={{
          id: params.slug,
          candidate_name: "Candidate",
          interview_title: "Python Technical Assessment",
          interview_type: "Technical",
          company_name: "AIML Inc.",
          status: "scheduled"
        }}
        session={{
          language: "en"
        }}
      />
    );
  }

  if (phase === "interview") {
    return <IntegratedInterviewApp onComplete={handleInterviewComplete} />;
  }

  // Fallback (though IntegratedInterviewApp handles "completed" state internally as well)
  return null;
}
