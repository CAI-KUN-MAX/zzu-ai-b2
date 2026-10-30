import { useEffect, useRef, useState } from "react";

/**
 * 数字滚动：用于匹配分数，避免结果一次性"啪"地出现。
 * 只在首次挂载时跑一次；后续轮询更新分数直接显示新值，避免来回跳。
 */
export function CountUp({
  value,
  duration = 620,
  className,
}: {
  value: number;
  duration?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(0);
  const playedRef = useRef(false);

  useEffect(() => {
    if (playedRef.current) {
      setDisplay(value);
      return;
    }
    playedRef.current = true;

    let raf = 0;
    const startAt = performance.now();
    const from = 0;
    const to = value;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startAt) / duration);
      // easeOutCubic，收尾更自然
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <span className={className}>{display}</span>;
}
