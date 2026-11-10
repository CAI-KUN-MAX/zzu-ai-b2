import { useEffect, useMemo, useRef, useState } from "react";
import type {
  EmbeddingError,
  EmbeddingStatus,
  Job,
  JobDegradedReason,
  JobMatchItem,
  JobMatchTask,
  MatchContext,
  ResumeStatus,
} from "../types";
import { createJobMatch, createJobRecommendation, getJob, getJobMatchTask, getMatchContext } from "../api/jobs";
import { useTask } from "../lib/useTask";
import { levelTone } from "../lib/theme";
import { DimensionBars } from "./report/DimensionBars";
import { Highlights } from "./report/Highlights";
import { Gaps } from "./report/Gaps";
import { RewriteSuggestions } from "./report/RewriteSuggestions";
import { InterviewPage } from "./InterviewPage";
import { readInterviewTips, saveInterviewTips } from "../lib/interviewTips";
import {
  AlertIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  InfoIcon,
  SpinnerIcon,
} from "./icons";

interface JobResultPageProps {
  taskId: string;
  resumeId: string;
  resumeName: string;
  resumeStatus: ResumeStatus;
  jobIndex: Record<string, Job>;
  /** 本次参与匹配的岗位，用于失败后原样重新发起 */
  jobIds: string[];
  onReset: () => void;
  /** recommend=首页一键推荐，只展示前 8 条；manual=自己勾选的岗位 */
  mode?: "recommend" | "manual";
  /** 用同一份简历和同一批岗位重新创建任务后回调新的 taskId */
  onRestart: (taskId: string) => void;
  /** 由 App 持有：侧栏要高亮「模拟面试」，点「匹配结果」时也要能退出面试 */
  interviewOpen: boolean;
  onInterviewOpenChange: (open: boolean) => void;
}

