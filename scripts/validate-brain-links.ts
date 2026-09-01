import { access, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const markdownLink = /\[[^\]]+\]\(([^)]+)\)/g;

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return markdownFiles(path);
      return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
    }),
  );
  return nested.flat();
}

async function main(): Promise<void> {
  const root = process.cwd();
  const files = await markdownFiles(resolve(root, "docs", "brain"));
  const broken: string[] = [];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const match of content.matchAll(markdownLink)) {
      const link = match[1];
      if (!link || /^(https?:|mailto:|#)/.test(link)) continue;
      const target = link.split("#", 1)[0];
      if (!target) continue;
      try {
        await access(resolve(dirname(file), target));
      } catch {
        broken.push(`${file}: ${link}`);
      }
    }
  }

  if (broken.length)
    throw new Error(`Broken Brain links:\n${broken.join("\n")}`);
  console.log(`validated-brain-links: ${files.length}`);
}

void main();
