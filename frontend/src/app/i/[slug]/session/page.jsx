"use client";

import { AntiCheatingGuard } from '../../../../components/session/anti-cheating-banner.jsx';
import { FullscreenEnforcement } from '../../../../components/session/fullscreen-enforcement.jsx';
import { IntervieweeOnboarding, PreviewWrapper } from '../../../../components/session/interviewee-onboarding.jsx';
import { IntervieweeTourOverlay } from '../../../../components/session/interviewee-tour-overlay.jsx';
import { IntervieweeTourProvider } from '../../../../components/session/interviewee-tour-provider.jsx';
import { PreparingScreen } from '../../../../components/session/preparing-screen.jsx';
import { Button } from '../../../../components/ui/button.jsx';
import { Card, CardContent } from '../../../../components/ui/card.jsx';
import { trpc } from '../../../../lib/trpc/client.js';
import { CheckCircle2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_PREFIX = "aural_session_";

const ChatInterface = dynamic(
  () => import("../../../../components/session/chat-interface.jsx").then((m) => m.ChatInterface),
  { ssr: false, loading: () => <PreparingScreen /> },
);
const VoiceInterface = dynamic(
  () => import("../../../../components/session/voice-interface.jsx").then((m) => m.VoiceInterface),
  { ssr: false, loading: () => <PreparingScreen /> },
);
const AIProctoringManager = dynamic(
  () => import("../../../../components/session/ai-proctoring-manager.jsx").then((m) => m.AIProctoringManager),
  { ssr: false },
);

export default function SlugSessionPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const slug = params.slug;
  const sidParam = searchParams.get("sid");
  const isPreview = searchParams.get("preview") === "true";

  const [completed, setCompleted] = useState(false);
  const [completionReason, setCompletionReason] = useState();
  const [fullscreenTerminated, setFullscreenTerminated] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(isPreview);
  const [previewTourDone, setPreviewTourDone] = useState(false);
  const [interviewStarted, setInterviewStarted] = useState(false);

  const handleComplete = (reason) => {
    setCompletionReason(reason);
    setCompleted(true);
  };

  const handleTourReady = useCallback(() => {
    setPreviewTourDone(true);
  }, []);

  const sessionId = useMemo(() => {
    if (sidParam) return sidParam;
    try { return localStorage.getItem(STORAGE_PREFIX + slug); } catch { return null; }
  }, [sidParam, slug]);

  const interview = trpc.interview.getBySlug.useQuery({ slug }, { retry: false });
  const session = trpc.session.getById.useQuery(
    { id: sessionId },
    {
      enabled: !!sessionId,
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
  );

  useEffect(() => {
    // Only redirect if there's no sessionId, or the session query has fully
    // failed (not loading, not retrying) — avoids the race condition where the
    // session is created but not yet readable on the first query attempt.
    if (!sessionId) {
      router.replace(`/i/${slug}`);
      return;
    }
    if (session.isError && !session.isLoading && !session.isFetching) {
      router.replace(`/i/${slug}`);
    }
  }, [sessionId, session.isError, session.isLoading, session.isFetching, slug, router]);


  if (interview.isLoading || session.isLoading || !interview.data || !session.data) {
    return <PreparingScreen />;
  }

  if (fullscreenTerminated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            <h2 className="text-2xl font-bold text-red-600">Interview Terminated</h2>
            <p className="mt-2 text-muted-foreground">
              You exited fullscreen and did not return in time, violating the interview rules.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (session.data.status === "COMPLETED" || completed) {
    try { localStorage.removeItem(STORAGE_PREFIX + slug); } catch { /* noop */ }
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="mx-auto h-16 w-16 text-secondary-500" />
            <h2 className="mt-4 text-2xl font-bold">Thank you!</h2>
            {completionReason === "TIME_LIMIT_EXCEEDED" && (
              <p className="mt-2 text-sm text-amber-600">
                The session time limit has been reached and the interview was ended automatically.
              </p>
            )}
            <p className="mt-2 text-muted-foreground">
              Your interview has been completed successfully. We appreciate your
              time and thoughtful responses.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const antiCheatingEnabled = !isPreview && !!interview.data.antiCheatingEnabled;

  if (!onboardingDone) {
    return (
      <div className="relative min-h-screen w-full">
        <div className="absolute right-4 top-4 z-50">
          <Button variant="outline" size="sm" onClick={() => setOnboardingDone(true)}>
            Skip Checks (Dev)
          </Button>
        </div>
        <IntervieweeOnboarding
          interviewTitle={interview.data.title}
          interviewDescription={interview.data.description}
          questionCount={interview.data.questions.length}
          timeLimitMinutes={interview.data.timeLimitMinutes}
          language={interview.data.language}
          antiCheatingEnabled={antiCheatingEnabled}
          voiceEnabled={!!interview.data.voiceEnabled}
          chatEnabled={!!interview.data.chatEnabled}
          aiName={interview.data.aiName}
          questionTypes={interview.data.questions.map((q) => q.type)}
          onComplete={() => {
            if (antiCheatingEnabled) {
              document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
            }
            setOnboardingDone(true);
          }}
        />
      </div>
    );
  }

  // Derive resume state
  const resumeMessages = session.data.messages;
  const resumeQuestionIndex = (() => {
    const { currentQuestionId } = session.data;
    if (currentQuestionId) {
      const idx = interview.data.questions.findIndex((q) => q.id === currentQuestionId);
      if (idx >= 0) return idx;
    }
    return 0;
  })();

  const isResuming = resumeMessages && resumeMessages.length > 0;

  const resumeTextMessages = resumeMessages
    ?.filter((m) => m.contentType === "TEXT")
    .map((m) => ({ id: m.id, role: m.role, content: m.content }));

  const resumeDrawings = resumeMessages
    ?.filter((m) => m.contentType === "WHITEBOARD" && m.whiteboardData)
    .map((m) => ({
      id: m.content,
      label: m.whiteboardData?.label ?? "Drawing",
      snapshotData: JSON.stringify(m.whiteboardData),
    }));

  const useVoice = interview.data.voiceEnabled;

  const showPreviewTour = isPreview && !previewTourDone;

  if (showPreviewTour) {
    const mode = useVoice ? "voice" : "chat";
    const mockContext = {
      title: interview.data.title,
      aiName: interview.data.aiName ?? "AI Interviewer",
      aiTone: "professional",
      language: interview.data.language ?? "en-US",
      followUpDepth: "medium",
      questions: interview.data.questions.map((q, i) => ({
        text: q.text,
        type: q.type,
        order: i,
      })),
    };

    return (
      <IntervieweeTourProvider mode={mode}>
        <PreviewWrapper onReady={handleTourReady}>
          {mode === "voice" ? (
            <VoiceInterface
              sessionId="__preview__"
              interviewId="__preview__"
              interviewTitle={interview.data.title}
              aiName={interview.data.aiName ?? "AI Interviewer"}
              questionCount={interview.data.questions.length}
              interviewContext={mockContext}
              durationMinutes={interview.data.timeLimitMinutes ?? undefined}
              chatEnabled={!!interview.data.chatEnabled}
              onComplete={() => {}}
              preview
            />
          ) : (
            <>
              <AIProctoringManager 
                sessionId="__preview__"
                enabled={true}
                preview={true}
              />
              <ChatInterface
                sessionId="__preview__"
              interview={{
                id: "__preview__",
                title: interview.data.title,
                aiName: interview.data.aiName ?? "AI Interviewer",
                mode: "CHAT",
                questions: mockContext.questions.map((q, i) => ({
                  id: `preview-q-${i}`,
                  text: q.text,
                  type: q.type,
                })),
              }}
              durationMinutes={interview.data.timeLimitMinutes ?? undefined}
              onComplete={() => {}}
              preview
            />
            </>
          )}
        </PreviewWrapper>
        <IntervieweeTourOverlay />
      </IntervieweeTourProvider>
    );
  }

  if (useVoice) {
    const interviewContext = {
      title: interview.data.title,
      objective: interview.data.objective,
      aiName: interview.data.aiName,
      aiTone: interview.data.aiTone,
      language: interview.data.language,
      followUpDepth: interview.data.followUpDepth,
      startQuestionIndex: isResuming ? resumeQuestionIndex : undefined,
      questions: interview.data.questions.map((q) => ({
        text: q.text,
        type: q.type,
        description: q.description,
        options: q.options,
        starterCode: q.starterCode,
        order: q.order,
      })),
    };

    return (
      <>
        <AntiCheatingGuard enabled={antiCheatingEnabled} sessionId={sessionId} />
        <FullscreenEnforcement
          enabled={antiCheatingEnabled && interviewStarted}
          sessionId={sessionId}
          onTerminated={() => setFullscreenTerminated(true)}
        />
        <VoiceInterface
          sessionId={sessionId}
          interviewId={interview.data.id}
          interviewTitle={interview.data.title}
          aiName={interview.data.aiName}
          questionCount={interview.data.questions.length}
          interviewContext={interviewContext}
          durationMinutes={interview.data.timeLimitMinutes ?? undefined}
          initialMessages={isResuming ? resumeTextMessages : undefined}
          initialDrawings={isResuming && resumeDrawings?.length ? resumeDrawings : undefined}
          chatEnabled={!!interview.data.chatEnabled}
          onStart={() => setInterviewStarted(true)}
          onComplete={handleComplete}
          videoMode={isPreview ? false : !!interview.data.videoEnabled}
          proctoringEnabled={antiCheatingEnabled}
        />
      </>
    );
  }

  return (
    <>
      <AntiCheatingGuard enabled={antiCheatingEnabled} sessionId={sessionId} />
      <FullscreenEnforcement
        enabled={antiCheatingEnabled && interviewStarted}
        sessionId={sessionId}
        onTerminated={() => setFullscreenTerminated(true)}
      />
      {(antiCheatingEnabled || isPreview) && (
        <AIProctoringManager sessionId={sessionId} enabled={interviewStarted || isPreview} preview={isPreview} />
      )}
      <ChatInterface
        sessionId={sessionId}
        interview={{
          ...interview.data,
          questions: interview.data.questions.map((q) => ({
            ...q,
            starterCode: q.starterCode,
          })),
        }}
        durationMinutes={interview.data.timeLimitMinutes ?? undefined}
        initialMessages={resumeMessages
          ?.filter((m) => m.contentType !== "WHITEBOARD")
          .map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp.toString(),
          }))}
        initialQuestionIndex={isResuming ? resumeQuestionIndex : undefined}
        onStart={() => setInterviewStarted(true)}
        onComplete={handleComplete}
      />
    </>
  );
}
