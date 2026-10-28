import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 浏览器原生语音识别（Web Speech API）封装。
 *
 * 设计约束：
 * - 只在用户点击时启动，不上传原始音频（识别由浏览器自身的语音服务完成）
 * - 识别结果只作为文本回调出去，是否写入输入框、是否提交由调用方决定
 * - 状态必须可区分：不支持 / 启动中 / 识别中 / 主动停止 / 权限拒绝 / 网络失败 /
 *   服务异常 / 未检测到语音 / 未成功启动，任何一种都不能静默回到空闲
 * - 该能力依赖浏览器实现，Chrome/Edge 较稳，部分浏览器与国内网络环境不可用，不作为全平台保证
 */

export type SpeechStatus =
  | "unsupported"
  | "idle"
  | "starting"
  | "listening"
  | "stopped"
  | "denied"
  | "network"
  | "service"
  | "no-speech"
  | "failed";

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

/** 从 start 到 onend 短于这个时长且从未 onstart，判定为「没真正启动起来」 */
const START_FAIL_WINDOW_MS = 2000;

/** 每种状态给一句可执行的说明，页面直接展示 */
export const SPEECH_HINT: Record<SpeechStatus, string | null> = {
  unsupported: "当前浏览器不支持浏览器语音识别，请直接打字作答。",
  idle: null,
  starting: "正在请求麦克风权限，请在浏览器弹窗中选择「允许」。",
  listening: "正在识别，说话即可。",
  stopped: "已停止识别，可以继续编辑文字或重新开始。",
  denied: "麦克风权限被拒绝。请在地址栏的权限设置里允许麦克风后重试，或直接打字。",
  network: "连不上浏览器的语音识别服务（部分网络环境下 Chrome 不可用），请检查网络或直接打字。",
  service: "语音服务不可用，可能是浏览器或系统限制了该能力，请改用文字输入。",
  "no-speech": "没有听到语音，请靠近麦克风再说一次，或直接打字。",
  failed: "语音识别没有成功启动，请重试或改用文字输入。",
};

interface UseSpeechOptions {
  /** 每识别出一段最终文本就回调一次，由调用方决定追加到哪个输入框 */
  onFinal: (text: string) => void;
  lang?: string;
}

export function useSpeechRecognition({ onFinal, lang = "zh-CN" }: UseSpeechOptions) {
  const [supported] = useState(() => getRecognitionCtor() !== null);
  const [status, setStatus] = useState<SpeechStatus>(supported ? "idle" : "unsupported");
  const [interim, setInterim] = useState("");
  // 最近一次失败原因，直到下次启动才清空，避免状态一复位用户就看不到为什么失败
  const [lastError, setLastError] = useState<string | null>(null);

  const recognitionRef = useRef<RecognitionLike | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  // 同步闸门：setState 是异步的，连续点击时 status 还是旧值，会启动多个识别实例
  const busyRef = useRef(false);
  const userStoppedRef = useRef(false);
  const gotStartRef = useRef(false);
  const startedAtRef = useRef(0);

  const fail = useCallback((next: SpeechStatus, message: string | null) => {
    setStatus(next);
    setLastError(message ?? SPEECH_HINT[next]);
  }, []);

  const stop = useCallback(() => {
    userStoppedRef.current = true;
    const recognition = recognitionRef.current;
    if (!recognition) {
      busyRef.current = false;
      setInterim("");
      setStatus((prev) => (prev === "starting" || prev === "listening" ? "stopped" : prev));
      return;
    }
    try {
      recognition.stop();
    } catch {
      /* 已经停止时忽略 */
    }
    setInterim("");
    setStatus("stopped");
    busyRef.current = false;
  }, []);

  const start = useCallback(() => {
    if (busyRef.current) return;

    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setStatus("unsupported");
      return;
    }

    busyRef.current = true;
    userStoppedRef.current = false;
    gotStartRef.current = false;
    startedAtRef.current = Date.now();

    setLastError(null);
    setInterim("");
    setStatus("starting");

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      gotStartRef.current = true;
      setStatus("listening");
    };

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
      busyRef.current = false;
      recognitionRef.current = null;

      if (code === "not-allowed" || code === "service-not-allowed") {
        fail("denied", SPEECH_HINT.denied);
      } else if (code === "audio-capture") {
        fail("service", "没有检测到麦克风设备，请检查系统麦克风后重试，或直接打字。");
      } else if (code === "network") {
        fail("network", SPEECH_HINT.network);
      } else if (code === "no-speech") {
        fail("no-speech", SPEECH_HINT["no-speech"]);
      } else if (code === "aborted") {
        // 主动 abort（换题、卸载）不算错误
        setStatus(userStoppedRef.current ? "stopped" : "idle");
      } else {
        fail("service", SPEECH_HINT.service);
      }
    };

    recognition.onend = () => {
      setInterim("");
      recognitionRef.current = null;
      busyRef.current = false;

      // 关键：点了却没真正启动（没收到 onstart 就结束），不能静默回到空闲
      if (!gotStartRef.current && !userStoppedRef.current) {
        const elapsed = Date.now() - startedAtRef.current;
        if (elapsed < START_FAIL_WINDOW_MS) {
          fail(
            "failed",
            "语音识别没有成功启动：可能是浏览器拦截了麦克风、页面不在安全上下文（需 HTTPS），或语音服务不可用。请重试或改用文字输入。"
          );
          return;
        }
        fail("failed", SPEECH_HINT.failed);
        return;
      }

      setStatus((prev) => {
        if (prev === "denied" || prev === "network" || prev === "service" || prev === "no-speech" || prev === "failed") {
          return prev;
        }
        return userStoppedRef.current ? "stopped" : "stopped";
      });
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      busyRef.current = false;
      recognitionRef.current = null;
      fail("failed", "无法启动语音识别，请改用文字输入。");
    }
  }, [lang, fail]);

  const toggle = useCallback(() => {
    if (status === "starting" || status === "listening") stop();
    else start();
  }, [status, start, stop]);

  /** 清掉错误提示，回到可再次启动的初始态（页面上的「改用文字输入」用） */
  const reset = useCallback(() => {
    setLastError(null);
    setInterim("");
    setStatus((prev) => (prev === "unsupported" ? prev : "idle"));
  }, []);

  // 卸载时确保关掉麦克风
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        /* 忽略 */
      }
      recognitionRef.current = null;
      busyRef.current = false;
    };
  }, []);

  const failed =
    status === "denied" ||
    status === "network" ||
    status === "service" ||
    status === "no-speech" ||
    status === "failed";

  return {
    supported,
    status,
    listening: status === "starting" || status === "listening",
    /** 是否有失败态（页面据此显示重试 / 改用文字输入） */
    failed,
    interim,
    lastError,
    hint: SPEECH_HINT[status],
    start,
    stop,
    toggle,
    reset,
  };
}
