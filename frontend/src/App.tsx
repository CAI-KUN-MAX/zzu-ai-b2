import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IS_MOCK_MODE } from "./api/http";
import { useAuth } from "./lib/useAuth";
import { createJobRecommendation, listJobs } from "./api/jobs";
import { DOCUMENT_ACCEPT, IMAGE_ACCEPT, getIngestTask, uploadResumes, validateFiles } from "./api/resumes";
import { JobCarousel } from "./components/JobCarousel";
import { JobJdDialog } from "./components/JobJdDialog";
import { JobMatchPage, type JobMatchDraft } from "./components/JobMatchPage";
import { JobResultPage } from "./components/JobResultPage";
import { AuthDialog } from "./components/AuthDialog";
import { OfferMark } from "./components/icons";
import { useTask } from "./lib/useTask";
import {
  type StoredJobMatch,
  loadDraft,
  loadLastMatch,
  loadLastResume,
  type StoredResume,
  saveDraft,
  saveLastMatch,
  saveLastResume,
} from "./lib/jobMatchStorage";
import type { IngestTask, Job, ResumeStatus } from "./types";

/**
 * 主导航收敛为「岗位匹配」一条链路：上传简历 → 选岗位 → 排序结果 → 详情（诊断 + 面试）。
 * 文本诊断与简历筛选的页面文件仍在仓库里，只是不再作为主导航入口。
 */
type MatchRecord = Omit<StoredJobMatch, "version">;
type View = { name: "home" } | { name: "job" } | { name: "records" } | ({ name: "jobResult" } & MatchRecord);

/** 结果页挂在 #result 上：刷新能恢复，手机返回手势能回到选岗页 */
const RESULT_HASH = "#result";

function initialView(last: MatchRecord | null): View {
  if (window.location.hash === RESULT_HASH && last) return { name: "jobResult", ...last };
  return { name: "home" };
}

/** 随机展示岗位，并优先让不同企业露面。 */
function previewJobs(jobs: Job[], limit: number) {
  const shuffled = [...jobs];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const seen = new Set<string>();
  const first: Job[] = [];
  const rest: Job[] = [];
  shuffled.forEach((job) => {
    if (seen.has(job.company)) {
      rest.push(job);
    } else {
      seen.add(job.company);
      first.push(job);
    }
  });
  return [...first, ...rest].slice(0, limit);
}

