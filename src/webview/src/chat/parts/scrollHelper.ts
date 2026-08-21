/**
 * Safely scrolls an element into view when expanded, ensuring its full content
 * (including bottom and margins) is visible above the bottom composer bar.
 */
export function scrollElementIntoViewSafe(el: HTMLElement | null): void {
  if (!el) return;
  setTimeout(() => {
    try {
      const rect = el.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const bottomClearance = 80; // 80px clearance above composer
      const topClearance = 60; // 60px clearance below top sticky bar

      // If the element is taller than the viewport, scroll its top into view
      if (rect.height > windowHeight - topClearance - bottomClearance) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      // If bottom of element extends past the bottom or is too close to bottom
      if (rect.bottom > windowHeight - bottomClearance) {
        el.scrollIntoView({ behavior: "smooth", block: "end" });
      } else if (rect.top < topClearance) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    } catch {
      el.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, 60);
}
