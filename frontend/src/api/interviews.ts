import type {
  InterviewAnswerResult,
  InterviewQuestion,
  InterviewSession,
} from "../types";
import interviewMock from "../mock/interview.json";
import { ApiError, IS_MOCK_MODE, request, wait } from "./http";

/** 面试单轮要走完整的大模型生成，给足 90 秒 */
export const INTERVIEW_TIMEOUT_MS = Number(import.meta.env.VITE_API_INTERVIEW_TIMEOUT ?? 90000);

/** 回答长度限制，与任务单一致 */
export const ANSWER_MIN = 20;
export const ANSWER_MAX = 3000;

interface MockData {
  max_rounds: number;
  questions: InterviewQuestion[];
  feedback: InterviewAnswerResult["feedback"][];
}

const MOCK = interviewMock as MockData;

/** mock 下每个会话的当前进度 */
const mockRound = new Map<string, number>();
/** mock 下已返回过的结果，保证同一题重试返回同一份反馈 */
const mockAnswered = new Map<string, Map<string, InterviewAnswerResult>>();

function mockQuestion(index: number): InterviewQuestion | null {
  return MOCK.questions[index] ?? null;
}

/** POST /api/interviews —— 建会话，返回第一题 */
export async function createInterview(
  resumeId: string,
  jdText: string
): Promise<InterviewSession> {
  if (IS_MOCK_MODE) {
    await wait(1200);
    const id = `mock-iv-${Date.now()}`;
    mockRound.set(id, 0);
    mockAnswered.set(id, new Map());
    return {
      interview_id: id,
      status: "active",
      round: 1,
      max_rounds: MOCK.max_rounds,
      question: mockQuestion(0),
    };
  }

  return request<InterviewSession>("/api/interviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resume_id: resumeId, jd_text: jdText }),
    timeout: INTERVIEW_TIMEOUT_MS,
    timeoutMessage: "面试题生成超时，请稍后重试",
  });
}

/** POST /api/interviews/{id}/answers —— 提交本轮回答，返回反馈与下一题 */
export async function submitAnswer(
  interviewId: string,
  questionId: string,
  answerText: string
): Promise<InterviewAnswerResult> {
  if (IS_MOCK_MODE) {
    await wait(1500);

    const round = mockRound.get(interviewId);
    if (round === undefined) {
      throw new ApiError("会话已失效，请重新开始");
    }

    // 同一题重试：直接返回上次结果，不重复推进轮次
    const cache = mockAnswered.get(interviewId);
    const cached = cache?.get(questionId);
    if (cached) return cached;

    const index = MOCK.questions.findIndex((q) => q.id === questionId);
    if (index === -1 || index !== round) {
      throw new ApiError("会话已失效，请重新开始");
    }

    const nextIndex = index + 1;
    const nextQuestion = mockQuestion(nextIndex);
    const result: InterviewAnswerResult = {
      interview_id: interviewId,
      status: nextQuestion ? "active" : "completed",
      round: index + 1,
      max_rounds: MOCK.max_rounds,
      feedback: MOCK.feedback[index] ?? {
        strengths: [],
        improvements: [],
        reference_points: [],
      },
      next_question: nextQuestion,
    };

    cache?.set(questionId, result);
    mockRound.set(interviewId, nextIndex);

    return result;
  }

  return request<InterviewAnswerResult>(
    `/api/interviews/${encodeURIComponent(interviewId)}/answers`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_id: questionId, answer_text: answerText }),
      timeout: INTERVIEW_TIMEOUT_MS,
      timeoutMessage: "本轮反馈生成超时，请稍后重试",
    }
  );
}

/** 回答字数（去掉首尾空白后按字符计） */
export function answerLength(text: string): number {
  return text.trim().length;
}

/** 会话是否已失效（后端明确告知会话不存在时用于引导重开） */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 410);
}
