import { useEffect, useMemo, useState } from "react";
import type { Job, JobDegradedReason, JobMatchItem, MatchContext, ResumeStatus } from "../types";
import { getJobMatchTask, getMatchContext } from "../api/jobs";
import { useTask } from "../lib/useTask";
import { levelTone, scoreTone } from "../lib/theme";
import { DimensionBars } from "./report/DimensionBars";
import { Highlights } from "./report/Highlights";
import { Gaps } from "./report/Gaps";
import { InterviewPage } from "./InterviewPage";
import {
  AlertIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  InfoIcon,
  SpinnerIcon,
} from "./icons";

interface JobResultPageProps {
  taskId: string;
  resumeId: string;
  resumeName: string;
  resumeStatus: ResumeStatus;
  jobIndex: Record<string, Job>;
  onReset: () => void;
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
  ai_disabled: { short: "未开启 AI", detail: "当前未开启 AI 深度分析" },
  not_selected: { short: "未入选 AI", detail: "只对基础分排名靠前的岗位（默认前 8 个）做 AI 深度分析，这个岗位未入选" },
  input_too_short: { short: "简历过短", detail: "简历内容过短，无法做 AI 深度分析" },
  input_too_long: { short: "内容超长", detail: "简历与 JD 合计超过 2 万字，无法做 AI 深度分析" },
  model_failed: { short: "AI 失败", detail: "AI 深度分析失败" },
  item_timeout: { short: "AI 超时", detail: "这个岗位的 AI 深度分析超时" },
  batch_timeout: { short: "AI 超时", detail: "整批 AI 深度分析超时，这个岗位未完成" },
  mock_report: { short: "模拟报告", detail: "当前为模拟报告" },
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
function JobDetail({
  item,
  job,
  taskId,
  resumeId,
  resumeName,
  resumeStatus,
  onClose,
}: {
  item: JobMatchItem;
  job?: Job;
  taskId: string;
  resumeId: string;
  resumeName: string;
  resumeStatus: ResumeStatus;
  onClose: () => void;
}) {
  const [interviewOpen, setInterviewOpen] = useState(false);
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
    <div className="fixed inset-0 z-30 overflow-y-auto bg-surface-soft">
      <div className="mx-auto max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-ink-500 transition-colors hover:bg-white hover:text-ink-900"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            返回岗位列表
          </button>
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
              <p className="text-[11px] font-medium text-ink-500">能力缺口</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {item.missing.length > 0 ? (
                  item.missing.map((keyword) => <Chip key={keyword} text={keyword} tone="miss" />)
                ) : (
                  <span className="text-[11px] text-ink-300">—</span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setInterviewOpen(true)}
            disabled={!interviewRequest}
            className="group mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {interviewRequest ? "针对这个岗位练三轮" : contextError ? "暂不可开始面试" : "正在确认岗位上下文"}
            <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
          {contextError ? <p role="alert" className="mt-2 text-[12px] text-rose-700">{contextError}</p> : null}
        </section>

        {/* 基础评分构成：所有岗位都有，与 AI 诊断的四个维度不是一回事 */}
        {item.subscores.length > 0 ? (
          <div className="mt-5">
            <DimensionBars
              dimensions={item.subscores}
              title={`基础评分 ${item.stage1_score} 分`}
              hint="技能关键词 55% + 文本相似度 30% + 学历 15%"
              className=""
            />
            {item.report ? (
              <p className="num mt-2 text-[11px] text-ink-500">
                总分 {item.score} = 基础评分 {item.stage1_score} × 35% + AI 诊断 {item.report.overall_score} × 65%（四舍五入）
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
            <Gaps gaps={item.report.gaps} className="" />
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
              {item.degraded_reason ? `：${DEGRADED_REASON[item.degraded_reason].detail}` : ""}。总分即基础分，命中与缺口已列在上方。
            </span>
          </p>
        )}

        <p className="mt-6 flex items-start gap-2 text-[11px] leading-relaxed text-ink-500">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>诊断与建议由 AI 生成，仅供参考，不构成录用判断。</span>
        </p>
      </div>

      {interviewOpen && interviewRequest ? (
        <InterviewPage
          resumeId={interviewRequest.resume_id}
          resumeName={resumeName}
          resumeStatus={resumeStatus}
          jdText={interviewRequest.jd_text}
          layer={40}
          onExit={() => setInterviewOpen(false)}
        />
      ) : null}
    </div>
  );
}

export function JobResultPage({
  taskId,
  resumeId,
  resumeName,
  resumeStatus,
  jobIndex,
  onReset,
}: JobResultPageProps) {
  const { data: task, error, polling } = useTask(getJobMatchTask, taskId);
  // 只记岗位 ID，详情始终读最新一次轮询结果：AI 报告在打开详情之后才到达也能自动显示
  const [detailJobId, setDetailJobId] = useState<string | null>(null);

  const items = useMemo(() => {
    const list = task?.items ?? [];
    return [...list].sort((a, b) => b.score - a.score);
  }, [task]);
  const detailJob = detailJobId ? items.find((item) => item.job_id === detailJobId) ?? null : null;

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
        <div className="mt-4 flex items-start gap-3 rounded-xl2 border border-rose-200 bg-rose-50 px-5 py-6">
          <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-rose-700">岗位匹配失败</p>
            <p className="mt-1 text-[13px] leading-relaxed text-rose-700">{error}</p>
            <button
              type="button"
              onClick={onReset}
              className="mt-3 rounded-lg bg-rose-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-rose-700"
            >
              重新发起
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 pb-20 pt-8 sm:px-6">
      {/* 顶部 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] text-ink-500">简历</p>
          <p className="mt-1 truncate text-[15px] font-semibold text-ink-900" title={resumeName}>
            {resumeName}
          </p>
          <p className="num mt-1 text-[11px] text-ink-500">
            共 {items.length} 个岗位参与匹配，按匹配度排序
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-surface-line bg-white px-4 py-2 text-sm font-medium text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-700"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          换个岗位再匹配
        </button>
      </div>

      {polling ? (
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-2.5 text-[12px] text-brand-700">
          <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
          {task?.stage ?? "正在匹配"} · 已出 {items.length} 个岗位
        </p>
      ) : null}

      {/* 岗位卡片列表 */}
      <div className="mt-5 space-y-3">
        {items.map((item, index) => {
          const tone = levelTone(item.level);
          const scoreStyle = scoreTone(item.score);
          const job = jobIndex[item.job_id];

          return (
            <button
              key={item.job_id}
              type="button"
              onClick={() => setDetailJobId(item.job_id)}
              className="group block w-full rounded-xl2 border border-surface-line bg-white p-4 text-left shadow-card transition-all hover:border-brand-300 hover:shadow-md sm:p-5"
            >
              <div className="flex items-start gap-3">
                <span className="num mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-surface-soft text-[12px] font-semibold text-ink-500">
                  {index + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[15px] font-semibold text-ink-900">
                      {item.title}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone.chip}`}
                    >
                      {item.level_label}
                    </span>
                    {job ? (
                      <span className="text-[11px] text-ink-500">
                        {job.company} · {job.cities.join(" / ")}
                      </span>
                    ) : null}
                  </div>

                  {item.reason ? (
                    <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-ink-700">
                      {item.reason}
                    </p>
                  ) : null}

                  <div className="mt-2.5 flex flex-wrap items-center gap-1">
                    {item.matched.slice(0, 4).map((keyword) => (
                      <Chip key={keyword} text={keyword} tone="hit" />
                    ))}
                    {item.missing.slice(0, 3).map((keyword) => (
                      <Chip key={keyword} text={keyword} tone="miss" />
                    ))}
                  </div>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={`num text-[22px] font-semibold leading-none ${scoreStyle.text}`}
                  >
                    {item.score}
                  </span>
                  <span className="h-1 w-16 overflow-hidden rounded-full bg-slate-200/70">
                    <span
                      className={`bar-grow block h-full rounded-full ${scoreStyle.bar}`}
                      style={{ width: `${Math.max(0, Math.min(100, item.score))}%` }}
                    />
                  </span>
                  <span
                    className={`mt-0.5 inline-flex items-center gap-1 text-[10px] ${isAnalyzing(item) ? "text-brand-600" : "text-ink-500"}`}
                  >
                    {isAnalyzing(item) ? <SpinnerIcon className="h-2.5 w-2.5 animate-spin" /> : null}
                    {analysisLabel(item)}
                  </span>
                  <ChevronDownIcon className="mt-0.5 h-4 w-4 -rotate-90 text-ink-300 transition-transform group-hover:translate-x-0.5" />
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <p className="mt-6 flex items-start gap-2 text-[11px] leading-relaxed text-ink-500">
        <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          所有岗位先做基础评分（技能关键词 55%、文本相似度 30%、学历 15%）；排名靠前的岗位（默认前 8 个）再做 AI
          深度分析，完成后总分 = 基础分 × 35% + AI 诊断分 × 65%。标「基础评分」的岗位未做 AI 分析，总分即基础分。
          AI 判断仅供参考，请结合人工判断。
        </span>
      </p>

      {detailJob ? (
        <JobDetail
          item={detailJob}
          job={jobIndex[detailJob.job_id]}
          taskId={taskId}
          resumeId={resumeId}
          resumeName={resumeName}
          resumeStatus={resumeStatus}
          onClose={() => setDetailJobId(null)}
        />
      ) : null}
    </main>
  );
}
