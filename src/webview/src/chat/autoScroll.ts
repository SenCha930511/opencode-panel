/**
 * AutoScrollPark (todo 13): auto-scroll pinning for the virtuoso list.
 *
 * The list pins to the bottom (smooth-follows new content) until the user
 * scrolls up; scrolling back to the bottom re-arms pinning. Virtuoso drives
 * both seams: `atBottomStateChange` feeds {@link onAtBottomChange}, and
 * `followOutput` calls {@link followFor} on every list update.
 */

export class AutoScrollPark {
  private pinned = true;

  onAtBottomChange(atBottom: boolean): void {
    this.pinned = atBottom;
  }

  get isPinned(): boolean {
    return this.pinned;
  }

  /** Virtuoso `followOutput` contract: smooth only while pinned at bottom. */
  readonly followFor = (atBottom: boolean): "smooth" | false => {
    return this.pinned && atBottom ? "smooth" : false;
  };
}
