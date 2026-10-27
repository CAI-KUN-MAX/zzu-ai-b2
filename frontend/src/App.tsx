import { useCallback, useEffect, useRef, useState } from "react";
import { Header } from "./components/Header";
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
type View = { name: "job" } | ({ name: "jobResult" } & StoredJobMatch);

/** 结果页挂在 #result 上：刷新能恢复，手机返回手势能回到选岗页 */
const RESULT_HASH = "#result";

function initialView(last: StoredJobMatch | null): View {
  if (window.location.hash === RESULT_HASH && last) return { name: "jobResult", ...last };
  return { name: "job" };
}

function clearHash() {
  if (window.location.hash) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

export default function App() {
  const [lastMatch, setLastMatch] = useState<StoredJobMatch | null>(() => loadLastMatch());
  const [view, setView] = useState<View>(() => initialView(lastMatch));
  // 草稿只在切页时读一次，用 ref 存避免每次勾选都让 App 重渲染
  const draftRef = useRef<JobMatchDraft>({ ...loadDraft(), files: [] });

  // 切换页面时回到顶部
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view.name]);

  // 刷新时 #result 但已没有可恢复的任务，去掉无效的 hash
  useEffect(() => {
    if (view.name === "job" && window.location.hash === RESULT_HASH) clearHash();
    // 只在首次挂载时检查
  }, []);

  // 浏览器返回（含手机返回手势）离开 #result 时回到选岗页
  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash !== RESULT_HASH) setView({ name: "job" });
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const handleDraftChange = useCallback((draft: JobMatchDraft) => {
    draftRef.current = draft;
    saveDraft({ resumeTaskId: draft.resumeTaskId, selected: draft.selected });
  }, []);

  function openResult(match: StoredJobMatch) {
    setLastMatch(match);
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
    openResult({ taskId, resumeId, resumeName, resumeStatus, jobIds, jobIndex: picked, savedAt: Date.now() });
  }

  function handleReset() {
    clearHash();
    setView({ name: "job" });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <div className="flex-1">
        {view.name === "job" ? (
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

      <footer className="border-t border-surface-line bg-white/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-6 py-5 text-[11px] text-ink-500 sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 简历诊断 · 保留所有权利</span>
          <span>简历与岗位匹配分析工具</span>
        </div>
      </footer>
    </div>
  );
}
