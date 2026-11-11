import { useCallback, useEffect, useRef, useState } from "react";
import type { Job } from "../types";
import { jobStatus } from "../lib/jobTrust";

interface JobCarouselProps {
  jobs: Job[];
  selectedIds: string[];
  onOpen: (job: Job) => void;
}

interface TrackState {
  /** 滚动条滑块的位置和宽度（占轨道的百分比） */
  thumbLeft: number;
  thumbWidth: number;
  atStart: boolean;
  atEnd: boolean;
  /** 卡片全部放得下时不需要提示和进度条 */
  scrollable: boolean;
}

/** 去掉 JD 开头的固定小标题，卡片上直接看到内容 */
function jobIntro(job: Job) {
  return job.jd_text.replace(/\s+/g, " ").replace(/^(岗位职责|工作职责|职位描述)[：:]\s*/, "");
}

/** 手机上手指滑动（露出下一张的一部分），桌面用左右按钮；点卡片打开岗位详情 */
export function JobCarousel({ jobs, selectedIds, onOpen }: JobCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);
  const [track, setTrack] = useState<TrackState>({ thumbLeft: 0, thumbWidth: 100, atStart: true, atEnd: true, scrollable: false });

  const measure = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setTrack({
      thumbLeft: el.scrollWidth ? (el.scrollLeft / el.scrollWidth) * 100 : 0,
      thumbWidth: el.scrollWidth ? (el.clientWidth / el.scrollWidth) * 100 : 100,
      // 吸附时会停在内边距的位置，留几像素余量
      atStart: el.scrollLeft <= 4,
      atEnd: el.scrollLeft >= max - 4,
      scrollable: max > 1,
    });
  }, []);

  useEffect(() => {
    measure();
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, jobs.length]);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  function handleScroll() {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(measure);
  }

  function move(direction: 1 | -1) {
    const el = trackRef.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card) return;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction * (card.offsetWidth + gap), behavior: reduced ? "auto" : "smooth" });
  }

  return (
    <div className="job-carousel">
      {track.scrollable ? (
        <div className="job-carousel-arrows">
          <button type="button" aria-label="上一张岗位卡片" disabled={track.atStart} onClick={() => move(-1)}>←</button>
          <button type="button" aria-label="下一张岗位卡片" disabled={track.atEnd} onClick={() => move(1)}>→</button>
        </div>
      ) : null}
      <div className="job-carousel-track" ref={trackRef} onScroll={handleScroll}>
        {jobs.map((job) => (
          <button key={job.job_id} type="button" className="job-slide" onClick={() => onOpen(job)}>
            <span className="picker-company-row">
              <span className="picker-logo small" aria-hidden="true">{job.company.slice(0, 1)}</span>
              <span className="picker-company">
                <strong>{job.company}</strong>
                <small>{job.cities.join(" / ")}</small>
              </span>
              {selectedIds.includes(job.job_id) ? <span className="job-slide-picked">已选</span> : null}
            </span>
            <span className="job-slide-title">{job.title}</span>
            <span>{jobStatus(job)}</span>
            <span className="job-slide-intro">{jobIntro(job)}</span>
            <span className="job-slide-more">查看详情 →</span>
          </button>
        ))}
      </div>
      {track.scrollable ? (
        <div className="job-carousel-foot">
          <span className="job-carousel-bar" aria-hidden="true">
            <span style={{ left: `${track.thumbLeft}%`, width: `${track.thumbWidth}%` }} />
          </span>
          <span className="job-carousel-hint">左右滑动查看更多</span>
        </div>
      ) : null}
    </div>
  );
}
