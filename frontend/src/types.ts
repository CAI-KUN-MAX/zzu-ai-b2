/**
 * 接口契约类型（与后端 /api/diagnose 返回结构一一对应）
 * 结构已冻结，字段名不要随意改动；如需扩展请与后端同步后再改这里。
 */

/** 请求体：POST /api/diagnose（字段名与后端 backend/app/schemas.py 保持一致） */
export interface DiagnoseRequest {
  /** 简历全文（纯文本） */
  resume_text: string;
  /** 岗位 JD 全文（纯文本） */
  jd_text: string;
  /** 可选分析参数，不传时由后端使用默认值 */
  options?: DiagnoseOptions;
}

export interface DiagnoseOptions {
  language?: string;
  include_suggestions?: boolean;
}

/** 整体匹配等级 */
export type MatchLevel = "high" | "medium" | "low";

/** 缺口严重程度 */
export type GapSeverity = "high" | "medium" | "low";

/** 单一维度的得分 */
export interface DimensionScore {
  /** 维度标识，用于前端映射图标/排序，如 skill_match */
  key: string;
  /** 维度中文名，直接展示 */
  label: string;
  /** 该维度得分，0-100 */
  score: number;
  /** 该维度在总分中的权重，0-1，四项权重之和为 1 */
  weight: number;
}

/** 亮点条目 */
export interface Highlight {
  title: string;
  /** 支撑该亮点的原文证据 */
  evidence: string;
  /** 证据来源：resume / jd */
  source: string;
}

/** 缺口条目 */
export interface Gap {
  title: string;
  /** JD 中的对应要求 */
  jd_requirement: string;
  /** 简历中的现有证据（后端 Optional，可能为 null） */
  resume_evidence: string | null;
  /** 改进建议 */
  suggestion: string;
  severity: GapSeverity;
}

/** 调用元信息，便于排查线上问题 */
export interface DiagnoseMeta {
  model: string;
  /** mock / real */
  mode: string;
  elapsed_ms: number;
}

/** 响应体 */
export interface DiagnoseResponse {
  request_id: string;
  /** 总分，0-100 */
  overall_score: number;
  level: MatchLevel;
  /** 等级中文标签，如「强匹配」，直接展示，前端不再自造文案 */
  level_label: string;
  dimension_scores: DimensionScore[];
  highlights: Highlight[];
  gaps: Gap[];
  /** 一句话总结 */
  summary: string;
  /** 免责声明，由后端下发，前端原样展示 */
  disclaimer: string;
  meta: DiagnoseMeta;
}

/**
 * 错误体。后端同时存在三种形态，前端统一兼容：
 * 1. FastAPI HTTPException 默认：{ "detail": "简历或JD文本不能为空" }
 * 2. 422 参数校验失败：{ "detail": [ { "loc": [...], "msg": "..." } ] }
 * 3. 契约预留：{ "error": { "code", "message", "request_id" } }
 */
export interface ApiErrorBody {
  detail?: string | Array<Record<string, unknown>>;
  error?: {
    code: string | number;
    message: string;
    request_id?: string;
  };
  code?: string | number;
  message?: string;
}

/* ------------------------------------------------------------------ *
 * 简历筛选（OCR 解析 + 匹配排序）—— 与后端统一契约，不要单独改字段
 * ------------------------------------------------------------------ */

/** 异步任务状态 */
export type TaskStatus = "queued" | "running" | "succeeded" | "failed";

/** 单份简历的解析状态 */
export type ResumeStatus = "ready" | "need_review" | "failed";

/** 解析批次的单条结果 */
export interface IngestItem {
  resume_id: string;
  name: string;
  chars: number;
  status: ResumeStatus;
  /** 正文预览，用于列表展示 */
  preview: string;
  /** 单份解析失败原因；与任务级 error 不同，这里是对象 */
  error?: { code: string; message: string } | null;
  /** OCR 低置信度行数，大于 0 时状态为 need_review */
  low_conf?: number;
}

/** GET /api/tasks/{task_id} */
export interface IngestTask {
  status: TaskStatus;
  /** 面向用户的阶段文案，如「解析 3/8」 */
  stage: string;
  /** 0-100 */
  progress: number;
  /** 可直接展示的中文错误，正常时为 null */
  error: string | null;
  /** 额外错误码，如 OCR_UNAVAILABLE / TASK_INTERRUPTED */
  error_code?: string | null;
  /** 解析中的项目暂不返回，只包含 ready / need_review / failed */
  items: IngestItem[];
}

/** GET /api/resumes/{resume_id}/text */
export interface ResumeText {
  resume_id: string;
  name: string;
  chars: number;
  text: string;
}

export interface MatchSubScore {
  key: string;
  label: string;
  score: number;
  weight: number;
}

