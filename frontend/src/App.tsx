import { useEffect, useState } from "react";
import { Header } from "./components/Header";
import { JobMatchPage } from "./components/JobMatchPage";
import { JobResultPage } from "./components/JobResultPage";
import type { Job, ResumeStatus } from "./types";

/**
 * 主导航收敛为「岗位匹配」一条链路：上传简历 → 选岗位 → 排序结果 → 详情（诊断 + 面试）。
 * 文本诊断与简历筛选的页面文件仍在仓库里，只是不再作为主导航入口。
 */
type View =
  | { name: "job" }
  | {
      name: "jobResult";
      taskId: string;
      resumeId: string;
      resumeName: string;
      resumeStatus: ResumeStatus;
      jobIndex: Record<string, Job>;
    };

export default function App() {
  const [view, setView] = useState<View>({ name: "job" });

  // 切换页面时回到顶部
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view.name]);

  function handleStartJobMatch(
    taskId: string,
    resumeId: string,
    resumeName: string,
    resumeStatus: ResumeStatus,
    jobIndex: Record<string, Job>
  ) {
    setView({ name: "jobResult", taskId, resumeId, resumeName, resumeStatus, jobIndex });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <div className="flex-1">
        {view.name === "job" ? (
          <JobMatchPage onStartMatch={handleStartJobMatch} />
        ) : (
          <JobResultPage
            taskId={view.taskId}
            resumeId={view.resumeId}
            resumeName={view.resumeName}
            resumeStatus={view.resumeStatus}
            jobIndex={view.jobIndex}
            onReset={() => setView({ name: "job" })}
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
