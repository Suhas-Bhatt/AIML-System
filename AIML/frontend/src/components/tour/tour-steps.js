export const TOUR_STEPS = [
  {
    id: "new-interview",
    selector: '[data-tour="new-interview"]',
    title: "Create a new interview",
    description:
      'Click **"+ New Interview"** to set up your first AI-powered interview.',
    page: "/dashboard",
    placement: "bottom",
  },
  {
    id: "interview-prompt",
    selector: '[data-tour="interview-prompt"]',
    title: "Describe your interview",
    description:
      "**Type a description** of the interview you need. Be specific about the role and skills you want to assess.",
    page: "/interviews/new",
    placement: "bottom",
    noAutoAdvance: true,
    requireInput: "#ai-description",
  },
  {
    id: "generate-interview",
    selector: '[data-tour="generate-interview"]',
    title: "Generate with AI",
    description:
      'Click **"Generate"** to let AI create a complete interview structure with questions and assessment criteria.',
    page: "/interviews/new",
    placement: "top",
  },
  {
    id: "accept-create",
    selector: '[data-tour="accept-create"]',
    title: "Accept & create",
    description:
      'Review the AI-generated questions, then click **"Accept & create"** to create the interview.',
    page: "/interviews/new",
    placement: "top",
    waitFor: '[data-tour="accept-create"]',
  },
  {
    id: "add-session",
    selector: '[data-tour="add-session"]',
    title: "Add candidates",
    description:
      'Click **"+ Add"** to invite candidates to your interview.',
    page: "/edit/sessions",
    placement: "top",
    noAutoAdvance: true,
    advanceOnAppear: '[data-tour="create-individually"]',
  },
  {
    id: "create-individually",
    selector: '[data-tour="create-individually"]',
    title: "Create individually",
    description:
      'Select **"Create individually"** to add a new candidate to your interview.',
    page: "/edit/sessions",
    placement: "left",
    waitFor: '[data-tour="create-individually"]',
  },
  {
    id: "save-candidate",
    selector: '[data-tour="save-candidate"]',
    title: "Save candidate details",
    description:
      'Fill in the candidate\'s name and details, then click **"Save and add"**.',
    page: "/edit/sessions",
    placement: "left",
    noAutoAdvance: true,
    waitFor: '[data-tour="save-candidate"]',
    advanceOnAppear: '[data-tour="copy-link"]',
  },
  {
    id: "copy-link",
    selector: '[data-tour="copy-link"]',
    title: "Share the invite link",
    description:
      'Click **"Copy link"** to copy the interview invite URL. Share it with your candidate to start the interview.',
    page: "/edit/sessions",
    placement: "left",
    waitFor: '[data-tour="copy-link"]',
  },
];

export const TOUR_STORAGE_KEY = "aural_onboarding_tour";
export const TOUR_EDIT_URL_KEY = "aural_tour_last_edit_url";

export function getStoredTourState() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(TOUR_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredTourState(state) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(state));
}
