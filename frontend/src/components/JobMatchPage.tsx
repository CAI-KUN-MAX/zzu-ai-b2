import { useEffect, useMemo, useRef, useState } from "react";
import type { IngestTask, Job, JobMatchTask, ResumeStatus } from "../types";
import { STATUS_LABEL, getIngestTask, uploadResumes } from "../api/resumes";
import { createJobMatch, createJobRecommendation, getJobMatchTask, listJobs } from "../api/jobs";
import { saveLastResume } from "../lib/jobMatchStorage";
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
  /** 从首页搜索框进来时带的关键词 */
  initialSearch?: string;
}

const ALL = "全部";
/** 全部岗位每次多显示这么多张，不一次堆满页面 */
const LIST_PAGE_SIZE = 12;
/** 推荐先露出几张，其余点开再看 */
const REC_PREVIEW = 4;
/** 同一份简历切页回来不重复发请求；刷新后后端也会复用同一个任务 */
const recommendationTasks = new Map<string, string>();

function cityLabel(cities: string[]) {
  return cities.length > 2 ? `${cities[0]} 等 ${cities.length} 城` : cities.join(" / ");
}

interface PickerCardProps {
  job: Job;
  active: boolean;
  /** 后端给出的推荐理由，只在推荐区显示 */
  reason?: string | null;
  onToggle: () => void;
  onDetail: () => void;
}

function PickerCard({ job, active, reason, onToggle, onDetail }: PickerCardProps) {
  return (
    <article className={`picker-card ${active ? "selected" : ""}`}>
      <button className="picker-card-select" type="button" aria-pressed={active} onClick={onToggle}>
        <span className="picker-logo small" aria-hidden="true">{job.company.slice(0, 1)}</span>
        <span className="picker-card-text">
          <span className="picker-job-title">{job.title}</span>
          <small>{job.company} · {cityLabel(job.cities)} · {job.education}</small>
          {reason ? <small className="picker-card-reason"><strong>推荐理由：</strong>{reason}</small> : null}
        </span>
        <span className="picker-check" aria-hidden="true">{active ? "✓" : ""}</span>
      </button>
      <button className="picker-card-detail" type="button" onClick={onDetail} aria-label={`查看 ${job.title} 的岗位详情`}>详情</button>
    </article>
  );
}

