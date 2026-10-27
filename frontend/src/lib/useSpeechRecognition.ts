import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 浏览器原生语音识别（Web Speech API）封装。
 * - 只在用户点击时启动，不上传原始音频（识别由浏览器自身的语音服务完成）
 * - 识别结果只作为文本回调出去，是否写入输入框、是否提交由调用方决定
 * - 不支持时明确告知，保留手动输入
 */

export type SpeechStatus = "idle" | "starting" | "listening" | "denied" | "error" | "unsupported";

interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } } & ArrayLike<{ transcript: string }>>;
}

interface SpeechErrorEvent {
  error: string;
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface UseSpeechOptions {
  /** 每识别出一段最终文本就回调一次，由调用方决定追加到哪个输入框 */
  onFinal: (text: string) => void;
  lang?: string;
}

export function useSpeechRecognition({ onFinal, lang = "zh-CN" }: UseSpeechOptions) {
  const [supported] = useState(() => getRecognitionCtor() !== null);
  const [status, setStatus] = useState<SpeechStatus>(supported ? "idle" : "unsupported");
  const [interim, setInterim] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const recognitionRef = useRef<RecognitionLike | null>(null);
  // 用 ref 存回调，避免每次渲染都重建识别实例
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      /* 已经停止时忽略 */
    }
    setInterim("");
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setStatus("unsupported");
      return;
    }

    setErrorMessage(null);
    setInterim("");
    setStatus("starting");

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setStatus("listening");

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) finalText += text;
        else interimText += text;
      }

      setInterim(interimText);
      const trimmed = finalText.trim();
      if (trimmed) onFinalRef.current(trimmed);
    };

    recognition.onerror = (event) => {
      const code = event.error;
      if (code === "not-allowed" || code === "service-not-allowed") {
        setStatus("denied");
        setErrorMessage("麦克风权限被拒绝，请在浏览器地址栏允许麦克风后重试");
      } else if (code === "no-speech") {
        setStatus("error");
        setErrorMessage("没有听到语音，请靠近麦克风再试一次");
      } else if (code === "network") {
        setStatus("error");
        setErrorMessage("语音识别服务连接失败，请检查网络或直接打字");
      } else if (code === "aborted") {
        setStatus("idle");
      } else {
        setStatus("error");
        setErrorMessage("语音识别失败，请重试或直接打字");
      }
    };

    recognition.onend = () => {
      setInterim("");
      // 用户主动停止时保持 idle；出错时保留错误态
      setStatus((prev) => (prev === "listening" || prev === "starting" ? "idle" : prev));
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setStatus("error");
      setErrorMessage("无法启动语音识别，请直接打字");
      recognitionRef.current = null;
    }
  }, [lang]);

  const toggle = useCallback(() => {
    if (status === "listening" || status === "starting") stop();
    else start();
  }, [status, start, stop]);

  // 卸载时确保关掉麦克风
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        /* 忽略 */
      }
      recognitionRef.current = null;
    };
  }, []);

  return {
    supported,
    status,
    listening: status === "listening" || status === "starting",
    interim,
    errorMessage,
    start,
    stop,
    toggle,
  };
}
