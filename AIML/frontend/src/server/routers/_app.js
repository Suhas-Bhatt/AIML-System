import { router } from '../trpc.js';
import { interviewRouter } from './interview.js';
import { questionRouter } from './question.js';
import { sessionRouter } from './session.js';
import { analysisRouter } from './analysis.js';
import { organizationRouter } from './organization.js';
import { orgMemberRouter } from './orgMember.js';
import { projectRouter } from './project.js';
import { authRouter } from './auth.js';
import { apiKeyRouter } from './apikey.js';
import { userRouter } from './user.js';
import { webhookRouter } from './webhook.js';
import { candidateRouter } from './candidate.js';
import { usageRouter } from './usage.js';
import { proctoringRouter } from './proctoring.js';

export const appRouter = router({
  auth: authRouter,
  interview: interviewRouter,
  question: questionRouter,
  session: sessionRouter,
  analysis: analysisRouter,
  organization: organizationRouter,
  orgMember: orgMemberRouter,
  project: projectRouter,
  apiKey: apiKeyRouter,
  webhook: webhookRouter,
  user: userRouter,
  candidate: candidateRouter,
  usage: usageRouter,
  proctoring: proctoringRouter,
});
