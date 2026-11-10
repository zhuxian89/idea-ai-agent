import { useEffect, useRef, useState } from "react";
import { appPath } from "../services/base";

const assets = {
  "🤔": "1f914",
  "😱": "1f631",
  "💬": "1f4ac",
  "👍": "1f44d",
  "✍️": "270d",
  "👀": "1f440",
  "⚡": "26a1",
  "🔥": "1f525",
  "🔌": "1f50c",
  "👨‍💻": "1f4bb",
  "✏️": "270f",
  "🔄": "1f504",
} as const;

export function ActivityEmoji({ emoji }: { emoji: keyof typeof assets }) {
  const elementRef = useRef<HTMLSpanElement>(null);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let inView = false;
    const update = () => setAnimate(inView && !document.hidden && !reducedMotion.matches);
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      update();
    });
    observer.observe(elementRef.current!);
    reducedMotion.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  const rotating = emoji === "🔄";
  const extension = animate && !rotating ? "webp" : "svg";
  return <span ref={elementRef} aria-hidden="true" className="session-activity-emoji" data-emoji={emoji}>
    <img
      src={appPath(`/assets/activity-emoji/${assets[emoji]}.${extension}`)}
      alt=""
      width={20}
      height={20}
      className={animate && rotating ? "session-activity-emoji-recovering" : undefined}
    />
  </span>;
}
