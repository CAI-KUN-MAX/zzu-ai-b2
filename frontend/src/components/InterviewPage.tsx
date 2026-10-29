import { useEffect, useMemo, useRef, useState } from "react";
import type {
  InterviewFeedback,
  InterviewQuestion,
  ResumeStatus,
} from "../types";
import {
  ANSWER_MAX,
  ANSWER_MIN,
  answerLength,
  createInterview,
  isSessionExpired,
  submitAnswer,
} from "../api/interviews";
import { ApiError } from "../api/http";
import { useSpeechRecognition } from "../lib/useSpeechRecognition";
import { AlertIcon, ArrowLeftIcon, CheckIcon, InfoIcon, MicIcon, SpinnerIcon, StopIcon } from "./icons";

interface InterviewPageProps {
  resumeId: string;
  resumeName: string;
  resumeStatus: ResumeStatus;
  jdText: string;
  /** 岗位名称（如“后端开发 · 某公司”），有则在确认页展示，否则退回 JD 首行 */
  jobTitle?: string;
  /** 返回筛选结果页；原页面不卸载，展开状态与报告都还在 */
  onExit: () => void;
  /** 覆盖层层级：默认 30；嵌在岗位详情里时传 40，避免被详情盖住 */
  layer?: number;
}

interface RoundRecord {
  round: number;
  question: InterviewQuestion;
  answer: string;
  feedback: InterviewFeedback;
}

type Phase = "confirm" | "active" | "completed";

