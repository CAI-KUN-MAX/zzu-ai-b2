import { useCallback, useEffect, useRef, useState } from "react";
import { IS_MOCK_MODE } from "./api/http";
import { listJobs } from "./api/jobs";
import { JobMatchPage, type JobMatchDraft } from "./components/JobMatchPage";
import { JobResultPage } from "./components/JobResultPage";
import {
  type StoredJobMatch,
  loadDraft,
  loadLastMatch,
  saveDraft,
  saveLastMatch,
} from "./lib/jobMatchStorage";
import type { Job, ResumeStatus } from "./types";

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

function clearHash() {
  if (window.location.hash) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

export default function App() {
  const [lastMatch, setLastMatch] = useState<MatchRecord | null>(() => loadLastMatch());
  const [view, setView] = useState<View>(() => initialView(lastMatch));
  const [homeJobs, setHomeJobs] = useState<Job[]>([]);
  // 草稿只在切页时读一次，用 ref 存避免每次勾选都让 App 重渲染
  const draftRef = useRef<JobMatchDraft>({ ...loadDraft(), files: [] });
  // hashchange 回调里要读最新的可恢复记录，不能依赖闭包里的初始值
  const lastMatchRef = useRef<MatchRecord | null>(lastMatch);
  lastMatchRef.current = lastMatch;

  // 切换页面时回到顶部
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view.name]);

  useEffect(() => {
    let cancelled = false;
    listJobs({ page: 1, page_size: 4 }).then((data) => {
      if (!cancelled) setHomeJobs(data.items);
    }).catch(() => {
      if (!cancelled) setHomeJobs([]);
    });
    return () => { cancelled = true; };
  }, []);

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

  function openResult(match: MatchRecord) {
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

  function handleReset() {
    clearHash();
    setView({ name: "job" });
  }

  return (
    <div className="offer-page">
      <div className="offer-shell">
        <aside className="offer-sidebar">
          <button className="offer-brand" type="button" onClick={() => { clearHash(); setView({ name: "home" }); }} aria-label="Offer 首页">
            <span className="offer-logo">✳</span><span>Offer<small>你的求职搭子</small></span>
          </button>
          <nav className="offer-nav" aria-label="主导航">
            <button className={view.name === "home" ? "active" : ""} onClick={() => { clearHash(); setView({ name: "home" }); }}><span>⌂</span>首页</button>
            <button className={view.name === "job" ? "active" : ""} onClick={() => { clearHash(); setView({ name: "job" }); }}><span>▦</span>选择岗位</button>
            <button className={view.name === "jobResult" ? "active" : ""} onClick={() => lastMatch && openResult(lastMatch)} disabled={!lastMatch}><span>◉</span>匹配结果</button>
            <button onClick={() => lastMatch && openResult(lastMatch)} disabled={!lastMatch} title={lastMatch ? "先选择结果中的岗位开始面试" : "完成匹配后开始面试"}><span>♬</span>模拟面试</button>
            <button className={view.name === "records" ? "active" : ""} onClick={() => { clearHash(); setView({ name: "records" }); }}><span>▤</span>记录</button>
          </nav>
          <div className="offer-sidebar-note">从一份简历开始，<br />找到适合你的下一步。</div>
        </aside>
        <div className="offer-content">
          <header className="offer-topbar"><span>简历与岗位匹配</span><span>{IS_MOCK_MODE ? "演示数据" : "你的求职空间"}</span></header>
          {view.name === "home" ? (
            <main className="offer-dashboard">
              <section className="dashboard-panel dashboard-main"><span className="offer-eyebrow">YOUR CAREER, YOUR WAY</span><h1>今天想投什么岗位？</h1>
                <div className="dashboard-resume"><span className="picker-logo">▤</span><span><strong>{lastMatch?.resumeName || "先上传一份简历"}</strong><small>{lastMatch ? "继续使用最近一次匹配的简历，或上传新简历" : "支持 PDF、DOCX、PNG 和 JPG"}</small></span><button onClick={() => setView({ name: "job" })}>{lastMatch ? "更换" : "去上传"} →</button></div>
                <p className="dashboard-copy">选择感兴趣的岗位，看看简历与岗位要求的契合点，也可以针对岗位练习面试。</p>
                {lastMatch && <button className="dashboard-last" onClick={() => openResult(lastMatch)}>上次匹配 · {lastMatch.jobIds.length} 个岗位 <span>查看结果 →</span></button>}
                <button className="offer-primary" onClick={() => setView({ name: "job" })}>挑选岗位 <span>→</span></button>
              </section>
              <section className="dashboard-panel"><span className="offer-eyebrow">YOUR OPPORTUNITIES</span><h2>近期截止</h2><p className="dashboard-copy">目前没有经过确认的截止日期，建议前往招聘来源查看最新信息。</p><button className="dashboard-link" onClick={() => setView({ name: "job" })}>浏览岗位 →</button></section>
              <section className="dashboard-panel"><div className="dashboard-heading"><h2>岗位目录</h2><button className="dashboard-link" onClick={() => setView({ name: "job" })}>查看全部 →</button></div>{homeJobs.length ? homeJobs.slice(0,3).map((job) => <button key={job.job_id} className="dashboard-job" onClick={() => setView({ name: "job" })}><span className="picker-logo small">{job.company.slice(0,1)}</span><span><strong>{job.title}</strong><small>{job.company} · {job.cities[0]}</small></span><span>→</span></button>) : <p className="dashboard-copy">岗位目录暂时不可用，请稍后查看。</p>}</section>
              <section className="dashboard-panel"><span className="offer-eyebrow">PRACTICE</span><h2>模拟面试</h2><p className="dashboard-copy">先完成岗位匹配，再针对选中的岗位进行五轮练习。</p><button className="dashboard-link" onClick={() => lastMatch ? openResult(lastMatch) : setView({ name: "job" })}>{lastMatch ? "查看匹配结果 →" : "去选择岗位 →"}</button></section>
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
            onReset={handleReset}
            onRestart={(taskId) => openResult({ ...view, taskId, savedAt: Date.now() })}
          />
        )}
        </div>
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
