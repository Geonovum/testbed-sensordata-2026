import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const API_BASE_URL = "https://api.github.com";
const USER_AGENT = "NL-ReSpec-template-workflows";

export function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

export function requireArg(args, name) {
  const value = args[name];
  if (!value) {
    throw new Error(`Ontbrekend argument: --${name}`);
  }
  return value;
}

export function readJson(filePath) {
  return readFile(filePath, "utf8").then((contents) => JSON.parse(contents));
}

export function writeJson(filePath, data) {
  return writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export function hasOwn(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property);
}

export function extractRespecBuildUrl(html) {
  if (!html) {
    return null;
  }

  const scriptTagPattern = /<script\b[^>]*\bsrc="([^"]+)"/gi;
  for (const match of html.matchAll(scriptTagPattern)) {
    const candidate = match[1];
    if (!candidate.includes("respec")) {
      continue;
    }
    if (candidate.includes("respec-mermaid")) {
      continue;
    }
    if (candidate.includes("/config/")) {
      continue;
    }
    if (candidate.endsWith("config.js")) {
      continue;
    }
    return candidate;
  }

  return null;
}

export function extractRespecVersion(html) {
  if (!html) {
    return null;
  }

  const generatorMatch =
    html.match(/<meta\s+name=["']generator["'][^>]*content=["']ReSpec\s+([^"']+)["']/i) ??
    html.match(/<meta[^>]*content=["']ReSpec\s+([^"']+)["'][^>]*name=["']generator["']/i);

  return generatorMatch ? generatorMatch[1] : null;
}

export function logSection(title) {
  console.log("");
  console.log(`=== ${title} ===`);
}

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  const status = result.status ?? 1;
  if (status !== 0 && !options.allowFailure) {
    const error = new Error(
      `${options.description ?? command} mislukte met exitcode ${status}${
        result.stderr?.trim() ? `: ${result.stderr.trim()}` : ""
      }`,
    );
    error.status = status;
    error.stdout = result.stdout ?? "";
    error.stderr = result.stderr ?? "";
    throw error;
  }

  return {
    status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function encodePath(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export class GitHubClient {
  constructor(token) {
    if (!token) {
      throw new Error("GitHub token ontbreekt.");
    }

    this.token = token;
  }

  async request(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: options.accept ?? "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.headers ?? {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (options.allow404 && response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `GitHub API ${options.method ?? "GET"} ${path} mislukte (${response.status}): ${body.slice(0, 500)}`,
      );
    }

    if (response.status === 204) {
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return response.json();
    }

    return response.text();
  }

  async listActiveRepos(org) {
    const repos = [];

    for (let page = 1; ; page += 1) {
      const batch = await this.request(
        `/orgs/${encodeURIComponent(org)}/repos?per_page=100&page=${page}&type=all`,
      );

      if (!Array.isArray(batch) || batch.length === 0) {
        break;
      }

      for (const repo of batch) {
        if (!repo.archived && !repo.disabled) {
          repos.push(repo.name);
        }
      }

      if (batch.length < 100) {
        break;
      }
    }

    return repos;
  }

  async fileExists(owner, repo, path) {
    const data = await this.request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}`,
      {
        allow404: true,
      },
    );

    return data !== null;
  }

  async getRawFile(owner, repo, path) {
    return this.request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}`,
      {
        accept: "application/vnd.github.raw",
        allow404: true,
      },
    );
  }

  async getDefaultBranch(owner, repo) {
    const data = await this.request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    );

    return data.default_branch;
  }

  async findOpenPullRequestByHead(owner, repo, headBranch) {
    const params = new URLSearchParams({
      state: "open",
      head: `${owner}:${headBranch}`,
    });
    const pulls = await this.request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?${params.toString()}`,
    );

    return pulls[0] ?? null;
  }

  async createPullRequest(owner, repo, payload) {
    return this.request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
      {
        method: "POST",
        body: payload,
      },
    );
  }

  async updatePullRequest(owner, repo, number, payload) {
    return this.request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`,
      {
        method: "PATCH",
        body: payload,
      },
    );
  }
}
