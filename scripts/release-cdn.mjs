import { execSync } from "node:child_process";

const GITHUB_USER = "ahmedbanihanibh";
const REPO = "react-scan-banihani";

const version = process.argv[2];
if (!version) {
  console.error("Usage: pnpm release:cdn <version>   e.g. pnpm release:cdn 0.5.8");
  process.exit(1);
}

const tag = `v${version}-banihani`;
const run = (command) => execSync(command, { stdio: "inherit" });

run("pnpm build:cdn");
run("git add cdn/react-scan-banihani.js");

try {
  run(`git commit -m "chore(cdn): release ${tag}"`);
} catch {
  console.log("No bundle changes to commit — tagging the current commit.");
}

run(`git tag ${tag}`);
run("git push origin main");
run(`git push origin ${tag}`);

const url = `//cdn.jsdelivr.net/gh/${GITHUB_USER}/${REPO}@${tag}/cdn/react-scan-banihani.js`;
console.log(`\nReleased ${tag}. Immutable production URL:\n${url}`);
