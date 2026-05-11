import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  GitHubClient,
  logSection,
  parseArgs,
  readJson,
  requireArg,
  runCommand,
} from "./lib/workflow-utils.mjs";

const MANAGED_FILES = [
  "workflows/build.yml",
  "workflows/main.yml",
  "workflows/pdf.js",
  "workflows/publish.yml",
];

const REMOVED_MANAGED_FILES = ["dependabot.yml"];

const args = parseArgs(process.argv.slice(2));
const org = requireArg(args, "org");
const reposFile = requireArg(args, "repos-file");
const templateGithubDir = path.resolve(requireArg(args, "template-github-dir"));
const selfOwner = requireArg(args, "self-owner");
const selfRepo = requireArg(args, "self-repo");
const token = process.env.GH_TOKEN ?? "";
const dryRun = (process.env.DRY_RUN ?? "false") === "true";

if (!token) {
  throw new Error("GH_TOKEN ontbreekt.");
}

const client = new GitHubClient(token);
const reposJson = await readJson(reposFile);
const reposConfig = reposJson[org]?.repos ?? {};
const reposToUpdate = Object.entries(reposConfig)
  .filter(([, config]) => config.updateAllow === true)
  .map(([repo]) => repo);

const configStateCache = new Map();

function remoteUrl(owner, repo) {
  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${owner}/${repo}.git`;
}

function copyManagedFiles(targetRepoDir) {
  const stagedPaths = [];

  for (const relativePath of MANAGED_FILES) {
    const source = path.join(templateGithubDir, relativePath);
    const target = path.join(targetRepoDir, ".github", relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(source, target);
    stagedPaths.push(path.join(".github", relativePath));
  }

  return stagedPaths;
}

function removeDeprecatedManagedFiles(targetRepoDir) {
  const changedPaths = [];

  for (const relativePath of REMOVED_MANAGED_FILES) {
    const target = path.join(targetRepoDir, ".github", relativePath);
    if (existsSync(target)) {
      rmSync(target, { force: true });
      changedPaths.push(path.join(".github", relativePath));
    }
  }

  return changedPaths;
}

function gitDiffHasChanges(cwd) {
  const result = runCommand("git", ["diff", "--staged", "--quiet"], {
    cwd,
    allowFailure: true,
    description: "git diff --staged --quiet",
  });

  if (result.status === 0) {
    return false;
  }

  if (result.status === 1) {
    return true;
  }

  throw new Error("git diff --staged --quiet gaf een onverwachte exitcode.");
}

function listStagedFiles(cwd) {
  const result = runCommand("git", ["diff", "--staged", "--name-only"], {
    cwd,
    description: "git diff --staged --name-only",
  });

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function getConfigState(repo) {
  if (configStateCache.has(repo)) {
    return configStateCache.get(repo);
  }

  const [hasJsConfig, hasRootConfig] = await Promise.all([
    client.fileExists(org, repo, "js/config.js"),
    client.fileExists(org, repo, "config.js"),
  ]);

  const state = { hasJsConfig, hasRootConfig };
  configStateCache.set(repo, state);
  return state;
}

function cloneRepo(owner, repo, defaultBranch) {
  const tempDir = mkdtempSync(path.join(tmpdir(), `nl-respec-${repo}-`));

  try {
    runCommand(
      "git",
      ["clone", "--quiet", "--depth", "1", "--branch", defaultBranch, remoteUrl(owner, repo), tempDir],
      {
        description: `git clone ${owner}/${repo}`,
      },
    );
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }

  return tempDir;
}

function configureGit(cwd) {
  runCommand("git", ["config", "user.email", "github-actions[bot]@users.noreply.github.com"], {
    cwd,
    description: "git config user.email",
  });
  runCommand("git", ["config", "user.name", "github-actions[bot]"], {
    cwd,
    description: "git config user.name",
  });
}

async function createConfigMigrationPr(repo) {
  const prTitle = "chore: verplaats config.js naar js/config.js en update workflows";
  const prBody =
    "Deze PR migreert de repository naar de actuele NL-ReSpec-template structuur.\n\n" +
    "Wijzigingen:\n" +
    "- verplaatst `config.js` naar `js/config.js`\n" +
    "- voegt de beheerde GitHub Actions workflows uit de template toe of werkt ze bij\n\n" +
    "Na merge wordt de repo bij een volgende run automatisch opgenomen in `repos.json`, omdat `js/config.js` dan aanwezig is.";

  console.log("📦 config.js in root, nog niet in js/ — migratie-PR voorbereiden.");

  if (dryRun) {
    return { result: "dry-run" };
  }

  const defaultBranch = await client.getDefaultBranch(org, repo);
  const branchName = "chore/verplaats-config-js-naar-js-map";
  const repoDir = cloneRepo(org, repo, defaultBranch);

  try {
    configureGit(repoDir);

    runCommand("git", ["checkout", "-b", branchName], {
      cwd: repoDir,
      description: "git checkout -b",
    });

    mkdirSync(path.join(repoDir, "js"), { recursive: true });
    renameSync(path.join(repoDir, "config.js"), path.join(repoDir, "js", "config.js"));

    const stagedPaths = copyManagedFiles(repoDir);
    const removedPaths = removeDeprecatedManagedFiles(repoDir);
    runCommand(
      "git",
      ["add", "-A", "--", "config.js", "js/config.js", ...stagedPaths, ...removedPaths],
      {
        cwd: repoDir,
        description: "git add migratiebestanden",
      },
    );

    if (!gitDiffHasChanges(repoDir)) {
      console.log("✅ Geen wijzigingen voor migratie-PR.");
      return { result: "no-change" };
    }

    runCommand(
      "git",
      ["commit", "-m", "chore: verplaats config.js naar js/config.js en update workflows"],
      {
        cwd: repoDir,
        description: "git commit migratie-PR",
      },
    );
    runCommand("git", ["push", "origin", branchName, "--force"], {
      cwd: repoDir,
      description: "git push migratie-PR",
    });

    const existingPr = await client.findOpenPullRequestByHead(org, repo, branchName);
    if (existingPr) {
      await client.updatePullRequest(org, repo, existingPr.number, {
        title: prTitle,
        body: prBody,
      });
      console.log(`🔄 PR #${existingPr.number} bijgewerkt.`);
      return { result: "updated-pr" };
    }

    const createdPr = await client.createPullRequest(org, repo, {
      title: prTitle,
      body: prBody,
      base: defaultBranch,
      head: branchName,
    });
    console.log(`✅ PR #${createdPr.number} aangemaakt.`);
    return { result: "created-pr" };
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
}