/** 匹配结果中的单份简历 */
export interface MatchItem {
  resume_id: string;
  name: string;
  /** 最终分：AI 完成时为 0.35×基础分 + 0.65×AI 分，降级时等于基础分 */
  score: number;
  /** 基础评分（技能关键词 55% + 文本相似度 30% + 学历 15%） */
  stage1_score?: number;
  level: MatchLevel;
  level_label: string;
  /** 基础评分的三个分项，与 report.dimension_scores 的 AI 四维度不是一回事 */
  subscores: MatchSubScore[];
  matched: string[];
  missing: string[];
  reason: string | null;
  /** true 表示只做了轻量打分，没有 AI 深度分析，此时 report 不存在 */
  degraded: boolean;
  /** 与 /api/diagnose 响应结构完全一致，degraded 时为 undefined */
  report?: DiagnoseResponse;
}

/** GET /api/match/{task_id} */
export interface MatchTask {
  status: TaskStatus;
  stage: string;
  progress: number;
  error: string | null;
  error_code?: string | null;
  items: MatchItem[];
}

/* ------------------------------------------------------------------ *
 * 单人模拟面试（最多三轮）—— 契约见 2026-10-25 任务单
 * ------------------------------------------------------------------ */

export type InterviewStatus = "active" | "completed";

export interface InterviewQuestion {
  id: string;
  text: string;
  /** 这道题考察什么，用于展示标签 */
  focus: string;
}

export interface InterviewFeedback {
  /** 回答中实际体现的优点 */
  strengths: string[];
  /** 需要补充的具体内容 */
  improvements: string[];
  /** 建议覆盖的要点，不代表候选人已经做过 */
  reference_points: string[];
}

/** POST /api/interviews 响应（HTTP 201），round 为当前题号 */
export interface InterviewSession {
  interview_id: string;
  status: InterviewStatus;
  round: number;
  max_rounds: number;
  question: InterviewQuestion | null;
}

/** POST /api/interviews/{id}/answers 响应（HTTP 200），round 为刚完成的轮次 */
export interface InterviewAnswerResult {
  interview_id: string;
  status: InterviewStatus;
  round: number;
  max_rounds: number;
  feedback: InterviewFeedback;
  /** 第三轮后为 null */
  next_question: InterviewQuestion | null;
}

/* ------------------------------------------------------------------ *
 * 岗位目录与「单简历 × 多岗位」匹配
 * 字段严格对齐 backend/app/job_schemas.py，不要自行加字段
 * ------------------------------------------------------------------ */

export type JobCategory =
  | "计算机"
  | "电子机械"
  | "土木建筑"
  | "化工材料"
  | "生物医药"
  | "经管财会"
  | "文法教育"
  | "外语传播"
  | "艺术设计"
  | "农林环境";

export type JobEducation = "不限" | "专科" | "本科" | "硕士" | "博士";

export type JobApplicationStatus = "open" | "closed" | "unverified";

/** GET /api/jobs 返回的岗位 */
export interface Job {
  job_id: string;
  title: string;
  company: string;
  cities: string[];
  category: JobCategory;
  education: JobEducation;
  education_requirement: string;
  majors: string[];
  graduation_year: string;
  jd_text: string;
  source_url: string;
  published_at: string;
  publication_type: "original" | "repost";
  application_url: string;
  verified_at: string;
  application_status: JobApplicationStatus;
  verification_note: string;
}

export interface JobList {
  catalogue_version: string;
  total: number;
  page: number;
  page_size: number;
  items: Job[];
}

/** POST /api/job-matches 入参：只传 job_ids，JD 由后端按目录补全 */
export interface JobMatchRequest {
  resume_id: string;
  job_ids: string[];
}

export type JobAnalysisStatus = "pending" | "running" | "succeeded" | "degraded";

export type JobDegradedReason =
  | "ai_disabled"
  | "not_selected"
  | "input_too_short"
  | "input_too_long"
  | "model_failed"
  | "item_timeout"
  | "batch_timeout"
  | "mock_report";

/** 单个岗位的匹配结果 */
export interface JobMatchItem {
  job_id: string;
  title: string;
  /** 最终分：有 AI 报告时为加权分，降级时等于 stage1_score */
  score: number;
  stage1_score: number;
  level: MatchLevel;
  level_label: string;
  /** 基础评分的分项，与 report.dimension_scores 不是一回事 */
  subscores: DimensionScore[];
  matched: string[];
  missing: string[];
  reason: string | null;
  degraded: boolean;
  degraded_reason: JobDegradedReason | null;
  analysis_status: JobAnalysisStatus;
  report: DiagnoseResponse | null;
}

export interface JobMatchTask {
  status: TaskStatus;
  stage: string;
  progress: number;
  error: string | null;
  error_code: string | null;
  items: JobMatchItem[];
}

/** GET /api/job-matches/{task_id}/items/{job_id}/context */
export interface MatchContext {
  resume_id: string;
  job_id: string;
  diagnose_request: DiagnoseRequest;
  interview_request: InterviewCreate;
}

/** POST /api/interviews 入参 */
export interface InterviewCreate {
  resume_id: string;
  jd_text: string;
}
