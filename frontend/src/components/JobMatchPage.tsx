import { useEffect, useMemo, useRef, useState } from "react";
import type { IngestTask, Job, ResumeStatus } from "../types";
import { STATUS_LABEL, getIngestTask, uploadResumes } from "../api/resumes";
import { createJobMatch, listJobs } from "../api/jobs";
import { useTask } from "../lib/useTask";
import { DropZone } from "./DropZone";
import { StepBar } from "./StepBar";
import { JobJdDialog } from "./JobJdDialog";
import {
  AlertIcon,
  ArrowRightIcon,
  CheckIcon,
  FileIcon,
  InfoIcon,
  SpinnerIcon,
} from "./icons";

/** 返回首页或刷新后保留的输入：已上传的简历（解析任务 ID）和已选岗位 */
export interface JobMatchDraft {
  resumeTaskId: string | null;
  selected: string[];
  /** File 对象只在内存里保留，刷新后无法恢复，但简历卡片仍可通过解析任务显示 */
  files: File[];
}

/** 上一次发起的匹配，用于“继续查看” */
export interface LastMatchSummary {
  resumeName: string;
  jobCount: number;
  savedAt: number;
}

interface JobMatchPageProps {
  onStartMatch: (
    taskId: string,
    resumeId: string,
    resumeName: string,
    resumeStatus: ResumeStatus,
    jobIndex: Record<string, Job>,
    jobIds: string[]
  ) => void;
  draft: JobMatchDraft;
  onDraftChange: (draft: JobMatchDraft) => void;
  lastMatch: LastMatchSummary | null;
  onOpenLastMatch: () => void;
}

function formatSavedAt(savedAt: number): string {
  const date = new Date(savedAt);
  const sameDay = new Date().toDateString() === date.toDateString();
  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `今天 ${time}` : `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${time}`;
}

const RESUME_STATUS_STYLE: Record<ResumeStatus, string> = {
  ready: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  need_review: "bg-amber-50 text-amber-700 ring-amber-200",
  not_resume: "bg-rose-50 text-rose-700 ring-rose-200",
  failed: "bg-rose-50 text-rose-700 ring-rose-200",
};

/** 行业色标：让一屏几十个岗位有可扫读的视觉锚点 */
const CATEGORY_DOT: Record<string, string> = {
  计算机: "bg-blue-500",
  电子机械: "bg-amber-500",
  土木建筑: "bg-stone-500",
  化工材料: "bg-violet-500",
  生物医药: "bg-emerald-500",
  经管财会: "bg-rose-500",
  文法教育: "bg-cyan-500",
  外语传播: "bg-teal-500",
  艺术设计: "bg-pink-500",
  农林环境: "bg-lime-600",
};