function Chip({ text, tone }: { text: string; tone: "hit" | "miss" }) {
  const style =
    tone === "hit"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : "bg-slate-50 text-ink-500 ring-slate-200";
  return (
    <span className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${style}`}>
      {text}
    </span>
  );
}

/** 降级原因：卡片上的短标签和详情里的完整说明 */
const DEGRADED_REASON: Record<JobDegradedReason, { short: string; detail: string }> = {
  ai_disabled: { short: "未做深度分析", detail: "当前没有开启 AI 深入分析" },
  not_selected: { short: "未做深度分析", detail: "只会给排在前面的岗位（默认前 8 个）做 AI 深入分析，这个岗位没排进去" },
  input_too_short: { short: "简历太短", detail: "简历内容太少，不足以做 AI 分析" },
  input_too_long: { short: "内容太长", detail: "简历和岗位要求加起来超过 2 万字，超出了分析长度，可以精简后再试" },
  model_failed: { short: "AI 没成功", detail: "AI 分析这次没成功，可以重新匹配再试一次" },
  item_timeout: { short: "AI 等太久", detail: "这个岗位的 AI 分析等太久了，先按关键词给分" },
  batch_timeout: { short: "AI 等太久", detail: "整批分析等太久，这个岗位没跑完" },
  mock_report: { short: "示例数据", detail: "这是演示用的示例报告，不是真实结果" },
};

/** 是否还在等 AI：pending / running 时报告可能随后到达，不能当成“没做 AI” */
function isAnalyzing(item: JobMatchItem): boolean {
  return item.analysis_status === "pending" || item.analysis_status === "running";
}

/** 卡片右下角的分析状态 */
function analysisLabel(item: JobMatchItem): string {
  if (isAnalyzing(item)) return "AI 分析中";
  if (item.degraded_reason === "mock_report") return "模拟报告";
  if (item.report) return "AI 已分析";
  return item.degraded_reason ? `基础评分 · ${DEGRADED_REASON[item.degraded_reason].short}` : "基础评分";
}

/** 岗位详情覆盖层：诊断报告 + 模拟面试 */
/** 面试占满内容区（侧栏保留）：请求和岗位名放在结果页，详情卡只负责发起 */
interface InterviewTarget {
  request: MatchContext["interview_request"];
  title: string;
  jobId: string;
}

function JobDetail({
  item,
  job,
  taskId,
  resumeId,
  embeddingStatus,
  onStartInterview,
}: {
  item: JobMatchItem;
  job?: Job;
  taskId: string;
  resumeId: string;
  embeddingStatus?: EmbeddingStatus;
  onStartInterview: (interview: InterviewTarget) => void;
}) {
  const [interviewRequest, setInterviewRequest] = useState<MatchContext["interview_request"] | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const tone = levelTone(item.level);

  useEffect(() => {
    let cancelled = false;
    setInterviewRequest(null);
    setContextError(null);
    getMatchContext(taskId, item.job_id)
      .then((ctx) => {
        if (cancelled) return;
        if (ctx.interview_request.resume_id !== resumeId || !ctx.interview_request.jd_text) {
          setContextError("岗位上下文与当前简历不一致，请重新发起匹配。");
          return;
        }
        setInterviewRequest(ctx.interview_request);
      })
      .catch((error: unknown) => {
        if (!cancelled) setContextError(error instanceof Error ? error.message : "获取岗位上下文失败");
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, item.job_id, resumeId]);

  return (
    <div className="offer-result-detail">
      <div>
        <div className="flex items-center justify-between gap-3">
          <span className="offer-eyebrow">岗位详情</span>
          <span className="num rounded-full bg-white px-3 py-1 text-[11px] font-medium text-ink-700 shadow-sm">
            匹配度 {item.score}
          </span>
        </div>

        {/* 岗位头卡 */}
        <section className="mt-4 rounded-xl2 border border-surface-line bg-white p-5 shadow-card sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone.chip}`}>
              {item.level_label}
            </span>
            {job ? (
              <>
                <span className="text-xs text-ink-500">{job.company}</span>
                <span className="text-xs text-ink-300">·</span>
                <span className="text-xs text-ink-500">{job.cities.join(" / ")}</span>
                <span className="text-xs text-ink-300">·</span>
                <span className="text-xs text-ink-500">{job.education}</span>
              </>
            ) : null}
            {job?.application_status === "unverified" ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 ring-1 ring-inset ring-amber-200">
                待核验
              </span>
            ) : null}
          </div>

          <h1 className="mt-3 text-[20px] font-semibold tracking-tight sm:text-[24px]">
            {item.title}
          </h1>
          {item.reason ? (
            <p className="mt-2.5 text-[13px] leading-relaxed text-ink-700">{item.reason}</p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-4 rounded-xl bg-surface-soft/70 p-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-ink-500">命中关键词</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {item.matched.length > 0 ? (
                  item.matched.map((keyword) => <Chip key={keyword} text={keyword} tone="hit" />)
                ) : (
                  <span className="text-[11px] text-ink-300">—</span>
                )}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-ink-500">未命中关键词</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {item.missing.length > 0 ? (
                  item.missing.map((keyword) => <Chip key={keyword} text={keyword} tone="miss" />)
                ) : (
                  <span className="text-[11px] text-ink-300">—</span>
                )}
              </div>
            </div>
          </div>

          {item.report && item.report.gaps.length > 0 ? (
            <div className="mt-5">
              <Gaps gaps={item.report.gaps} className="mt-0" />
              <RewriteSuggestions gaps={item.report.gaps} className="mt-5" />
            </div>
          ) : null}

          {item.skill_assessments && item.skill_assessments.length > 0 ? (
            <section className="mt-4 rounded-xl bg-surface-soft/70 p-3.5" aria-label="技能证据">
              <h2 className="text-sm font-semibold text-ink-700">技能证据</h2>
              <p className="mt-1 text-xs text-ink-500">基于已提取文本的有限词汇识别，未找到不代表不会，请结合原文核对。</p>
              <ul className="mt-3 space-y-3">
                {item.skill_assessments.map((skill) => (
                  <li key={skill.skill_name} className="text-xs text-ink-700">
                    <p className="font-semibold">{skill.skill_name}：{skill.assessment}</p>
                    <p className="mt-1 whitespace-pre-wrap">岗位要求：{skill.jd_evidence}</p>
                    <p className="mt-1 whitespace-pre-wrap">简历原文：{skill.resume_evidence.length ? skill.resume_evidence.join("；") : "已提取文本中未找到"}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <button
            type="button"
            onClick={() => interviewRequest && onStartInterview({
              request: interviewRequest,
              jobId: item.job_id,
              title: job ? `${job.title} · ${job.company}` : item.title,
            })}
            disabled={!interviewRequest}
            className="group mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {interviewRequest ? "开始模拟面试" : contextError ? "暂不可开始面试" : "正在确认岗位上下文"}
            <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
          {contextError ? <p role="alert" className="mt-2 text-[12px] text-rose-700">{contextError}</p> : null}
        </section>

        {/* 岗位信息：岗位描述 + 来源/投递链接，数据全部来自 /api/jobs */}
        {job ? (
          <section className="mt-5 rounded-xl2 border border-surface-line bg-white p-5 shadow-card sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">岗位信息</h2>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                  job.application_status === "open"
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                    : job.application_status === "closed"
                      ? "bg-slate-100 text-ink-500 ring-slate-200"
                      : "bg-amber-50 text-amber-700 ring-amber-200"
                }`}
              >
                {job.application_status === "open"
                  ? "目录状态：开放"
                  : job.application_status === "closed"
                    ? "已关闭"
                    : "待核验"}
              </span>
            </div>

            <dl className="mt-3 grid gap-x-6 gap-y-2 text-[12px] sm:grid-cols-2">
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-ink-500">企业</dt>
                <dd className="min-w-0 text-ink-700">{job.company}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-ink-500">城市</dt>
                <dd className="min-w-0 text-ink-700">{job.cities.join(" / ")}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-ink-500">学历</dt>
                <dd className="min-w-0 text-ink-700">{job.education_requirement}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-ink-500">专业</dt>
                <dd className="min-w-0 text-ink-700">{job.majors.join("、")}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-ink-500">届别</dt>
                <dd className="min-w-0 text-ink-700">{job.graduation_year} 届</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-ink-500">发布</dt>
                <dd className="num min-w-0 text-ink-700">
                  {job.published_at}
                  <span className="ml-1.5 text-ink-500">
                    {job.publication_type === "original" ? "企业原始发布" : "转载"}
                  </span>
                </dd>
              </div>
            </dl>

            {job.application_status !== "open" ? (
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber-700">
                <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {job.application_status === "closed"
                    ? "该岗位已关闭，不能再投递，仅供参考。"
                    : "该岗位为待核验线索，投递入口未经核实，不能当作已确认可投。"}
                  {job.verification_note ? `（${job.verification_note}）` : ""}
                </span>
              </p>
            ) : null}

            <details open className="mt-4 rounded-xl border border-surface-line">
              <summary className="cursor-pointer select-none px-3.5 py-2.5 text-[12px] font-medium text-ink-700">
                目录中的岗位要求
              </summary>
              <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap border-t border-surface-line px-3.5 py-3 text-[12px] leading-relaxed text-ink-700 [overflow-wrap:anywhere]">
                {job.jd_text}
              </pre>
            </details>

            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={job.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-surface-line bg-white px-3.5 py-2 text-[12px] font-medium text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-700"
              >
                查看招聘来源
              </a>
              {job.application_url ? (
                <a
                  href={job.application_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-brand-700"
                >
                  前往投递
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  title="该岗位尚未核实投递入口"
                  className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl bg-ink-300 px-3.5 py-2 text-[12px] font-semibold text-white"
                >
                  前往投递（暂未核实）
                </button>
              )}
            </div>
          </section>
        ) : <p className="mt-5 text-sm text-ink-500">岗位目录详情暂不可用，请返回目录核对岗位来源。</p>}

        {/* 基础评分构成：所有岗位都有，与 AI 诊断的四个维度不是一回事 */}
        {item.intent_bonus ? <p className="text-xs text-ink-500">有限规则识别到求职意向与岗位方向线索：基础分加 {item.intent_bonus} 分，仅供参考。</p> : null}
        {item.subscores.length > 0 ? (
          <div className="mt-5">
            <DimensionBars
              dimensions={item.subscores}
              title={`匹配分 ${item.stage1_score}`}
              hint="技能关键词、文本相似度和学历计算规则分；若识别到求职意向，另计加分"
              className=""
            />
            {/* 只有真的比较过内容才展示相近程度，避免把关键词结果说成内容理解 */}
            {item.embedding_similarity != null ? (
              <p className="mt-2 text-[11px] text-ink-500">
                简历和岗位要求的内容相近程度：
                <span className="font-medium text-ink-700">
                  {similarityLabel(item.embedding_similarity)}
                </span>
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-ink-500">
                {embeddingStatus === "disabled"
                  ? "本次未启用语义向量；规则分包含关键词、字符相似度和学历"
                  : "语义向量不可用；规则分包含关键词、字符相似度和学历"}
              </p>
            )}
            {/* 只有真实 AI 成功（analysis_status=succeeded）时总分才按加权公式计算；模拟报告不参与加权 */}
            {item.report && item.analysis_status === "succeeded" ? (
              <p className="num mt-2 text-[11px] text-ink-500">
                综合分 {item.score} = 匹配分 {item.stage1_score} × 35% + AI 诊断 {item.report.overall_score} × 65%（四舍五入）
              </p>
            ) : null}
          </div>
        ) : null}

        {/* 诊断报告 */}
        {item.report ? (
          <div className="mt-5 space-y-6">
            <div className="rounded-xl2 border border-surface-line bg-white p-5 shadow-card">
              <p className="text-[13px] leading-relaxed text-ink-700">{item.report.summary}</p>
              <p className="num mt-2 text-[11px] text-ink-500">
                {item.degraded_reason === "mock_report" ? "模拟报告" : `由 ${item.report.meta.model} 生成`} · 耗时{" "}
                {(item.report.meta.elapsed_ms / 1000).toFixed(1)} 秒
              </p>
            </div>
            <DimensionBars
              dimensions={item.report.dimension_scores}
              title={`${item.degraded_reason === "mock_report" ? "模拟诊断" : "AI 诊断"} ${item.report.overall_score} 分`}
              hint="四个维度加权得出 AI 分"
              className=""
            />
            <Highlights highlights={item.report.highlights} className="" />
          </div>
        ) : isAnalyzing(item) ? (
          <p className="mt-5 flex items-start gap-2 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-[12px] leading-relaxed text-brand-700">
            <SpinnerIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
            <span>AI 正在分析这个岗位，完成后诊断报告会自动显示在这里；当前总分为基础分。</span>
          </p>
        ) : (
          <p className="mt-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-700">
            <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              这个岗位没有 AI 深度诊断
              {item.degraded_reason ? `：${DEGRADED_REASON[item.degraded_reason].detail}` : ""}。总分即基础分，关键词命中情况已列在上方。
            </span>
          </p>
        )}

        <p className="mt-6 flex items-start gap-2 text-[11px] leading-relaxed text-ink-500">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>诊断与建议由 AI 生成，仅供参考，不构成录用判断。</span>
        </p>
      </div>
    </div>
  );
}

/** 内容理解失败原因：只说用户能感知的现象，不暴露限流、鉴权、额度这类内部词 */
const EMBEDDING_ERROR_TEXT: Record<EmbeddingError, string> = {
  rate_limited: "服务有点忙",
  timeout: "响应太慢",
  unavailable: "服务暂时不可用",
  input_too_large: "内容太长",
  authentication_failed: "服务暂时不可用",
  insufficient_balance: "服务暂时不可用",
  invalid_vector: "结果异常",
};

/** 把 0~1 的相近程度翻成学生能理解的档位 */
function similarityLabel(value: number): string {
  if (value >= 0.7) return "很像";
  if (value >= 0.55) return "比较像";
  if (value >= 0.4) return "一般";
  if (value >= 0.25) return "不太像";
  return "很不像";
}

/**
 * 「内容理解」状态：是否比较过简历与岗位描述讲的内容是否接近。
 * 全程不使用语义、向量、Embedding、名次、规则分这类词。
 */
function EmbeddingNotice({ status, error }: { status?: EmbeddingStatus; error?: EmbeddingError | null }) {
  const current = status ?? "unknown";

  if (current === "succeeded") {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-[11px] leading-relaxed text-emerald-700">
        <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          已读懂岗位描述：除了看关键词对不对得上，还比较了简历和岗位要求讲的是不是同一类事。
        </span>
      </p>
    );
  }

  if (current === "pending") {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-[11px] leading-relaxed text-brand-700">
        <SpinnerIcon className="h-3.5 w-3.5 shrink-0 animate-spin" />
        正在读岗位描述，稍后结果会更准
      </p>
    );
  }

  if (current === "degraded") {
    const reason = error ? EMBEDDING_ERROR_TEXT[error] : "服务暂时不可用";
    return (
      <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
        <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          这次没能读懂岗位描述（{reason}），先按关键词排了个序。分数只反映关键词对不对得上，可能不够准。
        </span>
      </p>
    );
  }

  if (current === "disabled") {
    return (
      <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-ink-500">
        <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>当前只按关键词匹配，没有比较简历和岗位要求的内容是否接近。</span>
      </p>
    );
  }

  // unknown：旧任务没记录该字段，不额外打扰
  return null;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}

/**
 * 深度分析进度条：按任务阶段给出不同文案，避免页面长期停在笼统的「AI 分析中」。
 * 只展示后端给的事实（阶段、已完成数、开始时间），不推算剩余时间。
 */
function ProgressBanner({
  task,
  items,
  pollError,
  polling,
  restarting,
  onRestart,
  onRefetch,
}: {
  task: JobMatchTask | null;
  items: JobMatchItem[];
  pollError: string | null;
  polling: boolean;
  restarting: boolean;
  onRestart: () => void;
  onRefetch: () => void;
}) {
  const startedAt = task?.analysis_started_at ?? null;
  const [now, setNow] = useState(() => Date.now());

  // 有开始时间才走秒表，每秒刷新一次「已等待」
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  if (!task) return null;

  const degradedCount = items.filter(
    (item) => item.degraded && item.analysis_status !== "pending" && item.analysis_status !== "running"
  ).length;

  // 已完成数优先用后端字段，缺字段时按 items 里的终态回退统计
  const completed =
    task.analysis_completed ??
    items.filter((item) => item.analysis_status === "succeeded" || item.analysis_status === "degraded")
      .length;
  const total = task.analysis_total ?? 0;

  const elapsed = startedAt ? formatElapsed(now - new Date(startedAt).getTime()) : null;

  /* 整批失败：已完成的结果仍然保留 */
  if (task.status === "failed") {
    const timeout = task.error_code === "JOB_MATCH_TIMEOUT";
    return (
      <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
        <div className="flex items-start gap-2">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-rose-700">
              {timeout ? "整批匹配超时" : "岗位匹配失败"}
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-rose-700">
              {task.error ?? "任务执行失败，请重新发起。"}
              {timeout ? "（已完成的岗位结果仍保留在下方）" : ""}
            </p>
            <button
              type="button"
              onClick={onRestart}
              disabled={restarting}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-rose-700 disabled:opacity-60"
            >
              {restarting ? <SpinnerIcon className="h-3.5 w-3.5 animate-spin" /> : null}
              {restarting ? "正在重新发起…" : "用同一份简历重新匹配"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* 轮询暂时失败：任务可能仍在跑，不要求用户重传简历 */
  if (pollError) {
    return (
      <div className="mt-4 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-700 sm:flex-row sm:items-start">
        <span className="flex min-w-0 flex-1 items-start gap-2">
          <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {polling
              ? "网络波动，正在自动重试。已有结果会保留，不需要重新上传简历。"
              : "暂时没拿到最新进度，任务可能仍在后台进行。已有结果会保留。"}
            <span className="ml-1 text-amber-600">（{pollError}）</span>
          </span>
        </span>
        <button
          type="button"
          onClick={onRefetch}
          className="shrink-0 self-start rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-amber-700"
        >
          重新获取
        </button>
      </div>
    );
  }

  /* 完成：只在有降级时提示一句，全成功就不再占位 */
  if (task.status === "succeeded") {
    if (degradedCount === 0) return null;
    return (
      <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-700">
        <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {degradedCount} 个岗位只有基础评分（未做 AI 深度分析），其余已完成。点开岗位可看具体原因。
        </span>
      </div>
    );
  }

  /* 排队 / 基础评分 / 深度分析 */
  const analyzing = Boolean(startedAt);
  const title =!analyzing
    ? task.status === "queued"
      ? "任务排队中"
      : "正在做基础评分"
    : "AI 深度分析中";

  const detail = !analyzing
    ? task.status === "queued"
      ? "排队期间无需操作，轮到时自动开始。"
      : "先按技能关键词、文本相似度与学历算出基础分，再挑选岗位做深度分析。"
    : `已完成 ${completed}${total > 0 ? ` / ${total}` : ""} 个岗位${elapsed ? ` · 已等待 ${elapsed}` : ""}`;

  return (
    <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3">
      <div className="flex items-start gap-2.5">
        <SpinnerIcon className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-brand-600" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-brand-800">{title}</p>
          <p className="num mt-1 text-[12px] leading-relaxed text-brand-700">{detail}</p>
          {analyzing ? (
            <p className="mt-1.5 text-[11px] leading-relaxed text-brand-700/80">
              模型耗时会随岗位数量和响应情况变化，页面会自动更新，暂时无法给出准确的剩余时间。
            </p>
          ) : null}
          {/* 深度分析阶段用后端进度，阶段不明时退回任务进度 */}
          {analyzing && total > 0 ? (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/70">
              <div
                className="h-full rounded-full bg-brand-500 transition-[width] duration-500"
                style={{ width: `${Math.min(100, Math.round((completed / total) * 100))}%` }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function JobResultPage({
  taskId,
  resumeId,
  resumeName,
  resumeStatus,
  jobIndex,
  jobIds,
  onReset,
  onRestart,
  mode,
  interviewOpen,
  onInterviewOpenChange,
}: JobResultPageProps) {
  const { data: task, error, transient, polling, retry } = useTask(getJobMatchTask, taskId);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [loadedJobs, setLoadedJobs] = useState<Record<string, Job>>({});
  const restartInFlight = useRef(false);
  const [interview, setInterview] = useState<InterviewTarget | null>(null);
  const [interviewTips, setInterviewTips] = useState<Record<string, string[]>>(() => readInterviewTips(taskId, resumeId));
  useEffect(() => setInterviewTips(readInterviewTips(taskId, resumeId)), [taskId, resumeId]);
  const resultScrollY = useRef(0);
  const interviewing = interviewOpen && interview !== null;

  // 结果页只是隐藏，回来时停在进入面试前的位置
  const wasInterviewing = useRef(false);
  useEffect(() => {
    if (wasInterviewing.current && !interviewing) window.scrollTo({ top: resultScrollY.current, behavior: "instant" });
    wasInterviewing.current = interviewing;
  }, [interviewing]);

  function startInterview(target: InterviewTarget) {
    resultScrollY.current = window.scrollY;
    setInterview(target);
    onInterviewOpenChange(true);
  }

  const missingIds = (task?.items ?? []).map((item) => item.job_id).filter((id) => !jobIndex[id]).join(",");
  useEffect(() => {
    if (!missingIds) return;
    let cancelled = false;
    Promise.allSettled(missingIds.split(",").map((id) => getJob(id))).then((results) => {
      if (cancelled) return;
      setLoadedJobs((previous) => {
        const next = { ...previous };
        for (const result of results) if (result.status === "fulfilled") next[result.value.job_id] = result.value;
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [missingIds]);
  const displayedJobs = { ...loadedJobs, ...jobIndex };

  /** 整批失败或任务已不存在时，不回首页、不重传简历，直接用原参数再建一个任务 */
  async function handleRestart() {
    if (restartInFlight.current) return;
    const ids = jobIds.length > 0 ? jobIds : (task?.items ?? []).map((item) => item.job_id);
    if (ids.length === 0 && mode !== "recommend") {
      onReset();
      return;
    }
    restartInFlight.current = true;
    setRestarting(true);
    setRestartError(null);
    try {
      const { task_id } = mode === "recommend"
        ? await createJobRecommendation(resumeId)
        : await createJobMatch(resumeId, ids);
      onRestart(task_id);
    } catch (err) {
      setRestartError(err instanceof Error ? err.message : "重新发起失败，请稍后再试");
    } finally {
      restartInFlight.current = false;
      setRestarting(false);
    }
  }
  // 只记岗位 ID，详情始终读最新一次轮询结果：AI 报告在打开详情之后才到达也能自动显示
  const [detailJobId, setDetailJobId] = useState<string | null>(null);

  const allItems = useMemo(() => {
    const list = task?.items ?? [];
    return [...list].sort((a, b) => b.score - a.score);
  }, [task]);

  // 推荐模式：后端对全目录排序，前端只展示最靠前的 8 个
  const items = useMemo(
    () => (mode === "recommend" ? allItems.slice(0, 8) : allItems),
    [allItems, mode]
  );
  const detailJob = (detailJobId ? items.find((item) => item.job_id === detailJobId) : null) ?? items[0] ?? null;

  /* ---------- 加载中 ---------- */
  if (!task && polling) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center px-6">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600">
          <SpinnerIcon className="h-7 w-7 animate-spin" />
        </span>
        <h2 className="mt-5 text-base font-semibold">正在为你匹配岗位</h2>
        <p className="mt-2 text-[13px] text-ink-500">
          先按关键词与文本相似度做基础评分，再生成推荐理由，请稍候…
        </p>
        <div className="mt-6 h-1 w-full max-w-sm overflow-hidden rounded-full bg-slate-100">
          <div className="animate-indeterminate h-full w-1/3 rounded-full bg-brand-500" />
        </div>
        {error ? (
          <p className="mt-5 flex max-w-sm items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber-700">
            <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>网络波动，暂时获取不到进度，正在自动重试；匹配任务仍在后台进行，不需要重新上传。</span>
          </p>
        ) : null}
      </main>
    );
  }

  /* ---------- 失败态 ---------- */
  if (error && items.length === 0) {
    return (
      <main className="mx-auto max-w-4xl px-4 pb-20 pt-8 sm:px-6">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-ink-500 transition-colors hover:bg-white hover:text-ink-900"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          返回
        </button>
        {transient ? (
          /* 只是取不到进度（网络或等待太久），不能判定为匹配失败 */
          <div className="mt-4 flex items-start gap-3 rounded-xl2 border border-amber-200 bg-amber-50 px-5 py-6">
            <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800">暂时获取不到匹配进度</p>
              <p className="mt-1 text-[13px] leading-relaxed text-amber-700">
                {error} 匹配任务可能仍在后台进行，网络恢复后点“重新获取”即可继续查看，不需要重新上传简历。
              </p>
              <button
                type="button"
                onClick={retry}
                className="mt-3 rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-amber-700"
              >
                重新获取
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex items-start gap-3 rounded-xl2 border border-rose-200 bg-rose-50 px-5 py-6">
            <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-rose-700">岗位匹配失败</p>
              <p className="mt-1 text-[13px] leading-relaxed text-rose-700">{error}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleRestart}
                  disabled={restarting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-rose-700 disabled:opacity-60"
                >
                  {restarting ? <SpinnerIcon className="h-3.5 w-3.5 animate-spin" /> : null}
                  {restarting ? "正在重新发起…" : "用同一份简历重新匹配"}
                </button>
                <button
                  type="button"
                  onClick={onReset}
                  className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-[12px] font-medium text-rose-700 hover:bg-rose-100"
                >
                  返回修改岗位
                </button>
              </div>
              {restartError ? <p className="mt-2 text-[12px] text-rose-700">{restartError}</p> : null}
            </div>
          </div>
        )}
      </main>
    );
  }

  return (
    <>
    {interviewing ? (
      <InterviewPage
        resumeId={interview.request.resume_id}
        resumeName={resumeName}
        resumeStatus={resumeStatus}
        jdText={interview.request.jd_text}
        jobTitle={interview.title}
        onExit={(tips) => {
          if (tips && interview) setInterviewTips((previous) => {
            const next = { ...previous, [interview.jobId]: tips };
            saveInterviewTips(taskId, resumeId, next);
            return next;
          });
          onInterviewOpenChange(false);
        }}
      />
    ) : null}
    <main className="offer-results" hidden={interviewing}>
      <div className="picker-title">
        <div>
          <span className="offer-eyebrow">YOUR MATCH REPORT</span>
          <h1>{mode === "recommend" ? "为你推荐" : "匹配结果"}</h1>
          <p>
            {resumeName} ·{" "}
            {mode === "recommend"
              ? `为你推荐 ${items.length} 个岗位；匹配结果可能遗漏相关岗位，请以招聘来源核对状态`
              : `${items.length} 个岗位按匹配分排序`}
          </p>
        </div>
        <button type="button" className="picker-last" onClick={onReset}>← 重新选择岗位</button>
      </div>
      {detailJob && interviewTips[detailJob.job_id]?.length ? <section className="picker-panel" aria-label="面试后的简历核对提示">
        <h2>面试后的简历核对提示</h2><p>你已确认以下提示适用于该岗位且符合真实经历；请自行决定如何修改简历。保存在当前浏览器标签页，关闭标签页后清除。</p>
        <ul>{interviewTips[detailJob.job_id].map((tip, index) => <li key={index}>{tip}</li>)}</ul>
      </section> : null}
      <EmbeddingNotice status={task?.embedding_status} error={task?.embedding_error} />
      <ProgressBanner task={task} items={items} pollError={task?.status === "failed" ? null : error} polling={polling} restarting={restarting} onRestart={handleRestart} onRefetch={retry} />
      {restartError && <p className="picker-error" role="alert">{restartError}</p>}
      {items.length === 0 ? (
        <section className="picker-panel result-empty">
          <h2>{task?.status === "succeeded" ? "这次没有可推荐的岗位" : "正在准备结果"}</h2>
          <p>
            {task?.status === "succeeded"
              ? "当前目录里没有匹配得上的岗位，可以自己挑选试试。"
              : "结果产生后会显示在这里，不用刷新。"}
          </p>
          <button type="button" onClick={onReset}>手动选择岗位</button>
        </section>
      ) : (
        <div className="offer-results-layout">
          <section className="picker-panel result-ranks" aria-label="匹配排序"><div className="picker-panel-head"><h2>匹配排序</h2><span>{items.length} 个岗位</span></div>
            <div className="result-rank-list">{items.map((item, index) => { const job = displayedJobs[item.job_id]; return <button key={item.job_id} type="button" aria-pressed={detailJob?.job_id === item.job_id} className={`result-rank ${detailJob?.job_id === item.job_id ? "active" : ""}`} onClick={() => setDetailJobId(item.job_id)}>
              <span className="result-order">{index + 1}</span><span className="picker-logo small">{job?.company.slice(0,1) || "岗"}</span><span className="result-rank-text"><strong>{item.title}</strong><small>{job?.company || "岗位"}{job?.cities?.length ? " · " + job.cities[0] : ""} · {analysisLabel(item)}{item.report?.gaps?.length ? ` · 待补 ${item.report.gaps.length} 项` : ""}</small></span><span className="result-score">{item.score}</span>
            </button>; })}</div>
            <p className="picker-hint">结果根据简历与岗位内容计算，分析建议仅供参考。</p>
          </section>
          {detailJob && <JobDetail key={detailJob.job_id} item={detailJob} job={displayedJobs[detailJob.job_id]} taskId={taskId} resumeId={resumeId} embeddingStatus={task?.embedding_status} onStartInterview={startInterview} />}
        </div>
      )}
    </main>
    </>
  );
}