function FeedbackBlock({ feedback }: { feedback: InterviewFeedback }) {
  const groups = [
    {
      title: "做得好",
      items: feedback.strengths,
      titleClass: "text-emerald-700",
      dotClass: "bg-emerald-500",
    },
    {
      title: "可以补充",
      items: feedback.improvements,
      titleClass: "text-amber-700",
      dotClass: "bg-amber-500",
    },
    {
      title: "参考要点",
      items: feedback.reference_points,
      titleClass: "text-brand-700",
      dotClass: "bg-brand-500",
    },
  ];

  return (
    <div className="space-y-3.5">
      {groups.map((group) =>
        group.items.length === 0 ? null : (
          <div key={group.title}>
            <p className={`text-[11px] font-medium ${group.titleClass}`}>{group.title}</p>
            <ul className="mt-1.5 space-y-1.5">
              {group.items.map((item, index) => (
                <li
                  key={`${group.title}-${index}`}
                  className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-700"
                >
                  <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${group.dotClass}`} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      )}
    </div>
  );
}

/** 创建会话前先按当前契约展示，拿到响应后一律以接口的 max_rounds 为准 */
const DEFAULT_MAX_ROUNDS = 5;

export function InterviewPage({
  resumeId,
  resumeName,
  resumeStatus,
  jdText,
  jobTitle,
  onExit,
  layer = 30,
}: InterviewPageProps) {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<InterviewQuestion | null>(null);
  const [currentRound, setCurrentRound] = useState(1);
  const [maxRounds, setMaxRounds] = useState(DEFAULT_MAX_ROUNDS);

  const answerRef = useRef<HTMLTextAreaElement>(null);

  /** 「改用文字输入」：清掉语音错误态并把焦点交给输入框 */
  function handleUseTextInput() {
    speech.reset();
    answerRef.current?.focus();
  }

  // 语音识别只负责把最终文本追加进输入框，提交仍需用户手动点击
  const speech = useSpeechRecognition({
    onFinal: (text) =>
      setAnswer((prev) => {
        const merged = prev.trim() ? `${prev.trimEnd()} ${text}` : text;
        return merged.slice(0, ANSWER_MAX + 200);
      }),
  });
  const [rounds, setRounds] = useState<RoundRecord[]>([]);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  // 服务端已记下这题的回答（响应丢失后用户又改了答案）或面试已结束：给出重新开始的出口，
  // 但不禁用提交——把答案改回原文仍能拿到原来的反馈
  const [conflict, setConflict] = useState(false);

  // 覆盖层铺满视口时锁住底层页面滚动，避免出现双滚动条
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // 换题或进入完成页时回到顶部，否则用户会停在上一题的半截位置
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [phase, currentRound]);

  // setState 是异步的，快速双击时两次点击可能都读到旧的 busy，
  // 用 ref 做同步闸门，保证同一时刻只发一次请求
  const inFlight = useRef(false);

  // 换题或进入完成页时停止识别，避免继续往已清空的输入框里追加文字
  useEffect(() => {
    speech.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRound, phase]);

  const words = answerLength(answer);
  const overLimit = words > ANSWER_MAX;
  const canSubmit = useMemo(
    () => words >= ANSWER_MIN && !overLimit && !busy && !!currentQuestion && !expired,
    [words, overLimit, busy, currentQuestion, expired]
  );

  const jdSummary = useMemo(() => {
    if (jobTitle) return jobTitle;
    const firstLine = jdText.split("\n").find((line) => line.trim().length > 0) ?? jdText;
    return firstLine.length > 48 ? `${firstLine.slice(0, 48)}…` : firstLine;
  }, [jdText, jobTitle]);

  async function handleStart() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const session = await createInterview(resumeId, jdText);
      setSessionId(session.interview_id);
      setCurrentQuestion(session.question);
      setCurrentRound(session.round);
      setMaxRounds(session.max_rounds);
      setRounds([]);
      setAnswer("");
      setPhase("active");
    } catch (err) {
      // 接口还没上线时是通用 404（没有业务错误码）；“简历不存在”等业务 404 保留后端原文
      if (err instanceof ApiError && err.status === 404 && (!err.code || err.code === "HTTP_ERROR")) {
        setError("面试服务暂未就绪，请稍后再试");
      } else {
        setError(err instanceof ApiError ? err.message : "创建面试失败，请稍后重试");
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function handleSubmit() {
    if (!sessionId || !currentQuestion) return;
    if (inFlight.current) return;
    // 提交后本轮结束，先关掉麦克风
    speech.stop();
    inFlight.current = true;

    const text = answer.trim();
    setBusy(true);
    setError(null);
    setConflict(false);

    try {
      const result = await submitAnswer(sessionId, currentQuestion.id, text);
      setRounds((prev) => [
        ...prev,
        {
          round: result.round,
          question: currentQuestion,
          answer: text,
          feedback: result.feedback,
        },
      ]);
      setAnswer("");

      if (result.next_question) {
        setCurrentQuestion(result.next_question);
        setCurrentRound(result.round + 1);
      } else {
        setCurrentQuestion(null);
        setPhase("completed");
      }
    } catch (err) {
      // 失败时保留输入，用户可以直接重试
      if (isSessionExpired(err)) setExpired(true);
      setConflict(err instanceof ApiError && err.status === 409 && /已回答|已完成/.test(err.message));
      setError(err instanceof ApiError ? err.message : "提交失败，请稍后重试");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function handleRestart() {
    setPhase("confirm");
    setSessionId(null);
    setCurrentQuestion(null);
    setRounds([]);
    setAnswer("");
    setError(null);
    setExpired(false);
    setConflict(false);
    setCurrentRound(1);
  }

  return (
    <div
      ref={scrollRef}
      className={`fixed inset-0 overflow-y-auto bg-surface-soft ${layer >= 40 ? "z-40" : "z-30"}`}
    >
      {/* overflow-wrap 可继承：问题、回答、反馈里的长链接或长英文串在任意位置换行，手机上不撑破卡片 */}
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-6 [overflow-wrap:anywhere] sm:px-6 sm:pt-10">
        {/* 顶部条 */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onExit}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-ink-500 transition-colors hover:bg-white hover:text-ink-900"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            返回结果
          </button>

          {phase !== "confirm" ? (
            <span className="num rounded-full bg-white px-3 py-1 text-[11px] font-medium text-ink-700 shadow-sm">
              {phase === "completed" ? "已完成" : `第 ${currentRound} / ${maxRounds} 轮`}
            </span>
          ) : null}
        </div>

        {/* 确认页 */}
        {phase === "confirm" ? (
          <div className="mt-4 rounded-xl2 border border-surface-line bg-white p-6 shadow-card sm:p-8">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-700 ring-1 ring-inset ring-brand-100">
              模拟面试
            </span>
            <h1 className="mt-4 text-[22px] font-semibold tracking-tight sm:text-[26px]">
              针对这份简历，练 {maxRounds} 轮
            </h1>

            <dl className="mt-5 space-y-3 rounded-xl bg-surface-soft/70 p-4">
              <div className="flex gap-3">
                <dt className="w-16 shrink-0 text-[12px] text-ink-500">简历</dt>
                <dd className="min-w-0 flex-1 break-all text-[13px] font-medium text-ink-900">
                  {resumeName}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-16 shrink-0 text-[12px] text-ink-500">岗位</dt>
                <dd className="min-w-0 flex-1 text-[13px] text-ink-700" title={jdText}>
                  {jdSummary}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-16 shrink-0 text-[12px] text-ink-500">轮次</dt>
                <dd className="text-[13px] text-ink-700">共 {maxRounds} 轮，每轮一个问题，回答后立即给反馈</dd>
              </div>
            </dl>

            {resumeStatus === "need_review" ? (
              <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-700">
                <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>这份简历的文字识别质量偏低，题目可能和原件有出入，建议先核对识别结果。</span>
              </p>
            ) : null}

            {error ? (
              <p className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] leading-relaxed text-rose-700">
                <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </p>
            ) : null}

            <p className="mt-5 flex items-start gap-2 text-[11px] leading-relaxed text-ink-500">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                练习只针对这一份简历和当前岗位，题目与反馈由 AI 生成，用于发现回答中的缺口，
                不代表任何录用判断。
              </span>
            </p>

            <button
              type="button"
              onClick={handleStart}
              disabled={busy}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-ink-300 sm:w-auto"
            >
              {busy ? (
                <>
                  <SpinnerIcon className="h-4 w-4 animate-spin" />
                  正在出题…
                </>
              ) : (
                "开始第 1 轮"
              )}
            </button>
          </div>
        ) : null}

        {/* 答题页 */}
        {phase === "active" && currentQuestion ? (
          <div className="mt-4 space-y-4">
            {/* 历史轮次 */}
            {rounds.map((record) => (
              <div
                key={record.round}
                className="rounded-xl2 border border-surface-line bg-white p-5 shadow-card"
              >
                <div className="flex items-center gap-2">
                  <span className="num grid h-5 w-5 place-items-center rounded-full bg-ink-900 text-[10px] font-semibold text-white">
                    {record.round}
                  </span>
                  <span className="text-[11px] text-ink-500">已完成</span>
                  <CheckIcon className="h-3.5 w-3.5 text-emerald-500" />
                </div>
                <p className="mt-3 text-[13px] font-medium leading-relaxed text-ink-900">
                  {record.question.text}
                </p>
                <p className="mt-2 whitespace-pre-wrap rounded-xl bg-surface-soft/80 px-3 py-2.5 text-[12px] leading-relaxed text-ink-700">
                  {record.answer}
                </p>
                <div className="mt-4 border-t border-surface-line pt-4">
                  <FeedbackBlock feedback={record.feedback} />
                </div>
              </div>
            ))}

            {/* 当前问题 */}
            <div className="rounded-xl2 border border-brand-200 bg-white p-5 shadow-card sm:p-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="num rounded-md bg-brand-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                  Q{currentRound}
                </span>
                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                  {currentQuestion.focus}
                </span>
              </div>
              <p className="mt-3 text-[15px] font-medium leading-relaxed text-ink-900">
                {currentQuestion.text}
              </p>

              <div className="mt-4">
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor="interview-answer"
                    className="text-[11px] font-medium text-ink-500"
                  >
                    你的回答
                  </label>
                  <button
                    type="button"
                    onClick={speech.toggle}
                    disabled={busy || !speech.supported}
                    aria-pressed={speech.listening}
                    title={
                      speech.supported
                        ? speech.listening
                          ? "停止语音识别"
                          : "开始语音识别（简体中文）"
                        : "当前浏览器不支持语音识别"
                    }
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      speech.listening
                        ? "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 hover:bg-rose-100"
                        : "bg-surface-soft text-ink-700 ring-1 ring-inset ring-surface-line hover:bg-slate-100"
                    }`}
                  >
                    {speech.listening ? (
                      <StopIcon className="h-3.5 w-3.5" />
                    ) : (
                      <MicIcon className="h-3.5 w-3.5" />
                    )}
                    {speech.listening ? "停止识别" : "语音输入"}
                  </button>
                </div>

                <textarea
                  id="interview-answer"
                  ref={answerRef}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  readOnly={busy}
                  spellCheck={false}
                  placeholder="把思路讲清楚：先做什么、怎么判断、结果如何。20 字以上即可。"
                  className={`mt-1.5 min-h-36 w-full resize-y rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed text-ink-900 placeholder:text-ink-300 focus:outline-none ${
                    overLimit
                      ? "border-rose-300 focus:border-rose-400"
                      : "border-surface-line focus:border-brand-300"
                  } ${busy ? "bg-surface-soft/60" : "bg-white"}`}
                />

                {/* 语音状态：每种状态都给明确说明，失败时提供重试与改用文字输入 */}
                {!speech.supported ? (
                  <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-500">
                    <InfoIcon className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      当前浏览器不支持浏览器语音识别，请直接打字作答（不影响提交）。
                    </span>
                  </p>
                ) : speech.failed ? (
                  <div
                    role="alert"
                    className="mt-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2"
                  >
                    <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-rose-700">
                      <AlertIcon className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>{speech.lastError}</span>
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={speech.start}
                        disabled={busy}
                        className="rounded-md bg-rose-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
                      >
                        重试语音识别
                      </button>
                      <button
                        type="button"
                        onClick={handleUseTextInput}
                        className="rounded-md bg-white px-2.5 py-1 text-[11px] font-medium text-ink-700 ring-1 ring-inset ring-surface-line transition-colors hover:bg-slate-50"
                      >
                        改用文字输入
                      </button>
                    </div>
                  </div>
                ) : speech.status === "starting" ? (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">
                    正在请求麦克风权限，请在浏览器弹窗中选择「允许」；如果一直没反应，可以改用文字输入。
                  </p>
                ) : speech.status === "listening" ? (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-brand-700">
                    正在识别{speech.interim ? `：「${speech.interim}」` : "…"}
                    <span className="text-ink-500">识别结果会追加到上方输入框，请检查后手动提交。</span>
                  </p>
                ) : speech.status === "stopped" ? (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">
                    已停止识别。可以继续编辑文字，或再次点击「语音输入」。
                  </p>
                ) : (
                  <p className="mt-1.5 text-[10px] leading-relaxed text-ink-500">
                    语音识别由浏览器自带的识别服务完成（Chrome 会把语音发送到其在线服务转写），网络不通或浏览器不支持时无法使用；本站不保存录音，识别文字需你确认后手动提交。
                  </p>
                )}

                <div className="mt-1.5 flex items-center justify-between gap-3">
                  <span
                    className={`text-[11px] ${
                      overLimit ? "text-rose-600" : words > 0 && words < ANSWER_MIN ? "text-amber-600" : "text-ink-500"
                    }`}
                  >
                    {overLimit
                      ? `超出上限，请删减 ${(words - ANSWER_MAX).toLocaleString("zh-CN")} 字`
                      : words < ANSWER_MIN
                        ? `至少 ${ANSWER_MIN} 字，当前 ${words} 字`
                        : "回答提交后即可看到本轮反馈"}
                  </span>
                  <span className="num text-[11px] text-ink-500">
                    {words.toLocaleString("zh-CN")} / {ANSWER_MAX.toLocaleString("zh-CN")}
                  </span>
                </div>
              </div>

              {error ? (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-rose-700">
                  <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1">{error}</span>
                  {expired || conflict ? (
                    <button
                      type="button"
                      onClick={handleRestart}
                      className="shrink-0 rounded-md bg-rose-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-rose-700"
                    >
                      重新开始
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-ink-300 disabled:shadow-none"
                >
                  {busy ? (
                    <>
                      <SpinnerIcon className="h-4 w-4 animate-spin" />
                      正在生成反馈…
                    </>
                  ) : (
                    "提交回答"
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* 完成页 */}
        {phase === "completed" ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl2 border border-surface-line bg-white p-6 shadow-card sm:p-8">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                  <CheckIcon className="h-5 w-5" />
                </span>
                <div>
                  <h1 className="text-[18px] font-semibold tracking-tight">本次练习完成</h1>
                  <p className="mt-0.5 text-[12px] text-ink-500">
                    共 {rounds.length} 轮 · 简历「{resumeName}」
                  </p>
                </div>
              </div>

              <p className="mt-4 rounded-xl bg-surface-soft/80 px-4 py-3 text-[12px] leading-relaxed text-ink-700">
                全部 {rounds.length} 轮反馈都在下面。建议先把「可以补充」里的点挑两条写进回答，再重新练一遍同样的题。
              </p>

              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={handleRestart}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
                >
                  再练一遍
                </button>
                <button
                  type="button"
                  onClick={onExit}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-surface-line bg-white px-5 py-2.5 text-sm font-medium text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-700"
                >
                  返回结果页
                </button>
              </div>
            </div>

            {rounds.map((record) => (
              <div
                key={record.round}
                className="rounded-xl2 border border-surface-line bg-white p-5 shadow-card"
              >
                <div className="flex items-center gap-2">
                  <span className="num grid h-5 w-5 place-items-center rounded-full bg-ink-900 text-[10px] font-semibold text-white">
                    {record.round}
                  </span>
                  <span className="rounded-full bg-surface-soft px-2 py-0.5 text-[11px] text-ink-500">
                    {record.question.focus}
                  </span>
                </div>
                <p className="mt-3 text-[13px] font-medium leading-relaxed text-ink-900">
                  {record.question.text}
                </p>
                <p className="mt-2 whitespace-pre-wrap rounded-xl bg-surface-soft/80 px-3 py-2.5 text-[12px] leading-relaxed text-ink-700">
                  {record.answer}
                </p>
                <div className="mt-4 border-t border-surface-line pt-4">
                  <FeedbackBlock feedback={record.feedback} />
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
