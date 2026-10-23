import { useLayoutEffect, useRef } from "react";

/** Keep one page's viewport position without recording scroll events from other routes. */
export function useRetainedPageScroll(active: boolean) {
  const root = useRef<HTMLElement>(null);
  const top = useRef(0);
  useLayoutEffect(() => {
    const viewport = root.current?.closest(".page-content");
    if (!active || !viewport) return;
    viewport.scrollTop = top.current;
    const remember = () => {
      top.current = viewport.scrollTop;
    };
    viewport.addEventListener("scroll", remember);
    return () => viewport.removeEventListener("scroll", remember);
  }, [active]);
  return root;
}
