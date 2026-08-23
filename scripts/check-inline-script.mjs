import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);

if (scripts.length !== 1) {
  throw new Error(`Expected one inline application script, found ${scripts.length}`);
}

new vm.Script(scripts[0], { filename: "index.html:inline-script" });
