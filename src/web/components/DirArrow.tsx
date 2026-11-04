/** ▲ or ▼, which screen readers hear as the word "up" or "down". The caller colours it and writes the amount. */
export function DirArrow({ dir }: { dir: "up" | "down" }) {
  return <><span aria-hidden="true">{dir === "up" ? "▲" : "▼"}</span><span className="visually-hidden">{dir}</span></>;
}