/** 主入口：上传一份简历，从岗位目录里勾选多个岗位发起匹配 */
export function JobMatchPage({
  onStartMatch,
  draft,
  onDraftChange,
  lastMatch,
  onOpenLastMatch,
}: JobMatchPageProps) {
  // 从“换个岗位再匹配”返回或刷新页面时，沿用已上传的简历和已选岗位
  const [files, setFiles] = useState<File[]>(draft.files);
  const [resumeTaskId, setResumeTaskId] = useState<string | null>(draft.resumeTaskId);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobTotal, setJobTotal] = useState(0);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("全部");

  const [selected, setSelected] = useState<string[]>(draft.selected);
  const [submitting, setSubmitting] = useState(false);
  const [jdJob, setJdJob] = useState<Job | null>(null);

  const {
    data: ingest,
    error: pollError,
    transient: pollTransient,
    retry: retryIngest,
  } = useTask<IngestTask>(getIngestTask, resumeTaskId);

  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  useEffect(() => {
    onDraftChangeRef.current({ resumeTaskId, selected, files });
  }, [resumeTaskId, selected, files]);
  const resume = ingest?.items[0] ?? null;
  // 只有一份简历：拿到解析结果（非 failed）就可以发起匹配
  // 失败和「不是简历」都不能继续，前者可能是格式问题，后者内容不对
  const parsed = !!resume && resume.status !== "failed" && resume.status !== "not_resume";
  // 只有后端明确返回失败才算解析失败；轮询网络错误或等待超时不能证明解析失败
  const resumeFailed = resume?.status === "failed" || ingest?.status === "failed";
  const pollUnavailable = !!resumeTaskId && !!pollError && pollTransient && !resumeFailed;
  const hasResume = files.length > 0 || !!resumeTaskId;
  // setState 是异步的，同一时刻连点两次都会读到旧的 submitting；用 ref 做同步闸门，只发一次请求
  const inFlight = useRef(false);

  /* 拉岗位目录 */
  useEffect(() => {
    let cancelled = false;
    setJobsLoading(true);
    setJobsError(null);

    listJobs({ page: 1, page_size: 50 })
      .then((data) => {
        if (cancelled) return;
        setJobs(data.items);
        setJobTotal(data.total);
        // 目录更新后已下架的岗位不能再保留在已选里
        const ids = new Set(data.items.map((job) => job.job_id));
        setSelected((prev) => prev.filter((id) => ids.has(id)));
      })
      .catch((err: unknown) => {
        if (!cancelled) setJobsError(err instanceof Error ? err.message : "岗位目录加载失败");
      })
      .finally(() => {
        if (!cancelled) setJobsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => {
    const set = new Set(jobs.map((job) => job.category));
    return ["全部", ...Array.from(set)];
  }, [jobs]);

  const categoryCount = useMemo(() => {
    const map = new Map<string, number>();
    jobs.forEach((job) => map.set(job.category, (map.get(job.category) ?? 0) + 1));
    return map;
  }, [jobs]);

  const visibleJobs = useMemo(
    () => (category === "全部" ? jobs : jobs.filter((job) => job.category === category)),
    [jobs, category]
  );

  const jobIndex = useMemo(
    () => Object.fromEntries(jobs.map((job) => [job.job_id, job])) as Record<string, Job>,
    [jobs]
  );

  const canSubmit = parsed && selected.length > 0 && !submitting && !uploading;

  async function handleFileChange(next: File[]) {
    setFiles(next);
    setError(null);
    setResumeTaskId(null);
    if (next.length === 0) return;

    setUploading(true);
    try {
      const { task_id } = await uploadResumes(next);
      setResumeTaskId(task_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败，请重试");
    } finally {
      setUploading(false);
    }
  }

  /** 轮询失败（网络异常或等待超时）时，用同一个解析任务立即重新查询，不必重新上传 */
  function retryPoll() {
    retryIngest();
  }

  function toggleJob(jobId: string) {
    setSelected((prev) =>
      prev.includes(jobId) ? prev.filter((id) => id !== jobId) : [...prev, jobId]
    );
  }

  async function handleSubmit() {
    if (!resume || !canSubmit || inFlight.current) return;
    inFlight.current = true;

    setSubmitting(true);
    setError(null);
    try {
      const { task_id } = await createJobMatch(resume.resume_id, selected);
      onStartMatch(task_id, resume.resume_id, resume.name, resume.status, jobIndex, selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建匹配任务失败，请重试");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6 sm:pt-12">
      <div className="rise-in max-w-3xl">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-700 ring-1 ring-inset ring-brand-100">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
          岗位推荐
        </span>
        <h1 className="mt-4 text-[26px] font-semibold leading-snug tracking-tight sm:text-[34px]">
          上传一份简历，寻找适合的岗位
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-500">
          上传简历、勾选想投的岗位，系统会按匹配度排好序，并说明你哪里合适、哪里还差。点开任意岗位能看到详细分析，还能针对它练五轮模拟面试。
        </p>

        <div className="mt-5">
          <StepBar current={1} />
        </div>
      </div>

      {lastMatch ? (
        <div className="mt-6 flex flex-col gap-2 rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-[12px] leading-relaxed text-brand-800">
            上次匹配：<span className="font-medium">{lastMatch.resumeName}</span> · {lastMatch.jobCount} 个岗位 ·{" "}
            {formatSavedAt(lastMatch.savedAt)}
          </p>
          <button
            type="button"
            onClick={onOpenLastMatch}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-brand-700"
          >
            继续查看结果
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        {/* 左：简历 */}
        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <span className="num rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-600">
              01
            </span>
            <h2 className="text-sm font-semibold">我的简历</h2>
          </div>

          <DropZone
            files={files}
            onChange={handleFileChange}
            disabled={uploading}
            maxFiles={1}
            title="拖拽简历到这里，或"
          />

          {uploading || resumeTaskId ? (
            <div className="rounded-xl2 border border-surface-line bg-white p-4 shadow-card">
              {!resume ? (
                <p className="flex items-center gap-2 text-[13px] text-ink-500">
                  <SpinnerIcon className="h-4 w-4 animate-spin" />
                  {ingest?.stage || "正在解析简历…"}
                </p>
              ) : (
                <>
                  <div className="flex items-start gap-2.5">
                    <FileIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-300" />
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate text-[13px] font-medium text-ink-900"
                        title={resume.name}
                      >
                        {resume.name}
                      </p>
                      <p className="num mt-1 text-[11px] text-ink-500">
                        {resume.chars.toLocaleString("zh-CN")} 字
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${RESUME_STATUS_STYLE[resume.status]}`}
                    >
                      {STATUS_LABEL[resume.status]}
                    </span>
                  </div>

                  {resume.status === "need_review" ? (
                    <p className="mt-3 text-[11px] leading-relaxed text-amber-700">
                      识别质量偏低
                      {typeof resume.low_conf === "number" && resume.low_conf > 0
                        ? `（${resume.low_conf} 行置信度较低）`
                        : ""}
                      ，匹配结果可能有偏差，建议核对原文后再用。
                    </p>
                  ) : null}

                  {resume.status === "not_resume" ? (
                    <p className="mt-3 rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] leading-relaxed text-rose-700">
                      这份文件看起来不是简历，无法继续匹配。请换一份简历文件后重试。
                    </p>
                  ) : null}

                  {resume.status === "failed" ? (
                    <p className="mt-3 rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] leading-relaxed text-rose-700">
                      {resume.error?.code === "OCR_FAILED"
                        ? "图片里没有识别到文字，请换一张更清晰的扫描件或直接上传 PDF/DOCX。"
                        : resume.error?.code === "OCR_UNAVAILABLE"
                          ? "当前环境无法使用图片识别，请改用 PDF 或 DOCX 上传。"
                          : resume.error?.message || "解析失败，请换一份文件重试。"}
                    </p>
                  ) : null}

                  <p className="mt-3 line-clamp-3 rounded-lg bg-surface-soft/70 px-2.5 py-2 text-[11px] leading-relaxed text-ink-500">
                    {resume.preview}
                  </p>
                </>
              )}
            </div>
          ) : null}

          {pollError ? (
            <p
              className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-[12px] ${
                pollUnavailable
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">{pollError}</span>
              {pollUnavailable ? (
                <button
                  type="button"
                  onClick={retryPoll}
                  className="shrink-0 rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-700"
                >
                  重新获取
                </button>
              ) : null}
            </p>
          ) : null}
        </section>

        {/* 右：岗位目录 */}
        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="num rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-600">
                02
              </span>
              <h2 className="text-sm font-semibold">候选岗位</h2>
              <span className="num text-[11px] text-ink-500">
                可投 {jobTotal} 个 · 已选 {selected.length}
              </span>
            </div>
          </div>

          {jobsLoading ? (
            <div className="flex flex-col gap-2" aria-busy="true" aria-label="正在加载岗位目录">
              <div className="flex gap-1.5">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-6 w-16 animate-pulse rounded-full bg-slate-100"
                    style={{ animationDelay: `${i * 60}ms` }}
                  />
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-surface-line bg-white p-3"
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
                    <div className="mt-2 h-2.5 w-1/2 animate-pulse rounded bg-slate-100" />
                  </div>
                ))}
              </div>
            </div>
          ) : jobsError ? (
            <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] text-rose-700">
              <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{jobsError}</span>
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5 pb-1">
                {categories.map((item) => {
                  const active = item === category;
                  const count = item === "全部" ? jobs.length : (categoryCount.get(item) ?? 0);
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setCategory(item)}
                      className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        active
                          ? "bg-ink-900 text-white"
                          : "bg-white text-ink-500 ring-1 ring-inset ring-surface-line hover:text-ink-900"
                      }`}
                    >
                      {item}
                      <span className={`num ml-1 ${active ? "text-white/60" : "text-ink-300"}`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {visibleJobs.length === 0 ? (
                <p className="rounded-xl border border-surface-line bg-white px-4 py-6 text-center text-[12px] leading-relaxed text-ink-500">
                  {jobs.length === 0
                    ? "当前没有已核验可投的岗位，暂不能用待核验线索替代。岗位核验通过后会陆续出现在这里。"
                    : "该分类下暂无已核验可投岗位，换个分类看看。"}
                </p>
              ) : null}

              <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {visibleJobs.map((job, index) => {
                  const active = selected.includes(job.job_id);
                  const dot = CATEGORY_DOT[job.category] ?? "bg-slate-400";
                  return (
                    <div
                      key={job.job_id}
                      style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
                      className={`rise-in flex items-start gap-1 rounded-xl border transition-all ${
                        active
                          ? "border-brand-400 bg-brand-50/50 shadow-sm"
                          : "border-surface-line bg-white hover:border-brand-200 hover:bg-brand-50/20"
                      }`}
                    >
                    <button
                      type="button"
                      onClick={() => toggleJob(job.job_id)}
                      aria-pressed={active}
                      className="flex min-w-0 flex-1 items-start gap-2.5 p-3 text-left"
                    >
                      <span
                        className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${
                          active ? "border-brand-600 bg-brand-600 text-white" : "border-ink-300"
                        }`}
                      >
                        {active ? <CheckIcon className="h-3 w-3" /> : null}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
                          <span className="truncate text-[13px] font-medium text-ink-900">
                            {job.title}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-ink-500">
                          {job.company} · {job.cities[0]}
                          {job.cities.length > 1 ? ` +${job.cities.length - 1}` : ""} ·{" "}
                          {job.education}
                        </span>
                      </span>
                    </button>
                    {/* 选之前先看 JD：独立按钮，不和勾选混在一起 */}
                    <button
                      type="button"
                      onClick={() => setJdJob(job)}
                      aria-label={`查看 ${job.title} 的岗位要求`}
                      className="m-2 shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-brand-600 hover:bg-brand-50"
                    >
                      查看要求
                    </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>

      {error ? (
        <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1 leading-relaxed">{error}</span>
        </div>
      ) : null}

      <div className="mt-7 flex flex-col-reverse items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] leading-relaxed text-ink-500">
          {!hasResume
            ? "先上传一份简历"
            : !uploading && !resumeTaskId
              ? "简历上传未成功，请按提示换一份文件重新上传"
              : resumeFailed
              ? "简历解析失败，请换一份简历重新上传"
              : pollUnavailable
                ? "暂时拿不到解析结果（网络异常或等待超时），可点「重新获取」或稍后再看"
                : !parsed
                ? "简历解析中，完成后即可发起匹配"
                : selected.length === 0
                  ? "请至少勾选 1 个候选岗位"
                  : `已选 ${selected.length} 个岗位，将逐岗给出匹配分与推荐理由`}
        </p>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="group inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-700 hover:shadow-md disabled:cursor-not-allowed disabled:bg-ink-300 disabled:shadow-none"
        >
          {submitting ? (
            <>
              <SpinnerIcon className="h-4 w-4 animate-spin" />
              正在发起匹配…
            </>
          ) : (
            <>
              开始匹配
              <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </div>

      <p className="mt-10 flex items-start gap-2 text-[11px] leading-relaxed text-ink-500">
        <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          上传的简历会暂存在服务端用于本次匹配分析，不会对外分享。匹配分由关键词与文本相似度等规则计算，
          推荐理由与诊断建议由 AI 生成，仅供参考，不构成录用判断。
        </span>
      </p>

      {jdJob ? (
        <JobJdDialog
          job={jdJob}
          selected={selected.includes(jdJob.job_id)}
          onToggle={() => toggleJob(jdJob.job_id)}
          onClose={() => setJdJob(null)}
        />
      ) : null}
    </main>
  );
}
