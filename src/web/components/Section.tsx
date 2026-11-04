// A page section: its heading above its content, with an optional aside (a hint or a control) at
// the heading's right and an optional intro line under it. The heading sits above the section's
// panels, never inside one; level 3 is a sub-section of a section, its h3 above its own content.
// `tone` draws your side's or the other side's colour under the heading.
import { useId, type ReactNode, type Ref } from "react";
import { cx } from "./cx";
import styles from "./Section.module.css";

/**
 * `id` is the heading's (a page links or focuses it), else one is made. `headingRef` makes the
 * heading focusable by code, as a section link or a reset moves focus there. Each section is a
 * landmark named by its heading; `region={false}` makes it a plain block where its name repeats on
 * the page (the Friends zones each hold a "By playlist"), as landmark names must differ.
 */
export function Section({ title, aside, intro, tone, level = 2, region = true, id, headingRef, className, children }: {
  title: ReactNode; aside?: ReactNode; intro?: ReactNode; tone?: "yours" | "theirs"; level?: 2 | 3; region?: boolean;
  id?: string; headingRef?: Ref<HTMLHeadingElement>; className?: string; children?: ReactNode;
}) {
  const made = useId();
  const hid = id ?? made;
  const Box = region ? "section" : "div";
  const H = level === 2 ? "h2" : "h3";
  return (
    <Box className={cx(styles.section, level === 3 && styles.sub, tone && styles[tone], className)} aria-labelledby={region ? hid : undefined}>
      <div className={styles.top}>
        <div className={styles.line}>
          <H id={hid} ref={headingRef} tabIndex={headingRef ? -1 : undefined} className={styles.h}>{title}</H>
          {aside}
        </div>
        {intro && <p className={styles.intro}>{intro}</p>}
      </div>
      {children}
    </Box>
  );
}
