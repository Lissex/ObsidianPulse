import { requestUrl } from "obsidian";

export interface GitHubCommit {
  repo: string;
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

interface GitHubApiCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
  };
  author: { login: string } | null;
}

export function normalizeRepository(value: string): string | null {
  const match = value.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/i, "").match(/^([\w.-]+)\/([\w.-]+)$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

export async function fetchRepositoryCommits(
  repo: string,
  since: Date,
  until: Date,
  token: string | null,
): Promise<GitHubCommit[]> {
  const normalized = normalizeRepository(repo);
  if (!normalized) throw new Error(`Некорректный репозиторий: ${repo}`);
  const [owner, name] = normalized.split("/");
  const commits: GitHubCommit[] = [];
  for (let page = 1; page <= 10; page++) {
    const params = new URLSearchParams({
      since: since.toISOString(),
      until: until.toISOString(),
      per_page: "100",
      page: String(page),
    });
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await requestUrl({
      url: `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits?${params.toString()}`,
      headers,
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) {
      const message = typeof response.json?.message === "string" ? response.json.message : `HTTP ${response.status}`;
      if (response.status === 401) throw new Error("GitHub отклонил токен. Проверьте его в настройках Vault Pulse.");
      if (response.status === 403) throw new Error("GitHub ограничил запрос или токен не имеет Contents: read.");
      if (response.status === 404) throw new Error(`Репозиторий ${normalized} не найден или недоступен этому токену.`);
      throw new Error(`GitHub API (${response.status}): ${message}`);
    }
    const pageItems = (response.json as GitHubApiCommit[]).map((item) => ({
      repo: normalized,
      sha: item.sha,
      message: item.commit.message.split("\n")[0],
      author: item.author?.login ?? item.commit.author?.name ?? "Неизвестный автор",
      date: item.commit.author?.date ?? "",
      url: item.html_url,
    }));
    commits.push(...pageItems);
    if (pageItems.length < 100) break;
  }
  return commits;
}