function clearHash() {
  if (window.location.hash) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

export default function App() {
  const auth = useAuth();
  const [authDialog, setAuthDialog] = useState<"login" | "register" | null>(null);
  const [authActionError, setAuthActionError] = useState<string | null>(null);
  const [lastMatch, setLastMatch] = useState<MatchRecord | null>(() => loadLastMatch());
  const [view, setView] = useState<View>(() => initialView(lastMatch));
  const [interviewOpen, setInterviewOpen] = useState(false);
  // 从侧栏或浏览器后退离开结果页，面试也算结束；回来时先看到结果
  useEffect(() => {
    if (view.name !== "jobResult") setInterviewOpen(false);
  }, [view.name]);
  const [homeJobs, setHomeJobs] = useState<Job[]>([]);
  const [recentResume, setRecentResume] = useState<StoredResume | null>(() => loadLastResume());
  const [recommending, setRecommending] = useState(false);
  const [recommendError, setRecommendError] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [homeUploading, setHomeUploading] = useState(false);
  const [homeUploadError, setHomeUploadError] = useState<string | null>(null);
  const [homeUploadTask, setHomeUploadTask] = useState<string | null>(null);
  const { data: homeIngest, error: homePollError, polling: homePolling, retry: retryHomeIngest } = useTask<IngestTask>(getIngestTask, homeUploadTask);
  const [homeTotal, setHomeTotal] = useState(0);
  const [homeCategories, setHomeCategories] = useState(0);
  const [homeJdJob, setHomeJdJob] = useState<Job | null>(null);
  // 草稿只在切页时读一次，用 ref 存避免每次勾选都让 App 重渲染
  const draftRef = useRef<JobMatchDraft>({ ...loadDraft(), files: [] });
  // hashchange 回调里要读最新的可恢复记录，不能依赖闭包里的初始值
  const lastMatchRef = useRef<MatchRecord | null>(lastMatch);
  lastMatchRef.current = lastMatch;

  useEffect(() => {
    if (!homeUploadTask || homeIngest?.status !== "succeeded") return;
    const resume = homeIngest.items[0];
    if (!resume || (resume.status !== "ready" && resume.status !== "need_review")) {
      setHomeUploadError(resume?.error?.message || "简历解析未完成，请检查文件后重试");
      return;
    }
    const saved: StoredResume = { resumeId: resume.resume_id, name: resume.name, status: resume.status, savedAt: Date.now() };
    saveLastResume(saved);
    setRecentResume(saved);
    draftRef.current = { ...draftRef.current, resumeTaskId: homeUploadTask, files: [] };
    saveDraft({ resumeTaskId: homeUploadTask, selected: draftRef.current.selected });
  }, [homeIngest, homeUploadTask]);

  async function handleHomeFile(file: File | undefined) {
    if (!file || homeUploading || homePolling) return;
    const validation = validateFiles([file]);
    setHomeUploadError(validation.errors[0] ?? null);
    if (!validation.ok.length) return;
    setHomeUploadTask(null);
    setHomeUploading(true);
    try {
      const { task_id } = await uploadResumes(validation.ok);
      setHomeUploadTask(task_id);
    } catch (err) {
      setHomeUploadError(err instanceof Error ? err.message : "上传失败，请重试");
    } finally {
      setHomeUploading(false);
    }
  }

  // 切换页面时回到顶部
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view.name]);

  useEffect(() => {
    let cancelled = false;
    // 首页统计和岗位速览使用目录中状态为开放的岗位。
    (async () => {
      const collected: Job[] = [];
      let total = 0;
      for (let page = 1; page <= 4; page += 1) {
        const data = await listJobs({ page, page_size: 50 });
        collected.push(...data.items);
        total = data.total;
        if (collected.length >= total) break;
      }
      if (cancelled) return;
      const openJobs = collected.filter((job) => job.application_status === "open");
      setHomeJobs(openJobs);
      setHomeTotal(openJobs.length);
      setHomeCategories(new Set(openJobs.map((job) => job.category)).size);
    })().catch(() => {
      if (!cancelled) {
        setHomeJobs([]);
        setHomeTotal(0);
        setHomeCategories(0);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // 从选岗页传完简历回到首页，要能立刻看到最新那份
  useEffect(() => {
    if (view.name === "home") setRecentResume(loadLastResume());
  }, [view.name]);

  const previewList = useMemo(() => previewJobs(homeJobs, 12), [homeJobs]);

  // 刷新时带着 #result 但已没有可恢复的记录，去掉这个无效 hash
  useEffect(() => {
    if (view.name !== "jobResult" && window.location.hash === RESULT_HASH) clearHash();
    // 只在首次挂载时检查
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 浏览器前进/后退（含手机返回手势）。
   * 之前只处理了「离开 #result」，所以 Back 再 Forward 时 URL 回到 #result
   * 但页面还停在选岗页 —— 这里两个方向都要处理。
   */
  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash === RESULT_HASH) {
        const match = lastMatchRef.current;
        if (match) {
          setView({ name: "jobResult", ...match });
        } else {
          // 没有可信记录就不进结果页，顺手清掉 hash，避免停在空页
          clearHash();
          setView({ name: "job" });
        }
        return;
      }
      setView({ name: "home" });
    };

    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onHashChange);
    };
  }, []);

  const handleDraftChange = useCallback((draft: JobMatchDraft) => {
    draftRef.current = draft;
    saveDraft({ resumeTaskId: draft.resumeTaskId, selected: draft.selected });
  }, []);

  /** 首页岗位详情里勾选：写进选岗草稿，到选岗页时已经是选中状态 */
  function toggleHomeJob(jobId: string) {
    const { selected } = draftRef.current;
    handleDraftChange({
      ...draftRef.current,
      selected: selected.includes(jobId) ? selected.filter((id) => id !== jobId) : [...selected, jobId],
    });
  }

  function openResult(match: MatchRecord) {
    setInterviewOpen(false);
    setLastMatch(match);
    lastMatchRef.current = match;
    saveLastMatch(match);
    setView({ name: "jobResult", ...match });
    if (window.location.hash !== RESULT_HASH) window.location.hash = RESULT_HASH;
  }

  function handleStartJobMatch(
    taskId: string,
    resumeId: string,
    resumeName: string,
    resumeStatus: ResumeStatus,
    jobIndex: Record<string, Job>,
    jobIds: string[]
  ) {
    const picked = Object.fromEntries(
      jobIds.filter((id) => jobIndex[id]).map((id) => [id, jobIndex[id]])
    ) as Record<string, Job>;
    openResult({
      taskId,
      resumeId,
      resumeName,
      resumeStatus,
      jobIds,
      jobIndex: picked,
      savedAt: Date.now(),
    });
  }

  /**
   * 一键推荐：由后端从目录中筛选并排序。
   * 分数、排序、匹配理由全部来自后端，前端不生成任何分数。
   */
  async function handleRecommend() {
    if (recommending) return;
    if (!recentResume) {
      setRecommendError("还没有可用的简历，请先上传并等解析完成");
      return;
    }
    setRecommendError(null);
    setRecommending(true);
    try {
      const { task_id } = await createJobRecommendation(recentResume.resumeId);
      openResult({
        taskId: task_id,
        resumeId: recentResume.resumeId,
        resumeName: recentResume.name,
        resumeStatus: recentResume.status ?? "need_review",
        jobIds: [],
        jobIndex: {},
        savedAt: Date.now(),
        mode: "recommend",
      });
    } catch (err) {
      setRecommendError(err instanceof Error ? err.message : "推荐失败，请稍后重试");
    } finally {
      setRecommending(false);
    }
  }

  /** 身份变了就整页重载：内存里的简历、匹配、会话都要按新身份重来 */
  async function handleLogout() {
    if (authActionError) setAuthActionError(null);
    try {
      await auth.logout();
      window.location.reload();
    } catch (err) {
      setAuthActionError(err instanceof Error ? err.message : "退出失败，请稍后再试");
    }
  }

  function handleReset() {
    clearHash();
    setView({ name: "job" });
  }

  return (
    <div className="offer-page">
      <div className="offer-shell">
        <aside className="offer-sidebar">
          <button className="offer-brand" type="button" onClick={() => { clearHash(); setView({ name: "home" }); }} aria-label="Offer 首页">
            <span className="offer-logo"><OfferMark /></span><span>Offer<small>你的求职搭子</small></span>
          </button>
          <nav className="offer-nav" aria-label="主导航">
            <button className={view.name === "home" ? "active" : ""} onClick={() => { clearHash(); setView({ name: "home" }); }}><span>⌂</span>首页</button>
            <button className={view.name === "job" ? "active" : ""} onClick={() => { clearHash(); setView({ name: "job" }); }}><span>▦</span>选择岗位</button>
            <button className={view.name === "jobResult" && !interviewOpen ? "active" : ""} onClick={() => lastMatch && openResult(lastMatch)} disabled={!lastMatch}><span>◉</span>匹配结果</button>
            <button className={view.name === "jobResult" && interviewOpen ? "active" : ""} onClick={() => lastMatch && !(view.name === "jobResult" && interviewOpen) && openResult(lastMatch)} disabled={!lastMatch} title={lastMatch ? "先选择结果中的岗位开始面试" : "完成匹配后开始面试"}><span>♬</span>模拟面试</button>
            <button className={view.name === "records" ? "active" : ""} onClick={() => { clearHash(); setView({ name: "records" }); }}><span>▤</span>记录</button>
          </nav>
          <div className="offer-sidebar-note">从一份简历开始，<br />找到适合你的下一步。</div>
          <div className="offer-account">
            {auth.status === "loading" ? (
              <p className="offer-account-note">正在确认登录状态…</p>
            ) : auth.status === "error" ? (
              <button type="button" className="offer-account-btn" onClick={() => void auth.refresh()}>
                身份确认失败，点此重试
              </button>
            ) : auth.status === "authenticated" && auth.user ? (
              <>
                <div className="offer-account-user">
                  <span className="picker-logo small">{auth.user.username.slice(0, 1).toUpperCase()}</span>
                  <strong title={auth.user.username}>{auth.user.username}</strong>
                  <button type="button" onClick={() => void handleLogout()}>退出</button>
                </div>
                <p className="offer-account-note">当前记录的简历与结果只属于这个账号</p>
              </>
            ) : auth.unavailable ? (
              <>
                <button type="button" className="offer-account-btn" onClick={() => setAuthDialog("login")}>
                  登录 / 注册（即将开放）
                </button>
                <p className="offer-account-note">账号服务还没上线，可以先以游客身份使用</p>
              </>
            ) : (
              <>
                <button type="button" className="offer-account-btn" onClick={() => setAuthDialog("login")}>
                  登录 / 注册 →
                </button>
                <p className="offer-account-note">游客也能用，登录后可单独保存自己的记录</p>
              </>
            )}
            {authActionError ? <p className="auth-error">{authActionError}</p> : null}
          </div>
        </aside>
        <div className="offer-content">
          <header className="offer-topbar">
            <span>简历与岗位匹配</span>
            <span className="offer-topbar-desktop">{IS_MOCK_MODE ? "演示数据" : "你的求职空间"}</span>
            <div className="offer-mobile-account">
              {auth.status === "loading" ? <span>确认身份中…</span> : auth.status === "error" ? (
                <button type="button" onClick={() => void auth.refresh()}>身份确认失败，重试</button>
              ) : auth.status === "authenticated" && auth.user ? (
                <><span>{auth.user.username}</span><button type="button" onClick={() => void handleLogout()}>退出</button></>
              ) : <button type="button" onClick={() => setAuthDialog("login")}>登录 / 注册</button>}
              {authActionError ? <span role="alert">{authActionError}</span> : null}
            </div>
          </header>
          {view.name === "home" ? (
            <main className="offer-dashboard">
              <section className="dashboard-panel dashboard-main">
                <span className="offer-eyebrow">YOUR CAREER, YOUR WAY</span>
                <h1>今天想投什么岗位？</h1>

                <div className="dashboard-resume">
                  <span className="picker-logo">▤</span>
                  <span>
                    <strong>{recentResume?.name || "先上传一份简历"}</strong>
                    <small>
                      {recentResume
                        ? "已解析，可以直接让我按经历推荐岗位"
                        : "支持 PDF、DOCX、PNG 和 JPG"}
                    </small>
                  </span>
                  <button type="button" disabled={homeUploading || homePolling} onClick={() => uploadInputRef.current?.click()}>
                    {recentResume ? "换一份" : "去上传"} →
                  </button>
                  <input ref={uploadInputRef} type="file" hidden accept={`${DOCUMENT_ACCEPT},${IMAGE_ACCEPT}`} onChange={(event) => { void handleHomeFile(event.target.files?.[0]); event.target.value = ""; }} />
                </div>
                {homeUploading || homePolling ? <p className="dashboard-hint" role="status">正在上传并解析简历，请稍候…</p> : null}
                {homeUploadError || homePollError ? <p className="dashboard-error" role="alert">{homeUploadError || homePollError}{homePollError && homeUploadTask ? <button type="button" onClick={retryHomeIngest}>重新获取</button> : null}</p> : null}

                {/* 主操作：一键推荐，不需要先选岗位 */}
                <button
                  type="button"
                  className="offer-primary dashboard-cta"
                  onClick={handleRecommend}
                  disabled={recommending || !recentResume || homeUploading || homePolling}
                >
                  {recommending ? "正在为你挑选岗位…" : "为我推荐岗位"}
                  <span>→</span>
                </button>

                {!recentResume ? (
                  <p className="dashboard-hint">先上传一份简历，才能按你的经历推荐岗位。</p>
                ) : null}

                {recommendError ? (
                  <p className="dashboard-error" role="alert">
                    <span>{recommendError}</span>
                    <button type="button" onClick={handleRecommend}>重试</button>
                  </p>
                ) : null}

                {lastMatch ? (
                  <button className="dashboard-last" onClick={() => openResult(lastMatch)}>
                    上次{lastMatch.mode === "recommend" ? "推荐" : `匹配 · ${lastMatch.jobIds.length} 个岗位`}
                    <span>查看结果 →</span>
                  </button>
                ) : null}

                <div className="dashboard-stats">
                  <span>
                    岗位库共 <b>{homeTotal || "—"}</b> 个开放状态岗位，覆盖 <b>{homeCategories || "—"}</b> 类专业
                  </span>
                  <button type="button" onClick={() => setView({ name: "job" })}>
                    挑选岗位 →
                  </button>
                </div>
              </section>

              <section className="dashboard-panel dashboard-wide" aria-label="岗位速览">
                <div className="dashboard-heading">
                  <h2>岗位速览</h2>
                  <button className="dashboard-link" onClick={() => setView({ name: "job" })}>
                    查看全部 →
                  </button>
                </div>
                {homeJobs.length ? (
                  <JobCarousel jobs={previewList} selectedIds={draftRef.current.selected} onOpen={setHomeJdJob} />
                ) : (
                  <p className="dashboard-copy">岗位目录暂时不可用，请稍后查看。</p>
                )}
              </section>

              <section className="dashboard-panel dashboard-practice" aria-label="今日练习">
                <div>
                  <h2>今日练习</h2>
                  <p className="dashboard-copy">
                    {lastMatch
                      ? "针对上次选中的岗位继续练习五轮模拟面试。"
                      : "先完成岗位匹配，再针对选中的岗位进行五轮练习。"}
                  </p>
                </div>
                <button
                  className="dashboard-link"
                  onClick={() => (lastMatch ? openResult(lastMatch) : setView({ name: "job" }))}
                >
                  {lastMatch ? "继续练习 →" : "去选择岗位 →"}
                </button>
              </section>
            </main>
          ) : view.name === "records" ? (
            <main className="offer-picker"><div className="picker-title"><div><span className="offer-eyebrow">YOUR ACTIVITY</span><h1>记录</h1><p>在当前浏览器继续查看最近一次匹配。</p></div></div><div className="records-grid"><section className="picker-panel"><h2>最近动态</h2>{lastMatch ? <button className="dashboard-job" onClick={() => openResult(lastMatch)}><span className="picker-logo small">▤</span><span><strong>{lastMatch.resumeName}</strong><small>{lastMatch.jobIds.length} 个岗位 · {new Date(lastMatch.savedAt).toLocaleString("zh-CN")}</small></span><span>查看 →</span></button> : <p className="picker-empty">还没有匹配记录，完成匹配后可在这里查看。</p>}</section><section className="picker-panel"><h2>模拟面试记录</h2><p className="picker-hint">当前仅支持在面试过程中查看反馈，暂不提供历史面试记录。</p><h2 className="mt-6">我的简历</h2><p className="picker-hint">{lastMatch ? lastMatch.resumeName : "暂未保存最近匹配的简历。"}</p><button className="dashboard-link" onClick={() => setView({ name: "job" })}>管理本次简历 →</button></section></div></main>
          ) : view.name === "job" ? (
          <JobMatchPage
            onStartMatch={handleStartJobMatch}
            draft={draftRef.current}
            onDraftChange={handleDraftChange}
            lastMatch={
              lastMatch
                ? {
                    resumeName: lastMatch.resumeName,
                    jobCount: lastMatch.jobIds.length,
                    savedAt: lastMatch.savedAt,
                  }
                : null
            }
            onOpenLastMatch={() => lastMatch && openResult(lastMatch)}
          />
        ) : (
          <JobResultPage
            // 重新发起后换了任务，整页重置（详情、计时等不能沿用旧任务）
            key={view.taskId}
            taskId={view.taskId}
            resumeId={view.resumeId}
            resumeName={view.resumeName}
            resumeStatus={view.resumeStatus}
            jobIndex={view.jobIndex}
            jobIds={view.jobIds}
            mode={view.mode}
            onReset={handleReset}
            onRestart={(taskId) => openResult({ ...view, taskId, savedAt: Date.now() })}
            interviewOpen={interviewOpen}
            onInterviewOpenChange={setInterviewOpen}
          />
        )}
        </div>
        {homeJdJob ? (
          <JobJdDialog
            job={homeJdJob}
            selected={draftRef.current.selected.includes(homeJdJob.job_id)}
            onToggle={() => toggleHomeJob(homeJdJob.job_id)}
            onClose={() => setHomeJdJob(null)}
          />
        ) : null}
        {authDialog ? (
          <AuthDialog
            initialMode={authDialog}
            onLogin={auth.login}
            onRegister={auth.register}
            onClose={() => setAuthDialog(null)}
            onSuccess={() => {
              setAuthDialog(null);
              window.location.reload();
            }}
          />
        ) : null}
        <div className="offer-mobile-nav" aria-label="移动导航">
          <button onClick={() => { clearHash(); setView({ name: "home" }); }}>⌂<small>首页</small></button>
          <button onClick={() => { clearHash(); setView({ name: "job" }); }}>▦<small>选岗</small></button>
          <button onClick={() => lastMatch && openResult(lastMatch)} disabled={!lastMatch}>◉<small>结果</small></button>
          <button onClick={() => { clearHash(); setView({ name: "records" }); }}>▤<small>记录</small></button>
        </div>
      </div>
    </div>
  );
}
