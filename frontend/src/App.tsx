import { useEffect, useState } from "react";
import { DiagnoseError, diagnose } from "./api/diagnose";
import { Header } from "./components/Header";
import { InputPage } from "./components/InputPage";
import { LoadingPage } from "./components/LoadingPage";
import { ResultPage } from "./components/ResultPage";
import type { DiagnoseResponse } from "./types";

type View = { name: "input" } | { name: "result"; data: DiagnoseResponse };

export default function App() {
  const [view, setView] = useState<View>({ name: "input" });
  // 输入内容提到 App 层：请求失败或重试时，用户已经粘好的文本不会丢
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
      setView({ name: "result", data });
    } catch (err) {
      setError(err instanceof DiagnoseError ? err.message : "诊断失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setError(null);
    setView({ name: "input" });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <div className="flex-1">
        {loading ? (
          <LoadingPage />
        ) : view.name === "input" ? (
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
        ) : (
          <ResultPage data={view.data} onReset={handleReset} />
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