async function updateManagedFiles(repo) {
  const defaultBranch = await client.getDefaultBranch(org, repo);
  const repoDir = cloneRepo(org, repo, defaultBranch);

  try {
    configureGit(repoDir);

    const stagedPaths = copyManagedFiles(repoDir);
    const removedPaths = removeDeprecatedManagedFiles(repoDir);
    runCommand("git", ["add", "-A", "--", ...stagedPaths, ...removedPaths], {
      cwd: repoDir,
      description: "git add workflowbestanden",
    });

    if (!gitDiffHasChanges(repoDir)) {
      console.log("✅ Geen wijzigingen.");
      return { result: "no-change" };
    }

    if (dryRun) {
      console.log("🔍 Dry run — gewijzigde bestanden:");
      for (const file of listStagedFiles(repoDir)) {
        console.log(file);
      }
      return { result: "dry-run" };
    }

    runCommand(
      "git",
      ["commit", "-m", "chore: update GitHub Actions workflows vanuit NL-ReSpec-template"],
      {
        cwd: repoDir,
        description: "git commit workflow-update",
      },
    );
    runCommand("git", ["push", "origin", defaultBranch], {
      cwd: repoDir,
      description: "git push workflow-update",
    });
    console.log(`✅ Gecommit op ${defaultBranch}.`);
    return { result: "updated" };
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
}

let updated = 0;
let skipped = 0;
let failed = 0;
let migrationPrs = 0;
const wouldUpdate = [];
const migrationTargets = [];

const allRepos = await client.listActiveRepos(org);

for (const repo of allRepos) {
  if (!repo || repo === ".github") {
    continue;
  }

  if (org === selfOwner && repo === selfRepo) {
    continue;
  }

  const { hasJsConfig, hasRootConfig } = await getConfigState(repo);
  if (!hasRootConfig || hasJsConfig) {
    continue;
  }

  logSection(`${org}/${repo}`);

  try {
    const outcome = await createConfigMigrationPr(repo);
    if (outcome.result === "dry-run") {
      migrationTargets.push(`${org}/${repo} (config.js → js/config.js + .github)`);
    } else if (outcome.result === "created-pr" || outcome.result === "updated-pr") {
      migrationPrs += 1;
    }
  } catch (error) {
    console.error(`❌ Fout bij ${org}/${repo}: ${error.message}`);
    failed += 1;
  }
}

for (const repo of reposToUpdate) {
  if (!repo || repo === ".github") {
    continue;
  }

  if (org === selfOwner && repo === selfRepo) {
    console.log(`⏩ Template repo overgeslagen: ${org}/${repo}`);
    skipped += 1;
    continue;
  }

  logSection(`${org}/${repo}`);

  try {
    const { hasJsConfig, hasRootConfig } = await getConfigState(repo);

    if (hasRootConfig && !hasJsConfig) {
      console.log("⏩ Root-level config.js; migratie-PR wordt centraal afgehandeld.");
      skipped += 1;
      continue;
    }

    if (!hasJsConfig) {
      console.log("⏩ Geen js/config.js of config.js, overslaan.");
      skipped += 1;
      continue;
    }

    const outcome = await updateManagedFiles(repo);
    if (outcome.result === "updated") {
      updated += 1;
    } else if (outcome.result === "dry-run") {
      wouldUpdate.push(`${org}/${repo}`);
    }
  } catch (error) {
    console.error(`❌ Fout bij ${org}/${repo}: ${error.message}`);
    failed += 1;
  }
}

console.log("");
console.log("════════════════════════════════════════");
console.log(`Samenvatting ${org}`);
if (dryRun) {
  console.log(`  Zou bijwerken (.github):     ${wouldUpdate.length}`);
  for (const repo of wouldUpdate) {
    console.log(`    - ${repo}`);
  }
  console.log(`  Zou migratie-PRs maken:      ${migrationTargets.length}`);
  for (const repo of migrationTargets) {
    console.log(`    - ${repo}`);
  }
} else {
  console.log(`  Bijgewerkt (.github): ${updated}`);
  console.log(`  Migratie-PRs:        ${migrationPrs}`);
}
console.log(`  Overgeslagen: ${skipped}`);
console.log(`  Mislukt:      ${failed}`);
console.log("════════════════════════════════════════");

if (failed > 0) {
  process.exit(1);
}
