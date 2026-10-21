import { useCountUp } from "../lib/useCountUp";

interface ScoreRingProps {
  score: number;
  color: string;
  size?: number;
  strokeWidth?: number;
}

/** 环形总分，数字与圆环同步滚动 */
export function ScoreRing({ score, color, size = 168, strokeWidth = 13 }: ScoreRingProps) {
  const animated = useCountUp(score, 1000);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (animated / 100) * circumference;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#eef0f4"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-[46px] font-semibold leading-none tracking-tight">
          {animated}
        </span>
        <span className="mt-1 text-[11px] text-ink-500">满分 100</span>
      </div>
    </div>
  );
}
