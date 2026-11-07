import { requestUrl } from "obsidian";

export interface GitHubCommit {
  repo: string;
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

export interface GitHubRepository {
  fullName: string;
  isPrivate: boolean;
}

interface GitHubApiRepository {
  full_name: string;
  private: boolean;
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

export async function fetchGitHubAccount(token: string): Promise<{ login: string; repositories: GitHubRepository[] }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const userResponse = await requestUrl({ url: "https://api.github.com/user", headers, throw: false });
  if (userResponse.status < 200 || userResponse.status >= 300) {
    if (userResponse.status === 401) throw new Error("GitHub отклонил токен. Проверьте SecretStorage.");
    throw new Error(`Не удалось подключить GitHub аккаунт (HTTP ${userResponse.status}).`);
  }
  const user: unknown = userResponse.json;
  if (!isRecord(user) || typeof user.login !== "string") throw new Error("GitHub вернул неожиданный профиль аккаунта.");

  const repositories: GitHubRepository[] = [];
  for (let page = 1; page <= 10; page++) {
    const response = await requestUrl({
      url: `https://api.github.com/user/repos?sort=full_name&per_page=100&page=${page}`,
      headers,
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Не удалось загрузить репозитории GitHub (HTTP ${response.status}).`);
    }
    const rawRepositories: unknown = response.json;
    if (!Array.isArray(rawRepositories)) throw new Error("GitHub вернул неожиданный список репозиториев.");
    const pageRepositories = (rawRepositories as unknown[]).filter(isGitHubApiRepository).map((repository) => ({
      fullName: repository.full_name,
      isPrivate: repository.private,
    }));
    repositories.push(...pageRepositories);
    if (pageRepositories.length < 100) break;
  }
  return { login: user.login, repositories };
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
      const errorBody: unknown = response.json;
      const message = isRecord(errorBody) && typeof errorBody.message === "string" ? errorBody.message : `HTTP ${response.status}`;
      
      if (response.status === 401) throw new Error("GitHub отклонил токен. Проверьте его в настройках VaultScope.");
      if (response.status === 403) throw new Error("GitHub ограничил запрос или токен не имеет Contents: read.");
      if (response.status === 404) throw new Error(`Репозиторий ${normalized} не найден или недоступен этому токену.`);
      
      throw new Error(`GitHub API (${response.status}): ${message}`);
    }

    const rawItems: unknown = response.json;
    if (!Array.isArray(rawItems)) {
      throw new Error("GitHub API вернул неожиданный формат данных (ожидался массив).");
    }
    const apiItems: unknown[] = rawItems;
    const pageItems = apiItems.filter(isGitHubApiCommit).map((item) => {
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

function isGitHubApiCommit(value: unknown): value is GitHubApiCommit {
  if (!isRecord(value) || typeof value.sha !== "string" || typeof value.html_url !== "string" || !isRecord(value.commit)) return false;
  if (typeof value.commit.message !== "string") return false;
  if (value.commit.author !== null && (!isRecord(value.commit.author) || typeof value.commit.author.date !== "string")) return false;
  return value.author === null || (isRecord(value.author) && typeof value.author.login === "string");
}

function isGitHubApiRepository(value: unknown): value is GitHubApiRepository {
  return isRecord(value) && typeof value.full_name === "string" && typeof value.private === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
