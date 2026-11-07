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
  if (!match || !match[1] || !match[2]) return null;
  return `${match[1]}/${match[2]}`;
}

export async function fetchRepositoryCommits(
  repo: string,
  since: Date,
  until: Date,
  token: string | null,
): Promise<GitHubCommit[]> {
  const normalized = normalizeRepository(repo);
  if (!normalized) throw new Error(`Некорректный репозиторий: ${repo}`);
  
  const parts = normalized.split("/");
  const owner = parts[0];
  const name = parts[1];
  if (!owner || !name) throw new Error(`Некорректный репозиторий: ${repo}`);

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
      const jsonObj = response.json as Record<string, unknown> | null;
      const message = (jsonObj && typeof jsonObj.message === "string") ? jsonObj.message : `HTTP ${response.status}`;
      
      if (response.status === 401) throw new Error("GitHub отклонил токен. Проверьте его в настройках Vault Pulse.");
      if (response.status === 403) throw new Error("GitHub ограничил запрос или токен не имеет Contents: read.");
      if (response.status === 404) throw new Error(`Репозиторий ${normalized} не найден или недоступен этому токену.`);
      
      throw new Error(`GitHub API (${response.status}): ${message}`);
    }

    const rawItems: unknown = response.json;
    if (!Array.isArray(rawItems)) {
      throw new Error("GitHub API вернул неожиданный формат данных (ожидался массив).");
    }

    const pageItems = (rawItems as GitHubApiCommit[]).map((item) => {
      const firstLine = item.commit && typeof item.commit.message === "string" 
        ? item.commit.message.split("\n")[0] 
        : "";
        
      return {
        repo: normalized,
        sha: item.sha,
        message: firstLine,
        author: item.author?.login ?? item.commit?.author?.name ?? "Неизвестный автор",
        date: item.commit?.author?.date ?? "",
        url: item.html_url,
      };
    });

    commits.push(...pageItems);
    if (pageItems.length < 100) break;
  }
  
  return commits;
}