import { useEffect, useMemo, useRef, useState } from "react";
import type { IngestTask, Job, ResumeStatus } from "../types";
import { STATUS_LABEL, getIngestTask, uploadResumes } from "../api/resumes";
import { createJobMatch, listJobs } from "../api/jobs";
import { useTask } from "../lib/useTask";
import { DropZone } from "./DropZone";
import { JobJdDialog } from "./JobJdDialog";

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
  const [search, setSearch] = useState("");

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

    async function loadJobs() {
      const first = await listJobs({ page: 1, page_size: 100 });
      const allJobs = [...first.items];
      for (let page = 2; allJobs.length < first.total; page++) {
        const next = await listJobs({ page, page_size: 100 });
        if (next.items.length === 0) break;
        allJobs.push(...next.items);
      }
      return { ...first, items: allJobs };
    }
    loadJobs().then((data) => {
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
    () => jobs.filter((job) => (category === "全部" || job.category === category) &&
      [job.title, job.company, job.category, ...job.cities].join(" ").toLowerCase().includes(search.trim().toLowerCase())),
    [jobs, category, search]
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
    <main className="offer-picker">
      <div className="picker-title"><div><span className="offer-eyebrow">FIND YOUR MATCH</span><h1>选择岗位</h1><p>挑选感兴趣的岗位，用简历发现更适合你的方向。</p></div>
        {lastMatch && <button className="picker-last" onClick={onOpenLastMatch}>继续查看上次结果 →</button>}
      </div>
      <div className="picker-layout">
        <div className="picker-main">
          <div className="picker-toolbar">
            <div className="picker-categories" role="group" aria-label="岗位分类">
              {categories.map((item) => <button type="button" key={item} aria-pressed={item === category} onClick={() => setCategory(item)} className={item === category ? "active" : ""}>{item}<span>{item === "全部" ? jobTotal : categoryCount.get(item) ?? 0}</span></button>)}
            </div>
            <label className="picker-search"><span className="sr-only">搜索岗位</span><input type="search" placeholder="搜索岗位或公司" value={search} onChange={(e) => setSearch(e.target.value)} /><span aria-hidden="true">⌕</span></label>
          </div>
          {jobsLoading ? <p className="picker-message" aria-busy="true">正在加载岗位…</p> : jobsError ? <p className="picker-message" role="alert">{jobsError}</p> : visibleJobs.length === 0 ? <p className="picker-message">没有找到符合条件的岗位，请尝试其他分类或关键词。</p> : (
            <div className="picker-grid">
              {visibleJobs.map((job) => {
                const active = selected.includes(job.job_id);
                return <article className={`picker-card ${active ? "selected" : ""}`} key={job.job_id}>
                  <button className="picker-card-select" type="button" aria-pressed={active} onClick={() => toggleJob(job.job_id)}>
                    <span className="picker-company-row"><span className="picker-logo">{job.company.slice(0, 1)}</span><span className="picker-company"><strong>{job.company}</strong><small>{job.cities.join(" / ")}</small></span><span className="picker-check" aria-hidden="true">{active ? "✓" : ""}</span></span>
                    <span className="picker-job-title">{job.title}</span>
                    <span className="picker-tags"><span>{job.category}</span><span>{job.education}</span></span>
                  </button>
                  <div className="picker-card-footer"><button type="button" onClick={() => setJdJob(job)} aria-label={`查看 ${job.title} 的岗位要求`}>查看 JD →</button><span>{active ? "已选择" : "点击选择"}</span></div>
                </article>;
              })}
            </div>
          )}
        </div>
        <div className="picker-aside">
          <section className="picker-panel" aria-label="已选岗位">
            <div className="picker-panel-head"><h2>已选岗位</h2><span><b>{selected.length}</b> / {jobTotal}</span></div>
            {selected.length === 0 ? <p className="picker-empty">还没有选，点击岗位卡片选择</p> : <div className="picker-picked">
              {selected.map((id) => jobIndex[id]).filter((job): job is Job => !!job).map((job) => <div className="picker-picked-item" key={job.job_id}><span className="picker-logo small">{job.company.slice(0, 1)}</span><span className="picker-picked-name"><strong>{job.title}</strong><small>{job.company}</small></span><button type="button" onClick={() => toggleJob(job.job_id)} aria-label={`移除 ${job.title}`}>×</button></div>)}
            </div>}
            <p className="picker-hint">系统会逐岗计算匹配分；AI 分析可用时提供诊断建议。</p>
            <button className="picker-submit" type="button" onClick={handleSubmit} disabled={!canSubmit}>{submitting ? "正在发起匹配…" : "开始匹配 →"}</button>
            <p className="picker-hint" aria-live="polite">{!hasResume ? "请先上传一份简历" : !uploading && !resumeTaskId ? "简历上传未成功，请重新上传" : resumeFailed ? "简历解析失败，请换一份简历" : pollUnavailable ? "暂时无法获取解析结果，请重试" : !parsed ? "简历解析中，完成后即可匹配" : selected.length === 0 ? "请至少选择一个岗位" : `已选择 ${selected.length} 个岗位`}</p>
            {error && <p className="picker-error" role="alert">{error}</p>}
          </section>
          <section className="picker-panel picker-resume" aria-label="用于匹配的简历">
            <div className="picker-panel-head"><h2>用于匹配的简历</h2></div>
            {resume ? <div className="picker-resume-detail"><span className="picker-logo small">▤</span><span><strong>{resume.name}</strong><small>{resume.chars.toLocaleString("zh-CN")} 字 · {STATUS_LABEL[resume.status]}</small></span></div> : <p className="picker-hint">{uploading || resumeTaskId ? "正在解析简历…" : "上传简历后即可开始匹配。"}</p>}
            {resume?.status === "need_review" && <p className="picker-error">识别质量偏低，请核对原文，匹配结果可能有偏差。</p>}
            {resume?.status === "not_resume" && <p className="picker-error">这份文件看起来不是简历，请更换后重试。</p>}
            {resume?.status === "failed" && <p className="picker-error">{resume.error?.message || "解析失败，请更换文件重试。"}</p>}
            {pollError && <p className="picker-error" role="alert">{pollError} {pollUnavailable && <button type="button" onClick={retryPoll}>重新获取</button>}</p>}
            <DropZone files={files} onChange={handleFileChange} disabled={uploading} maxFiles={1} title="上传或拖拽简历" />
            <p className="picker-hint">简历用于本次匹配分析。AI 建议仅供参考，不构成录用判断。</p>
          </section>
        </div>
      </div>
      {jdJob && <JobJdDialog job={jdJob} selected={selected.includes(jdJob.job_id)} onToggle={() => toggleJob(jdJob.job_id)} onClose={() => setJdJob(null)} />}
    </main>
  );
}
