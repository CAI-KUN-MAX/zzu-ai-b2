import type { GapSeverity, MatchLevel } from "../types";

export interface LevelTone {
  /** 徽章文字色 + 底色 */
  chip: string;
  /** 环形进度主色（SVG 用） */
  ring: string;
  /** 大数字文字色 */
  text: string;
}

const LEVEL_TONES: Record<MatchLevel, LevelTone> = {
  high: {
    chip: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
    ring: "#10b981",
    text: "text-emerald-600",
  },
  medium: {
    chip: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
    ring: "#f59e0b",
    text: "text-amber-600",
  },
  low: {
    chip: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200",
    ring: "#f43f5e",
    text: "text-rose-600",
  },
};

/** 未知等级统一按 medium 渲染，避免后端新增枚举时白屏 */
export function levelTone(level: string): LevelTone {
  return LEVEL_TONES[level as MatchLevel] ?? LEVEL_TONES.medium;
}

export interface SeverityMeta {
  label: string;
  chip: string;
  dot: string;
  /** 卡片左侧色条 */
  accent: string;
}

const SEVERITY_META: Record<GapSeverity, SeverityMeta> = {
  high: {
    label: "高优先级",
    chip: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200",
    dot: "bg-rose-500",
    accent: "border-l-rose-400",
  },
  medium: {
    label: "中优先级",
    chip: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
    dot: "bg-amber-500",
    accent: "border-l-amber-400",
  },
  low: {
    label: "低优先级",
    chip: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200",
    dot: "bg-sky-500",
    accent: "border-l-sky-400",
  },
};

export function severityMeta(severity: string): SeverityMeta {
  return SEVERITY_META[severity as GapSeverity] ?? SEVERITY_META.medium;
}

/** 维度进度条配色：80 分以上绿、60 以上琥珀、其余红 */
export function scoreTone(score: number): { bar: string; text: string } {
  if (score >= 80) return { bar: "bg-emerald-500", text: "text-emerald-600" };
  if (score >= 60) return { bar: "bg-amber-500", text: "text-amber-600" };
  return { bar: "bg-rose-500", text: "text-rose-600" };
}
