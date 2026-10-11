import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const REPO_URL = "https://github.com/elmiguelki/neoskins-viewer";
const DOCS_URL = "https://miguelki.gitbook.io/neoskins-viewer";

const root = fileURLToPath(new URL("..", import.meta.url));
const site = join(root, "site");
const downloads = join(site, "downloads");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

rmSync(site, { recursive: true, force: true });
cpSync(join(root, "site-src"), site, { recursive: true });
mkdirSync(downloads, { recursive: true });

const index = join(site, "index.html");
writeFileSync(
  index,
  readFileSync(index, "utf8").replaceAll("__DOCS_URL__", DOCS_URL).replaceAll("__REPO_URL__", REPO_URL),
);

execSync(`npm pack --pack-destination "${downloads}"`, { cwd: root, stdio: "inherit" });
const tarball = `neoskins-viewer-${version}.tgz`;
cpSync(join(downloads, tarball), join(downloads, "neoskins-viewer-latest.tgz"));

const files = [
  "neoskins-viewer.standalone.js",
  "neoskins-viewer.standalone.js.map",
  "neoskins-viewer.js",
  "neoskins-viewer.js.map",
  "neoskins-client.js",
];
for (const file of files) cpSync(join(root, "dist", file), join(downloads, file));

const sizes = {};
for (const file of [...files, tarball]) sizes[file] = statSync(join(downloads, file)).size;
writeFileSync(join(downloads, "manifest.json"), JSON.stringify({ version, tarball, sizes }, null, 2));

writeFileSync(join(site, ".nojekyll"), "");
console.log(`site ready: v${version}`);
