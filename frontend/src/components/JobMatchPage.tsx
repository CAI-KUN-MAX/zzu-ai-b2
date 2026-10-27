import { useEffect, useMemo, useRef, useState } from "react";
import type { IngestTask, Job, ResumeStatus } from "../types";
import { STATUS_LABEL, getIngestTask, uploadResumes } from "../api/resumes";
import { createJobMatch, listJobs } from "../api/jobs";
import { useTask } from "../lib/useTask";
import { DropZone } from "./DropZone";
import {
  AlertIcon,
  ArrowRightIcon,
  CheckIcon,
  FileIcon,
  InfoIcon,
  SpinnerIcon,
} from "./icons";

interface JobMatchPageProps {
  onStartMatch: (
    taskId: string,
    resumeId: string,
    resumeName: string,
    resumeStatus: ResumeStatus,
    jobIndex: Record<string, Job>
  ) => void;
}

const RESUME_STATUS_STYLE: Record<ResumeStatus, string> = {
  ready: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  need_review: "bg-amber-50 text-amber-700 ring-amber-200",
  failed: "bg-rose-50 text-rose-700 ring-rose-200",
};

/** 主入口：上传一份简历，从岗位目录里勾选多个岗位发起匹配 */
export function JobMatchPage({ onStartMatch }: JobMatchPageProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [resumeTaskId, setResumeTaskId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobTotal, setJobTotal] = useState(0);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("全部");

  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const { data: ingest, error: pollError } = useTask<IngestTask>(getIngestTask, resumeTaskId);
  const resume = ingest?.items[0] ?? null;
  // 只有一份简历：拿到解析结果（非 failed）就可以发起匹配
  const parsed = !!resume && resume.status !== "failed";
  // 只有后端明确返回失败才算解析失败；轮询网络错误或等待超时不能证明解析失败
  const resumeFailed = resume?.status === "failed" || ingest?.status === "failed";
  const pollUnavailable = !!resumeTaskId && !!pollError && !resumeFailed;
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

  /** 轮询失败（网络异常或等待超时）时，用同一个解析任务重新轮询，不必重新上传 */
  function retryPoll() {
    const taskId = resumeTaskId;
    if (!taskId) return;
    setResumeTaskId(null);
    window.setTimeout(() => setResumeTaskId(taskId), 0);
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
      onStartMatch(task_id, resume.resume_id, resume.name, resume.status, jobIndex);
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
          上传简历并勾选多个候选岗位，按匹配度排序并给出推荐理由与缺口。点开岗位可看诊断报告，并针对该岗位练五轮模拟面试。
        </p>
      </div>

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
                      识别质量偏低，匹配结果可能有偏差，建议核对原文后再用。
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
            <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12px] text-rose-700">
              <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">{pollError}</span>
              {pollUnavailable ? (
                <button
                  type="button"
                  onClick={retryPoll}
                  className="shrink-0 rounded-md bg-rose-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-rose-700"
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
            <p className="flex items-center gap-2 rounded-xl border border-surface-line bg-white px-4 py-6 text-[13px] text-ink-500">
              <SpinnerIcon className="h-4 w-4 animate-spin" />
              正在加载岗位目录…
            </p>
          ) : jobsError ? (
            <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] text-rose-700">
              <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{jobsError}</span>
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {categories.map((item) => {
                  const active = item === category;
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setCategory(item)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        active
                          ? "bg-ink-900 text-white"
                          : "bg-white text-ink-500 ring-1 ring-inset ring-surface-line hover:text-ink-900"
                      }`}
                    >
                      {item}
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
                {visibleJobs.map((job) => {
                  const active = selected.includes(job.job_id);
                  return (
                    <button
                      key={job.job_id}
                      type="button"
                      onClick={() => toggleJob(job.job_id)}
                      aria-pressed={active}
                      className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all ${
                        active
                          ? "border-brand-400 bg-brand-50/50 shadow-sm"
                          : "border-surface-line bg-white hover:border-brand-200 hover:bg-brand-50/20"
                      }`}
                    >
                      <span
                        className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${
                          active ? "border-brand-600 bg-brand-600 text-white" : "border-ink-300"
                        }`}
                      >
                        {active ? <CheckIcon className="h-3 w-3" /> : null}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-ink-900">
                          {job.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-ink-500">
                          {job.company} · {job.cities.join(" / ")} · {job.education}
                        </span>
                      </span>
                    </button>
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
          {!files.length
            ? "先上传一份简历"
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
    </main>
  );
}