/** 主入口：上传一份简历，优先从系统推荐里选，也可以自己搜索、筛选岗位目录 */
export function JobMatchPage({
  onStartMatch,
  draft,
  onDraftChange,
  lastMatch,
  onOpenLastMatch,
  initialSearch,
}: JobMatchPageProps) {
  // 从“换个岗位再匹配”返回或刷新页面时，沿用已上传的简历和已选岗位
  const [files, setFiles] = useState<File[]>(draft.files);
  const [resumeTaskId, setResumeTaskId] = useState<string | null>(draft.resumeTaskId);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumeExpired, setResumeExpired] = useState(false);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobTotal, setJobTotal] = useState(0);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>(ALL);
  const [education, setEducation] = useState<string>(ALL);
  const [city, setCity] = useState<string>(ALL);
  const [search, setSearch] = useState(initialSearch ?? "");
  const [shownCount, setShownCount] = useState(LIST_PAGE_SIZE);
  const [recExpanded, setRecExpanded] = useState(false);
  const [recTaskId, setRecTaskId] = useState<string | null>(null);
  const [recError, setRecError] = useState<string | null>(null);
  const [recAttempt, setRecAttempt] = useState(0);
  const resumePanelRef = useRef<HTMLElement>(null);

  const [selected, setSelected] = useState<string[]>(draft.selected);
  const [submitting, setSubmitting] = useState(false);
  const [jdJob, setJdJob] = useState<Job | null>(null);

  const {
    data: ingest,
    error: pollError,
    transient: pollTransient,
    fatal: pollFatal,
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
  const parsed = !!resume && (resume.status === "ready" || resume.status === "need_review");
  // 只有后端明确返回失败才算解析失败；轮询网络错误或等待超时不能证明解析失败
  const resumeFailed = resume?.status === "failed" || ingest?.status === "failed";

  // 后端已经没有这份简历了（换身份、服务清理、链接过期都会这样）：
  // 不能把「记录不存在或不属于当前游客」这种内部说法丢给用户，直接回到重新上传
  useEffect(() => {
    if (!pollFatal) return;
    setResumeTaskId(null);
    setFiles([]);
    setResumeExpired(true);
    onDraftChange({ resumeTaskId: null, selected, files: [] });
    // selected 变化不该触发清理，这里只跟 pollFatal 走
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollFatal]);

  // 解析成功就记下来，首页「为我推荐岗位」不选岗也拿得到简历
  useEffect(() => {
    if (parsed && resume) {
      saveLastResume({ resumeId: resume.resume_id, name: resume.name, status: resume.status === "ready" ? "ready" : "need_review", savedAt: Date.now() });
    }
  }, [parsed, resume?.resume_id, resume?.name, resume?.status]);
  const pollUnavailable = !!resumeTaskId && !!pollError && pollTransient && !resumeFailed;
  const hasResume = files.length > 0 || !!resumeTaskId;
  const recResumeId = parsed && resume ? resume.resume_id : null;

  /* 简历可用后自动要一份推荐：推荐是默认入口，失败也不影响自己搜索和选择 */
  useEffect(() => {
    setRecError(null);
    setRecExpanded(false);
    if (!recResumeId) {
      setRecTaskId(null);
      return;
    }
    const known = recommendationTasks.get(recResumeId);
    if (known) {
      setRecTaskId(known);
      return;
    }
    setRecTaskId(null);
    let cancelled = false;
    createJobRecommendation(recResumeId)
      .then(({ task_id }) => {
        recommendationTasks.set(recResumeId, task_id);
        if (!cancelled) setRecTaskId(task_id);
      })
      .catch((err: unknown) => {
        if (!cancelled) setRecError(err instanceof Error ? err.message : "推荐暂时不可用");
      });
    return () => {
      cancelled = true;
    };
  }, [recResumeId, recAttempt]);

  const { data: recTask, error: recPollError, retry: retryRecPoll } = useTask<JobMatchTask>(getJobMatchTask, recTaskId);
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

  const educationOptions = useMemo(() => Array.from(new Set(jobs.map((job) => job.education))), [jobs]);
  const cityOptions = useMemo(() => {
    const count = new Map<string, number>();
    jobs.forEach((job) => job.cities.forEach((item) => count.set(item, (count.get(item) ?? 0) + 1)));
    return Array.from(count.keys()).sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0));
  }, [jobs]);

  const filtering = search.trim() !== "" || category !== ALL || education !== ALL || city !== ALL;

  const visibleJobs = useMemo(
    () => jobs.filter((job) => (category === ALL || job.category === category) &&
      (education === ALL || job.education === education) &&
      (city === ALL || job.cities.includes(city)) &&
      [job.title, job.company, job.category, ...job.cities].join(" ").toLowerCase().includes(search.trim().toLowerCase())),
    [jobs, category, education, city, search]
  );

  // 换了筛选条件就回到第一批
  useEffect(() => {
    setShownCount(LIST_PAGE_SIZE);
  }, [category, education, city, search]);

  function clearFilters() {
    setCategory(ALL);
    setEducation(ALL);
    setCity(ALL);
    setSearch("");
  }

  const jobIndex = useMemo(
    () => Object.fromEntries(jobs.map((job) => [job.job_id, job])) as Record<string, Job>,
    [jobs]
  );

  const canSubmit = parsed && selected.length > 0 && !submitting && !uploading;

  // 顺序和理由都来自后端推荐任务，前端不计算
  const recItems = useMemo(
    () => (recTask?.items ?? []).filter((item) => jobIndex[item.job_id]),
    [recTask, jobIndex]
  );
  const recFailed = !!recError || (!!recPollError && !recTask?.items.length);
  const recLoading = !!recResumeId && !recFailed && recItems.length === 0 && recTask?.status !== "succeeded";
  const recEmpty = !!recResumeId && !recFailed && !recLoading && recItems.length === 0;
  const recIds = useMemo(() => new Set(recItems.map((item) => item.job_id)), [recItems]);
  const shownRecItems = recExpanded ? recItems : recItems.slice(0, REC_PREVIEW);
  // 不筛选时，已经在推荐区出现的岗位不重复列出
  const listJobsToShow = useMemo(
    () => (filtering ? visibleJobs : visibleJobs.filter((job) => !recIds.has(job.job_id))),
    [filtering, visibleJobs, recIds]
  );

  function retryRecommendation() {
    if (recResumeId) recommendationTasks.delete(recResumeId);
    retryRecPoll();
    setRecAttempt((n) => n + 1);
  }

  function scrollToResume() {
    resumePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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

  const submitHint = !hasResume ? "请先上传一份简历" : !uploading && !resumeTaskId ? "简历上传未成功，请重新上传" : resumeFailed ? "简历解析失败，请换一份简历" : pollUnavailable ? "暂时无法获取解析结果，请重试" : !parsed ? "简历解析中，完成后即可匹配" : selected.length === 0 ? "请至少选择一个岗位" : `已选择 ${selected.length} 个岗位`;

  return (
    <main className="offer-picker">
      <div className="picker-title"><div><span className="offer-eyebrow">FIND YOUR MATCH</span><h1>选择岗位</h1><p>可选择多个岗位，确认简历后点击“开始匹配”。</p></div>
        {lastMatch && <button className="picker-last" onClick={onOpenLastMatch}>继续查看上次结果 →</button>}
      </div>
      <div className="picker-layout">
        <div className="picker-main">
          {!filtering && (
            <section className="picker-recommend" aria-label="为你推荐">
              <div className="picker-section-head">
                <h2>为你推荐{recItems.length ? <span>{recItems.length}</span> : null}</h2>
                <small>根据你的简历挑选，不合适也可以在下方自己找</small>
              </div>
              {!recResumeId ? (
                <div className="picker-rec-note">
                  <p>{hasResume ? "简历解析完成后，这里会优先显示适合你的岗位。" : "上传简历后，这里会优先显示适合你的岗位。"}</p>
                  {!hasResume && <button type="button" onClick={scrollToResume}>去上传 →</button>}
                </div>
              ) : recFailed ? (
                <div className="picker-rec-note" role="alert">
                  <p>{recError || recPollError || "推荐暂时不可用"}。你仍然可以在下方搜索和选择岗位。</p>
                  <button type="button" onClick={retryRecommendation}>重试</button>
                </div>
              ) : recLoading || jobsLoading ? (
                <p className="picker-message" aria-busy="true">正在按你的简历挑选岗位…</p>
              ) : recEmpty ? (
                <p className="picker-message">暂时没有合适的推荐，可以在下方搜索或筛选岗位。</p>
              ) : (
                <>
                  <div className="picker-grid">
                    {shownRecItems.map((item) => {
                      const job = jobIndex[item.job_id];
                      return <PickerCard key={item.job_id} job={job} active={selected.includes(job.job_id)} reason={item.reason} onToggle={() => toggleJob(job.job_id)} onDetail={() => setJdJob(job)} />;
                    })}
                  </div>
                  {recItems.length > REC_PREVIEW && (
                    <button type="button" className="picker-more" aria-expanded={recExpanded} onClick={() => setRecExpanded((open) => !open)}>
                      {recExpanded ? "收起" : `再看 ${recItems.length - REC_PREVIEW} 个推荐`}
                    </button>
                  )}
                </>
              )}
            </section>
          )}
          <div className="picker-toolbar">
            <label className="picker-search"><span className="sr-only">搜索岗位名称或企业名称</span><input type="search" placeholder="搜索岗位或企业名称" value={search} onChange={(e) => setSearch(e.target.value)} /><span aria-hidden="true">⌕</span></label>
            <label className="picker-select"><span className="sr-only">学历</span><select value={education} onChange={(e) => setEducation(e.target.value)}><option value={ALL}>全部学历</option>{educationOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label className="picker-select"><span className="sr-only">城市</span><select value={city} onChange={(e) => setCity(e.target.value)}><option value={ALL}>全部城市</option>{cityOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <div className="picker-categories" role="group" aria-label="专业类别">
              {categories.map((item) => <button type="button" key={item} aria-pressed={item === category} onClick={() => setCategory(item)} className={item === category ? "active" : ""}>{item}<span>{item === ALL ? jobTotal : categoryCount.get(item) ?? 0}</span></button>)}
            </div>
          </div>
          {jobsLoading ? (!recResumeId && <p className="picker-message" aria-busy="true">正在加载岗位…</p>) : jobsError ? <p className="picker-message" role="alert">{jobsError}</p> : listJobsToShow.length === 0 ? (
            <div className="picker-message"><p>{filtering ? "没有找到符合条件的岗位，请尝试其他分类或关键词。" : recItems.length ? "其他岗位已全部显示在上方推荐中。" : "暂无可展示的岗位。"}</p>{filtering && <button type="button" className="picker-clear" onClick={clearFilters}>清除筛选</button>}</div>
          ) : (
            <section className="picker-list" aria-label={filtering ? "筛选结果" : "全部岗位"}>
              <div className="picker-section-head">
                <h2>{filtering ? "筛选结果" : recItems.length ? "其他岗位" : "全部岗位"}<span>{listJobsToShow.length}</span></h2>
                {!filtering && <small>可继续选择感兴趣的岗位</small>}
                {filtering && <button type="button" className="picker-clear" onClick={clearFilters}>清除筛选</button>}
              </div>
              <div className="picker-grid">
                {listJobsToShow.slice(0, shownCount).map((job) => <PickerCard key={job.job_id} job={job} active={selected.includes(job.job_id)} onToggle={() => toggleJob(job.job_id)} onDetail={() => setJdJob(job)} />)}
              </div>
              {listJobsToShow.length > shownCount && (
                <button type="button" className="picker-more" onClick={() => setShownCount((n) => n + LIST_PAGE_SIZE)}>加载更多（还有 {listJobsToShow.length - shownCount} 个）</button>
              )}
            </section>
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
            <p className="picker-hint" aria-live="polite">{submitHint}</p>
            {error && <p className="picker-error" role="alert">{error}</p>}
          </section>
          <section className="picker-panel picker-resume" aria-label="用于匹配的简历" ref={resumePanelRef}>
            <div className="picker-panel-head"><h2>用于匹配的简历</h2></div>
            {resume ? <div className="picker-resume-detail"><span className="picker-logo small">▤</span><span><strong>{resume.name}</strong><small>{resume.chars.toLocaleString("zh-CN")} 字 · {STATUS_LABEL[resume.status]}</small></span></div> : <p className="picker-hint">{uploading || resumeTaskId ? "正在解析简历…" : "上传简历后即可开始匹配。"}</p>}
            {resume?.status === "need_review" && <p className="picker-error">识别质量偏低，请核对原文，匹配结果可能有偏差。</p>}
            {resume?.status === "not_resume" && <p className="picker-error">这份文件看起来不是简历，请更换后重试。</p>}
            {resume?.status === "failed" && <p className="picker-error">{resume.error?.message || "解析失败，请更换文件重试。"}</p>}
            {resumeExpired && !resumeTaskId ? (
              <p className="picker-hint picker-expired" role="status">
                之前的简历记录已失效，请重新上传一份。
              </p>
            ) : null}
            {pollError && !pollFatal && (
              <p className="picker-error" role="alert">
                {pollError}{" "}
                {pollUnavailable && <button type="button" onClick={retryPoll}>重新获取</button>}
              </p>
            )}
            <DropZone files={files} onChange={handleFileChange} disabled={uploading} maxFiles={1} title="上传或拖拽简历" />
            <p className="picker-hint">简历用于本次匹配分析。AI 建议仅供参考，不构成录用判断。</p>
          </section>
        </div>
      </div>
      {/* 手机上岗位和提交按钮隔得远：选了岗位后常驻底部，不用翻到页尾 */}
      {selected.length > 0 && (
        <div className="picker-sticky">
          <span><strong>已选 {selected.length} 个岗位</strong><small>{canSubmit ? "可以开始匹配了" : submitHint}</small></span>
          <button type="button" onClick={handleSubmit} disabled={!canSubmit}>{submitting ? "发起中…" : "开始匹配 →"}</button>
        </div>
      )}
      {jdJob && <JobJdDialog job={jdJob} selected={selected.includes(jdJob.job_id)} onToggle={() => toggleJob(jdJob.job_id)} onClose={() => setJdJob(null)} />}
    </main>
  );
}
