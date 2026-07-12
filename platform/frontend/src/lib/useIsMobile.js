import { useEffect, useState } from "react";

// Single source of truth for "are we on a phone-sized screen". 640px is Tailwind's `sm`,
// so the JS branch (bottom sheet vs floating panels, pan-up vs pan-left) and the CSS
// branches (`sm:` classes, the media queries in index.css) always agree — if they
// disagreed you'd get a bottom sheet laid out for a desktop drawer.
const QUERY = "(max-width: 639px)";

export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(QUERY).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
