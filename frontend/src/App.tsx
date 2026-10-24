import { useEffect, useState } from "react";
import { DiagnoseError, diagnose } from "./api/diagnose";
import { Header } from "./components/Header";
import { InputPage } from "./components/InputPage";
import { LoadingPage } from "./components/LoadingPage";
import { ResultPage } from "./components/ResultPage";
import { ScreenPage } from "./components/ScreenPage";
import { ScreenResultPage } from "./components/ScreenResultPage";
import type { AppMode } from "./components/Nav";
import type { DiagnoseResponse, IngestTask } from "./types";

type View =
  | { name: "input" }
  | { name: "report"; data: DiagnoseResponse }
  | { name: "screen" }
  | { name: "screenResult"; taskId: string; jdText: string; ingest: IngestTask };

export default function App() {
  const [mode, setMode] = useState<AppMode>("diagnose");
  const [view, setView] = useState<View>({ name: "input" });

  // 文本诊断：输入内容提到 App 层，请求失败或重试时用户已经粘好的文本不会丢
  const [resume, setResume] = useState("");
  const [jd, setJd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 切换页面时回到顶部
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view.name, loading]);

  async function runDiagnose() {
    setLoading(true);
    setError(null);
    try {
      const data = await diagnose({
        resume_text: resume.trim(),
        jd_text: jd.trim(),
      });
      setView({ name: "report", data });
    } catch (err) {
      setError(err instanceof DiagnoseError ? err.message : "诊断失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  /** 切换业务入口时回到各自的初始页 */
  function handleModeChange(next: AppMode) {
    if (next === mode) return;
    setMode(next);
    setError(null);
    setView(next === "diagnose" ? { name: "input" } : { name: "screen" });
  }

  function handleStartMatch(taskId: string, ingest: IngestTask, jdText: string) {
    setView({ name: "screenResult", taskId, jdText, ingest });
  }

  function renderView() {
    if (loading) return <LoadingPage />;

    switch (view.name) {
      case "input":
        return (
          <InputPage
            resume={resume}
            jd={jd}
            onResumeChange={setResume}
            onJdChange={setJd}
            loading={loading}
            error={error}
            onSubmit={runDiagnose}
            onRetry={runDiagnose}
          />
        );
      case "report":
        return (
          <ResultPage
            data={view.data}
            onReset={() => {
              setError(null);
              setView({ name: "input" });
            }}
          />
        );
      case "screen":
        return <ScreenPage onStartMatch={handleStartMatch} />;
      case "screenResult":
        return (
          <ScreenResultPage
            taskId={view.taskId}
            jdText={view.jdText}
            ingest={view.ingest}
            onReset={() => setView({ name: "screen" })}
          />
        );
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header mode={mode} onModeChange={handleModeChange} />

      <div className="flex-1">{renderView()}</div>

      <footer className="border-t border-surface-line bg-white/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-6 py-5 text-[11px] text-ink-500 sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 简历诊断 · 保留所有权利</span>
          <span>简历与岗位匹配分析工具</span>
        </div>
      </footer>
    </div>
  );
}
