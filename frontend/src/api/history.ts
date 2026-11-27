import { request } from "./http";
import type { StoredJobMatch } from "../lib/jobMatchStorage";

export type HistoryKind = "job_match" | "resume" | "interview";
export type HistoryFilter = "all" | HistoryKind;

export interface HistoryEntry {
  id: string;
  kind: HistoryKind;
  status: string;
  created_at: string;
  updated_at: string;
  title: string;
  resume_id: string | null;
  resume_name: string | null;
  resume_status: string | null;
  job_ids: string[];
  mode: "manual" | "recommend" | null;
  ingest_task_id: string | null;
  round: number | null;
  max_rounds: number | null;
}

export interface HistoryList {
  items: HistoryEntry[];
  total: number;
  page: number;
  page_size: number;
}

interface HistoryFeedback {
  strengths: string[];
  improvements: string[];
  reference_points: string[];
}

export interface HistoryDetail {
  entry: HistoryEntry;
  match?: Omit<StoredJobMatch, "version">;
  resume?: { resume_id: string; name: string; status: string; text: string; chars: number };
  interview?: {
    resume_id: string;
    resume_name: string;
    jd_text: string;
    status: string;
    round: number;
    max_rounds: number;
    expired: boolean;
    turns: { question: { text: string }; answer: string; feedback: HistoryFeedback }[];
    question: { text: string } | null;
  };
}

export function listHistory(kind: HistoryFilter, page: number, signal?: AbortSignal) {
  const query = new URLSearchParams({ kind, page: String(page), page_size: "20" });
  return request<HistoryList>(`/api/history?${query}`, { signal });
}

export function getHistoryDetail(entry: Pick<HistoryEntry, "id" | "kind">, signal?: AbortSignal) {
  return request<HistoryDetail>(`/api/history/${entry.kind}/${encodeURIComponent(entry.id)}`, { signal });
}
