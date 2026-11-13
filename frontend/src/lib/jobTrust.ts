import type { Job } from "../types";

export function jobStatus(job: Job): string {
  if (job.effective_status === "closed" || (!job.effective_status && job.application_status === "closed")) return "招聘已关闭";
  return job.effective_status === "open" ? "招聘开放" : "招聘状态待核实";
}

export function jobContent(job: Job): string {
  switch (job.jd_completeness) {
    case "full": return "完整单岗 JD";
    case "summary": return "岗位摘要";
    case "campaign": return "企业招聘简章";
    default: return "岗位内容完整度未知";
  }
}

export function canApply(job: Job): boolean {
  return job.effective_status === "open" && job.application_verified === true && !!job.application_url;
}
