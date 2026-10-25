import { useMemo, useState } from "react";
import type { IngestTask, MatchItem, ResumeStatus } from "../types";
import { exportUrl, getMatchTask } from "../api/match";
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
  DownloadIcon,
  InfoIcon,
  SpinnerIcon,
} from "./icons";

interface ScreenResultPageProps {
  taskId: string;
  jdText: string;
  ingest: IngestTask;
  onReset: () => void;
}

function KeywordChip({ text, tone }: { text: string; tone: "hit" | "miss" }) {
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

/** 基础评分的三个分项（与 AI 诊断的四个维度不是一回事，分开展示） */
function BaseScore({ item }: { item: MatchItem }) {
  if (item.subscores.length === 0) return null;
  return (
    <DimensionBars
      dimensions={item.subscores}
      title={`基础评分 ${item.stage1_score ?? item.score} 分`}
      hint="技能关键词 55% + 文本相似度 30% + 学历 15%"
      className=""
    />
  );
}

/** 展开行才渲染 report，避免一次性渲染 20 份明细导致卡顿 */
function ExpandedReport({ item }: { item: MatchItem }) {
  if (item.degraded || !item.report) {
    return (
      <div className="space-y-6">
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-700">
          <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            该简历未生成 AI 深度分析，总分即基础评分。可能原因：不在基础分前 8 名、AI
            分析失败或超时、简历文字过少或与 JD 合计超过 2 万字。
          </span>
        </p>
        <BaseScore item={item} />
      </div>
    );
  }

  const report = item.report;
  return (
    <div className="space-y-6">
      <p className="rounded-xl bg-white px-4 py-3 text-[13px] leading-relaxed text-ink-700 shadow-sm">
        {report.summary}
      </p>
      <p className="num text-[12px] text-ink-500">
        总分 {item.score} = 基础评分 {item.stage1_score ?? "—"} × 35% + AI 诊断 {report.overall_score} × 65%（四舍五入）
      </p>
      <DimensionBars
        dimensions={report.dimension_scores}
        title={`AI 诊断 ${report.overall_score} 分`}
        hint="四个维度加权得出 AI 分"
        className=""
      />
      <BaseScore item={item} />
      <Highlights highlights={report.highlights} className="" />
      <Gaps gaps={report.gaps} className="" />
    </div>
  );
}

/** 展开详情底部的面试入口：只针对这一份简历，不向整批发起 */
function InterviewEntry({
  item,
  resumeStatus,
  onStart,
}: {
  item: MatchItem;
  resumeStatus: ResumeStatus;
  onStart: () => void;
}) {
  // 准入依据是简历全文可用：解析失败的简历没有文本，无法出题
  const available = item.subscores.length > 0 || !item.degraded || item.score > 0;

  return (
    <div className="mt-6 flex flex-col gap-3 border-t border-surface-line pt-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-ink-700">模拟面试</p>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
          {available
            ? `针对「${item.name}」和当前岗位练三轮，答题后立即给反馈`
            : "这份简历没有可用的文本，无法进入面试"}
          {available && resumeStatus === "need_review" ? "（识别质量偏低，建议先核对原文）" : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={onStart}
        disabled={!available}
        className="group inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-ink-300 disabled:shadow-none"
      >
        开始模拟面试
        <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </button>
    </div>
  );
}

export function ScreenResultPage({ taskId, jdText, ingest, onReset }: ScreenResultPageProps) {
  const { data: task, error, polling } = useTask(getMatchTask, taskId);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // 面试作为覆盖层打开，本页不卸载，展开状态与已生成的报告都保留
  const [interviewItem, setInterviewItem] = useState<MatchItem | null>(null);

  const failedCount = ingest.items.filter((item) => item.status === "failed").length;

  const items = useMemo(() => {
    const list = task?.items ?? [];
    return [...list].sort((a, b) => b.score - a.score);
  }, [task]);

  const jdSummary = useMemo(() => {
    const firstLine = jdText.split("\n").find((line) => line.trim().length > 0) ?? jdText;
    return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
  }, [jdText]);

  const downloadUrl = exportUrl(taskId);

  /* ---------- 加载中 ---------- */
  if (!task && polling) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center px-6">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600">
          <SpinnerIcon className="h-7 w-7 animate-spin" />
        </span>
        <h2 className="mt-5 text-base font-semibold">正在逐份匹配</h2>
        <p className="mt-2 text-[13px] text-ink-500">先给每份简历打分，再生成匹配理由，请稍候…</p>
        <div className="mt-6 h-1 w-full max-w-sm overflow-hidden rounded-full bg-slate-100">
          <div className="animate-indeterminate h-full w-1/3 rounded-full bg-brand-500" />
        </div>
      </main>
    );
  }

  /* ---------- 失败态 ---------- */
  if (error && items.length === 0) {
    return (
      <main className="mx-auto max-w-4xl px-6 pb-20 pt-8">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-ink-500 transition-colors hover:bg-white hover:text-ink-900"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          返回筛选
        </button>
        <div className="mt-4 flex items-start gap-3 rounded-xl2 border border-rose-200 bg-rose-50 px-5 py-6">
          <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
          <div>
            <p className="text-sm font-semibold text-rose-700">匹配失败</p>
            <p className="mt-1 text-[13px] leading-relaxed text-rose-700">{error}</p>
          </div>
        </div>
      </main>
    );
  }

  /* ---------- 空态 ---------- */
  if (!polling && items.length === 0) {
    return (
      <main className="mx-auto max-w-4xl px-6 pb-20 pt-8">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-ink-500 transition-colors hover:bg-white hover:text-ink-900"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          返回筛选
        </button>
        <div className="mt-4 rounded-xl2 border border-surface-line bg-white px-6 py-12 text-center shadow-card">
          <p className="text-sm font-medium text-ink-700">没有可展示的匹配结果</p>
          <p className="mt-1.5 text-[13px] text-ink-500">
            可能是这一批简历都解析失败，建议换一份可复制的 PDF 再试。
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 pb-20 pt-8">
      {/* 顶部：JD 摘要 + 操作 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] text-ink-500">匹配岗位</p>
          <p className="mt-1 truncate text-[15px] font-semibold text-ink-900" title={jdText}>
            {jdSummary}
          </p>
          <p className="num mt-1 text-[11px] text-ink-500">
            共 {items.length} 份简历参与匹配
            {failedCount > 0 ? ` · ${failedCount} 份解析失败未参与` : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 rounded-xl border border-surface-line bg-white px-4 py-2 text-sm font-medium text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-700"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            重新匹配
          </button>
          {downloadUrl ? (
            <a
              href={downloadUrl}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
            >
              <DownloadIcon className="h-4 w-4" />
              导出
            </a>
          ) : (
            <button
              type="button"
              disabled
              title="演示环境暂不支持导出"
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl bg-ink-300 px-4 py-2 text-sm font-semibold text-white"
            >
              <DownloadIcon className="h-4 w-4" />
              导出
            </button>
          )}
        </div>
      </div>

      {polling ? (
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-2.5 text-[12px] text-brand-700">
          <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
          {task?.stage ?? "正在匹配"} · 基础评分已出，AI 深度分析完成后排名可能变化
        </p>
      ) : null}

      {/* 排序表格 */}
      <div className="mt-5 overflow-hidden rounded-xl2 border border-surface-line bg-white shadow-card">
        <div className="overflow-x-auto">
          <div className="min-w-[1000px]">
            {/* 表头 */}
            <div className="grid grid-cols-[56px_minmax(170px,1.3fr)_130px_96px_minmax(150px,1.2fr)_minmax(150px,1.2fr)_44px] items-center gap-3 border-b border-surface-line bg-surface-soft/70 px-5 py-2.5 text-[11px] font-medium text-ink-500">
              <span>排名</span>
              <span>简历</span>
              <span>总分</span>
              <span>等级</span>
              <span>命中关键词</span>
              <span>缺失关键词</span>
              <span />
            </div>

            {items.map((item, index) => {
              const tone = levelTone(item.level);
              const scoreStyle = scoreTone(item.score);
              const expanded = expandedId === item.resume_id;
              const isFailedRow = item.score === 0 && item.subscores.length === 0;

              return (
                <div key={item.resume_id} className="border-b border-surface-line last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : item.resume_id)}
                    className={`grid w-full grid-cols-[56px_minmax(170px,1.3fr)_130px_96px_minmax(150px,1.2fr)_minmax(150px,1.2fr)_44px] items-center gap-3 px-5 py-3.5 text-left transition-colors ${
                      expanded ? "bg-brand-50/40" : "hover:bg-surface-soft/60"
                    }`}
                  >
                    <span className="num text-[13px] font-medium text-ink-500">
                      {isFailedRow ? "—" : index + 1}
                    </span>

                    <span className="min-w-0 truncate text-[13px] font-medium text-ink-900" title={item.name}>
                      {item.name}
                    </span>

                    <span className="flex items-center gap-2">
                      <span className={`num text-[15px] font-semibold ${scoreStyle.text}`}>
                        {item.score}
                      </span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200/70">
                        <span
                          className={`bar-grow block h-full rounded-full ${scoreStyle.bar}`}
                          style={{ width: `${Math.max(0, Math.min(100, item.score))}%` }}
                        />
                      </span>
                    </span>

                    <span className="flex flex-col gap-1">
                      <span
                        className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tone.chip}`}
                      >
                        {item.level_label}
                      </span>
                      <span className="text-[10px] text-ink-500">
                        {item.degraded ? "基础评分" : "AI 已分析"}
                      </span>
                    </span>

                    <span className="flex flex-wrap gap-1">
                      {item.matched.slice(0, 3).map((keyword) => (
                        <KeywordChip key={keyword} text={keyword} tone="hit" />
                      ))}
                      {item.matched.length > 3 ? (
                        <span className="num text-[11px] text-ink-500">
                          +{item.matched.length - 3}
                        </span>
                      ) : null}
                      {item.matched.length === 0 ? (
                        <span className="text-[11px] text-ink-300">—</span>
                      ) : null}
                    </span>

                    <span className="flex flex-wrap gap-1">
                      {item.missing.slice(0, 3).map((keyword) => (
                        <KeywordChip key={keyword} text={keyword} tone="miss" />
                      ))}
                      {item.missing.length > 3 ? (
                        <span className="num text-[11px] text-ink-500">
                          +{item.missing.length - 3}
                        </span>
                      ) : null}
                      {item.missing.length === 0 ? (
                        <span className="text-[11px] text-ink-300">—</span>
                      ) : null}
                    </span>

                    <span className="grid place-items-center">
                      <ChevronDownIcon
                        className={`h-4 w-4 text-ink-300 transition-transform ${
                          expanded ? "rotate-180" : ""
                        }`}
                      />
                    </span>
                  </button>

                  {expanded ? (
                    // 表格在窄屏下横向滚动，详情固定在左侧且不超过可视宽度，避免右侧分数被截断
                    <div className="sticky left-0 max-w-[calc(100vw-3rem)] border-t border-surface-line bg-surface-soft/40 px-5 py-6">
                      <ExpandedReport item={item} />
                      <InterviewEntry
                        item={item}
                        resumeStatus={
                          ingest.items.find((it) => it.resume_id === item.resume_id)?.status ??
                          "ready"
                        }
                        onStart={() => setInterviewItem(item)}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="mt-6 flex items-start gap-2 text-[11px] leading-relaxed text-ink-500">
        <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          排序按总分降序。所有简历先做基础评分（技能关键词 55%、文本相似度 30%、学历
          15%）；基础分前 8 份再做 AI 深度分析，总分 = 基础分 × 35% + AI 诊断分 × 65%。标有“基础评分”的简历未做 AI
          分析。AI 判断仅供参考，请结合人工复核。
        </span>
      </p>

      {interviewItem ? (
        <InterviewPage
          resumeId={interviewItem.resume_id}
          resumeName={interviewItem.name}
          resumeStatus={
            ingest.items.find((it) => it.resume_id === interviewItem.resume_id)?.status ?? "ready"
          }
          jdText={jdText}
          onExit={() => setInterviewItem(null)}
        />
      ) : null}
    </main>
  );
}
