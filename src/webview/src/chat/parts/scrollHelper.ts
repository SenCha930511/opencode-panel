/**
 * Safely scrolls an element into view when expanded, ensuring its full content
 * is visible above the bottom dock and composer bars.
 */
export function scrollElementIntoViewSafe(el: HTMLElement | null): void {
  if (!el) return;
  setTimeout(() => {
    try {
      const rect = el.getBoundingClientRect();
      const windowHeight = window.innerHeight;

      // Dynamically measure bottom clearance from Composer and SessionDock
      let bottomClearance = 120;
      const composerEl =
        document.querySelector("[data-oc-slot='composer']") ||
        document.querySelector("form") ||
        document.querySelector("textarea")?.closest("form");
      if (composerEl) {
        const compRect = composerEl.getBoundingClientRect();
        if (compRect.height > 0) {
          bottomClearance = Math.max(bottomClearance, windowHeight - compRect.top + 20);
        }
      }

      // Check if SessionDock (檔案變更/編輯紀錄) is present and taking space
      const dockEl = document.querySelector("[data-oc-dock='session']");
      if (dockEl) {
        const dockRect = dockEl.getBoundingClientRect();
        if (dockRect.height > 0 && dockRect.top < windowHeight - bottomClearance + 20) {
          bottomClearance = Math.max(bottomClearance, windowHeight - dockRect.top + 20);
        }
      }

      const topClearance = 60; // 60px clearance below top sticky bar

      // If the element is taller than the available viewport, scroll top into view
      if (rect.height > windowHeight - topClearance - bottomClearance) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      // If bottom of element extends past the clearance boundary
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
  }, 75);
}
