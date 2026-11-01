import { readFileSync, readdirSync } from "node:fs";

// The guides ship in the package (guides/*.md), served as MCP resources and by
// the telegraph_docs tool. A file's number prefix only sets the order.
const DIR = new URL("../guides/", import.meta.url);

export interface Guide {
  name: string;
  title: string;
  summary: string;
  text: string;
}

export function loadGuides(): Guide[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const text = readFileSync(new URL(f, DIR), "utf8");
      const lines = text.split("\n");
      const title = (lines.find((l) => l.startsWith("# ")) || f).replace(/^# /, "");
      const summary = lines.find((l) => l.trim() && !l.startsWith("#")) || "";
      return { name: f.replace(/^\d+-/, "").replace(/\.md$/, ""), title, summary, text };
    });
}

// The guide sections ("## ...") that match the most words of query, best first.
export function searchGuides(guides: Guide[], query: string, max = 3): string {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const hits: { score: number; text: string }[] = [];
  for (const g of guides) {
    for (const section of g.text.split(/\n(?=## )/)) {
      const lower = section.toLowerCase();
      const score = words.filter((w) => lower.includes(w)).length;
      if (score > 0) hits.push({ score, text: `From "${g.title}" (topic ${g.name}):\n\n${section.trim()}` });
    }
  }
  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((h) => h.text)
    .join("\n\n---\n\n");
}
