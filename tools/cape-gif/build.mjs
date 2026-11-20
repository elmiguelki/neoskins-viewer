// Builds tools/cape-gif into a single self-contained HTML file that opens with a double click.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const dir = fileURLToPath(new URL(".", import.meta.url));
execSync(`npx vite build --config "${join(dir, "vite.config.ts")}"`, { cwd: dir, stdio: "inherit" });

const app = readFileSync(join(dir, "build", "app.js"), "utf8").replaceAll("</script", "<\\/script");
const html = readFileSync(join(dir, "index.html"), "utf8");
const out = join(dir, "dist", "neocapes-gif.html");
mkdirSync(join(dir, "dist"), { recursive: true });
writeFileSync(out, html.replace("<!-- APP -->", () => `<script>\n${app}\n</script>`));
console.log(`listo: ${out}`);
