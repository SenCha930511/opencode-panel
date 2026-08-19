import { useEffect, useState } from "react";

const RELATIVE_TIME_TICK_MS = 30_000;

/** Wall-clock hook: re-renders every 30s so relative timestamps stay fresh. */
export function useNow(): number {
  const [now, setNow] = useState(() => {
    return Date.now();
  });
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, RELATIVE_TIME_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}
