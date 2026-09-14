import { readFile } from "node:fs/promises";
import vm from "node:vm";
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
// Only bare <script> tags hold JavaScript; the JSON-LD and importmap blocks
// carry a type attribute and are skipped by this pattern.
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
if (scripts.length === 0) throw new Error("Expected at least one inline script, found none");
scripts.forEach((source, index) => {
  new vm.Script(source, { filename: `index.html:inline-script-${index + 1}` });
});
