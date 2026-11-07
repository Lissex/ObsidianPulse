import { Notice, Plugin, TFile, TFolder, normalizePath } from "obsidian";
import { StatsService } from "./stats";
import { DailyNotePreviewModal, buildDailyContent, buildDailyPath } from "./daily";
import { NewTaskData, NewTaskModal, TaskRecord, TaskService, TaskRolloverModal, buildTaskLine, parseTasks } from "./tasks";
import { NewScheduleEvent, NewScheduleEventModal, formatScheduleLine, parseScheduleEvents, timeToMinutes } from "./schedule";
import { PeriodPlanPreviewModal, PlanningPeriod, buildPeriodPath, getPeriodInfo, mergePeriodReview, renderPeriodTemplate } from "./planning";
import { GitHubCommit, GitHubEmptyRepositoryError, GitHubRepository, fetchGitHubAccount, fetchRepositoryCommits } from "./github";
import { LearningCourse, LearningCourseInput, normalizeLearningCourses } from "./learning";
import { DashboardView } from "./dashboard";
import { VaultScopeSettingTab } from "./settings-tab";
import { DEFAULT_SETTINGS, normalizeSettings, VaultScopeSettings } from "./settings-model";
import { appendTaskToSection, folderOf } from "./view-utils";

const VIEW_TYPE = "vault-pulse-dashboard";

export default class VaultScopePlugin extends Plugin {
  settings: VaultScopeSettings = DEFAULT_SETTINGS;
  stats?: StatsService;
  tasks?: TaskService;
  githubCommits: GitHubCommit[] = [];
  githubAvailableRepositories: GitHubRepository[] = [];
  githubStatus = "Синхронизация ещё не запускалась.";
  githubSyncing = false;
  learningCourses: LearningCourse[] = [];
  private learningDataPath = "VaultScope/learning.json";
  private githubTimer?: number;

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    await this.loadLearningData();
    this.scheduleGitHubSync();
    this.registerView(VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    this.addRibbonIcon("activity", "Открыть VaultScope", () => this.openDashboard());
    this.addCommand({ id: "open-dashboard", name: "Открыть панель", callback: () => this.openDashboard() });
    this.addSettingTab(new VaultScopeSettingTab(this.app, this));
    this.stats = new StatsService(this.app, () => this.refreshDashboards());
    this.tasks = new TaskService(this.app, () => this.refreshDashboards());
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on("create", (file) => this.stats?.onCreate(file)));
      this.registerEvent(this.app.vault.on("modify", (file) => this.stats?.onModify(file)));
      this.registerEvent(this.app.vault.on("delete", (file) => this.stats?.onDelete(file)));
      this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.stats?.onRename(file, oldPath)));
      this.registerEvent(this.app.vault.on("create", (file) => this.tasks?.onCreate(file)));
      this.registerEvent(this.app.vault.on("modify", (file) => this.tasks?.onModify(file)));
      this.registerEvent(this.app.vault.on("delete", (file) => this.tasks?.onDelete(file)));
      this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.tasks?.onRename(file, oldPath)));
      this.registerEvent(this.app.metadataCache.on("changed", (file: TFile) => this.stats?.onMetadataChanged(file)));
      void this.stats?.start();
      void this.tasks?.start();
    });
  }

  onunload(): void {
    if (this.githubTimer !== undefined) window.clearInterval(this.githubTimer);
    void this.stats?.flush();
  }

  refreshDashboards(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof DashboardView) leaf.view.refresh();
    }
  }

  async openDashboard(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizeSettings(this.settings);
    await this.saveData(this.settings);
    this.scheduleGitHubSync();
    this.refreshDashboards();
  }

  private async loadLearningData(): Promise<void> {
    let file = this.app.vault.getAbstractFileByPath(this.learningDataPath);
    if (!(file instanceof TFile)) {
      const legacyFile = this.app.vault.getAbstractFileByPath("Vault Pulse/learning.json");
      if (!(legacyFile instanceof TFile)) { this.learningCourses = []; return; }
      try {
        const legacyContent = await this.app.vault.read(legacyFile);
        const parsed: unknown = JSON.parse(legacyContent);
        await this.ensureParentFolder(this.learningDataPath);
        file = await this.app.vault.create(this.learningDataPath, legacyContent);
        this.learningCourses = normalizeLearningCourses(parsed);
        await this.app.fileManager.trashFile(legacyFile);
        const legacyFolder = this.app.vault.getAbstractFileByPath("Vault Pulse");
        if (legacyFolder instanceof TFolder && legacyFolder.children.length === 0) await this.app.fileManager.trashFile(legacyFolder);
      } catch {
        new Notice("Не удалось перенести старые данные обучения в папку VaultScope. Исходный файл сохранён.");
        this.learningCourses = [];
        return;
      }
    }
    if (!(file instanceof TFile)) { this.learningCourses = []; return; }
    try {
      const content = await this.app.vault.read(file);
      const parsed: unknown = JSON.parse(content);
      this.learningCourses = normalizeLearningCourses(parsed);
    } catch {
      new Notice("Не удалось прочитать VaultScope/learning.json. Файл оставлен без изменений.");
      this.learningCourses = [];
    }
  }

  async saveLearningCourse(input: LearningCourseInput, existing?: LearningCourse): Promise<void> {
    const course: LearningCourse = {
      ...input,
      id: existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      updatedAt: new Date().toISOString(),
    };
    this.learningCourses = existing
      ? this.learningCourses.map((item) => item.id === existing.id ? course : item)
      : [course, ...this.learningCourses];
    await this.writeLearningData();
  }

  async deleteLearningCourse(course: LearningCourse): Promise<void> {
    this.learningCourses = this.learningCourses.filter((item) => item.id !== course.id);
    await this.writeLearningData();
  }

  private async writeLearningData(): Promise<void> {
    await this.ensureParentFolder(this.learningDataPath);
    const file = this.app.vault.getAbstractFileByPath(this.learningDataPath);
    const content = `${JSON.stringify(this.learningCourses, null, 2)}\n`;
    if (file instanceof TFile) await this.app.vault.modify(file, content);
    else await this.app.vault.create(this.learningDataPath, content);
    this.refreshDashboards();
  }

  private scheduleGitHubSync(): void {
    if (this.githubTimer !== undefined) window.clearInterval(this.githubTimer);
    this.githubTimer = undefined;
    const minutes = this.settings.githubSyncMinutes;
    if (minutes > 0 && this.settings.githubRepositories.length) {
      this.githubTimer = this.registerInterval(window.setInterval(() => { void this.syncGitHub(); }, minutes * 60_000));
    }
  }

  async syncGitHub(): Promise<void> {
    if (this.githubSyncing) return;
    const repos = this.settings.githubRepositories;
    if (!repos.length) { this.githubStatus = "Добавьте хотя бы один репозиторий в настройках."; this.refreshDashboards(); return; }
    this.githubSyncing = true;
    this.githubStatus = "Загружаю коммиты из GitHub…";
    this.refreshDashboards();
    try {
      // Keep a full year for the GitHub contribution calendar; the dashboard
      // still limits the commit list to the selected period.
      const rangeEnd = new Date();
      const rangeStart = new Date(rangeEnd);
      rangeStart.setHours(0, 0, 0, 0);
      rangeStart.setDate(rangeStart.getDate() - 364);
      const token = this.settings.githubSecretId ? this.app.secretStorage.getSecret(this.settings.githubSecretId) : null;
      const results = await Promise.all(repos.map(async (repo) => {
        try {
          return { repo, commits: await fetchRepositoryCommits(repo, rangeStart, rangeEnd, token), error: "" };
        } catch (error: unknown) {
          const message = error instanceof GitHubEmptyRepositoryError
            ? error.message
            : error instanceof Error ? error.message : String(error);
          return { repo, commits: [] as GitHubCommit[], error: message };
        }
      }));
      const commits: GitHubCommit[] = [];
      const repositoryErrors: string[] = [];
      for (const result of results) {
        if (result.error) repositoryErrors.push(`${result.repo}: ${result.error}`);
        for (const commit of result.commits) commits.push(commit);
      }
      this.githubCommits = commits.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      const updatedAt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date());
      const failures = repositoryErrors.length ? ` Ошибки репозиториев: ${repositoryErrors.join("; ")}.` : "";
      this.githubStatus = `Обновлено: ${updatedAt}. Загружено коммитов: ${this.githubCommits.length}.${failures}`;
    } catch (error: unknown) {
      this.githubStatus = error instanceof Error ? error.message : "Не удалось получить данные GitHub.";
    } finally {
      this.githubSyncing = false;
      this.refreshDashboards();
    }
  }

  async connectGitHubAccount(): Promise<void> {
    const token = this.settings.githubSecretId ? this.app.secretStorage.getSecret(this.settings.githubSecretId) : null;
    if (!token) {
      this.githubStatus = "Сначала добавьте GitHub token в SecretStorage.";
      this.refreshDashboards();
      return;
    }
    this.githubSyncing = true;
    this.githubStatus = "Подключаю GitHub аккаунт и загружаю доступные репозитории…";
    this.refreshDashboards();
    try {
      const account = await fetchGitHubAccount(token);
      this.settings.githubAccount = account.login;
      this.githubAvailableRepositories = account.repositories;
      await this.saveSettings();
      this.githubStatus = `Аккаунт @${account.login} подключён. Доступно репозиториев: ${account.repositories.length}.`;
    } catch (error: unknown) {
      this.githubStatus = error instanceof Error ? error.message : "Не удалось подключить GitHub аккаунт.";
    } finally {
      this.githubSyncing = false;
      this.refreshDashboards();
    }
  }

  async prepareDailyNote(): Promise<void> {
    const today = new Date();
    const path = buildDailyPath(this.settings.dailyFolder, this.settings.dailyDateFormat, today);
    const abstract = this.app.vault.getAbstractFileByPath(path);
    if (abstract && !(abstract instanceof TFile)) {
      new Notice(`Путь ${path} занят папкой.`);
      return;
    }
    const file = abstract instanceof TFile ? abstract : null;
    const original = file ? await this.app.vault.read(file) : "";
    const content = buildDailyContent(today, this.settings.dailyBlocks, this.stats?.getSnapshot().events ?? [], original);
    const preview = new DailyNotePreviewModal(this.app, this.app.vault, path, file, original, content.content, content.appendedTitles,
      (savedFile) => { void this.app.workspace.getLeaf(false).openFile(savedFile); });
    preview.open();
  }

  async preparePeriodPlan(period: PlanningPeriod, folderFilter = "*", tagFilter = "*"): Promise<void> {
    const info = getPeriodInfo(period, new Date(), this.settings.weekStartsMonday);
    const folder = period === "week" ? this.settings.weeklyFolder : period === "month" ? this.settings.monthlyFolder : this.settings.yearlyFolder;
    const format = period === "week" ? this.settings.weeklyFormat : period === "month" ? this.settings.monthlyFormat : this.settings.yearlyFormat;
    const template = period === "week" ? this.settings.weeklyTemplate : period === "month" ? this.settings.monthlyTemplate : this.settings.yearlyTemplate;
    const path = buildPeriodPath(folder, format, info);
    const abstract = this.app.vault.getAbstractFileByPath(path);
    if (abstract && !(abstract instanceof TFile)) { new Notice(`Путь ${path} занят папкой.`); return; }
    const file = abstract instanceof TFile ? abstract : null;
    const original = file ? await this.app.vault.read(file) : "";
    const snapshot = this.stats?.getSnapshot();
    const excludedFolders = this.settings.excludedFolders.map((item) => item.replace(/\\/g, "/").replace(/\/$/, ""));
    const excludedTags = this.settings.excludedTags.map((item) => item.startsWith("#") ? item : `#${item}`);
    const include = (item: { folder: string; tags: string[] }) => !excludedFolders.some((folder) => item.folder === folder || item.folder.startsWith(`${folder}/`))
      && !item.tags.some((tag) => excludedTags.includes(tag))
      && (folderFilter === "*" || item.folder === folderFilter)
      && (tagFilter === "*" || item.tags.includes(tagFilter));
    const periodEvents = (snapshot?.events ?? []).filter(include);
    const periodTasks = (this.tasks?.getTasks() ?? []).filter((task) => include({ folder: folderOf(task.path), tags: task.tags }));
    const periodNotes = (snapshot?.notes ?? []).filter(include);
    const rendered = renderPeriodTemplate(template, info, periodEvents, periodTasks, periodNotes);
    const merged = mergePeriodReview(original, rendered);
    new PeriodPlanPreviewModal(this.app, this.app.vault, path, file, original, merged.content, merged.added,
      (savedFile) => { void this.app.workspace.getLeaf(false).openFile(savedFile); }).open();
  }

  addTask(): void {
    const targetPath = this.settings.taskDestination === "daily"
      ? buildDailyPath(this.settings.dailyFolder, this.settings.dailyDateFormat)
      : this.taskFilePath();
    new NewTaskModal(this.app, targetPath, (task) => this.saveTask(targetPath, task)).open();
  }

  async addScheduleEvent(): Promise<void> {
    const path = buildDailyPath(this.settings.dailyFolder, this.settings.dailyDateFormat);
    const abstract = this.app.vault.getAbstractFileByPath(path);
    if (abstract && !(abstract instanceof TFile)) throw new Error(`Путь ${path} занят папкой.`);
    const content = abstract instanceof TFile ? await this.app.vault.cachedRead(abstract) : "";
    const existing = parseScheduleEvents(content, this.settings.scheduleSlotMinutes);
    const start = this.settings.scheduleStart;
    const startMinute = timeToMinutes(start);
    const endMinute = Math.min(startMinute + this.settings.scheduleSlotMinutes, 23 * 60 + 59);
    const end = `${String(Math.floor(endMinute / 60)).padStart(2, "0")}:${String(endMinute % 60).padStart(2, "0")}`;
    new NewScheduleEventModal(this.app, path, this.tasks?.getTasks() ?? [], existing, start, end,
      (event) => this.saveScheduleEvent(path, event)).open();
  }

  async rolloverYesterdayTasks(): Promise<void> {
    if (!this.settings.rolloverTasks) return;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const sourcePath = buildDailyPath(this.settings.dailyFolder, this.settings.dailyDateFormat, yesterday);
    const targetPath = buildDailyPath(this.settings.dailyFolder, this.settings.dailyDateFormat, new Date());
    if (sourcePath === targetPath) { new Notice("Формат имени дневных заметок должен различать даты для переноса задач."); return; }
    const source = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(source instanceof TFile)) { new Notice(`Вчерашняя дневная заметка не найдена: ${sourcePath}`); return; }
    const content = await this.app.vault.cachedRead(source);
    const tasks = parseTasks(source.path, content).filter((task) => !task.completed);
    if (!tasks.length) { new Notice("Во вчерашней дневной заметке нет незавершённых задач."); return; }
    new TaskRolloverModal(this.app, sourcePath, targetPath, tasks, (selected) => this.moveTasks(source, targetPath, selected)).open();
  }

  private async moveTasks(source: TFile, targetPath: string, tasks: TaskRecord[]): Promise<void> {
    const target = this.app.vault.getAbstractFileByPath(targetPath);
    if (target && !(target instanceof TFile)) throw new Error(`Путь ${targetPath} занят папкой.`);
    const targetLines = tasks.map((task) => task.rawLine);
    if (target instanceof TFile) {
      await this.app.vault.process(target, (content) => {
        let updated = content;
        for (const line of targetLines) {
          const alreadyPresent = parseTasks(targetPath, updated).some((task) => task.rawLine === line && !task.completed);
          if (!alreadyPresent) updated = appendTaskToSection(updated, "План дня", line.trim());
        }
        return updated;
      });
    } else {
      let content = buildDailyContent(new Date(), this.settings.dailyBlocks, this.stats?.getSnapshot().events ?? []).content;
      for (const line of targetLines) content = appendTaskToSection(content, "План дня", line.trim());
      await this.ensureParentFolder(targetPath);
      if (this.app.vault.getAbstractFileByPath(targetPath)) throw new Error(`Файл ${targetPath} уже существует. Повторите перенос.`);
      await this.app.vault.create(targetPath, content);
    }

    let stale = false;
    const selected = new Set(tasks.map((task) => task.id));
    await this.app.vault.process(source, (content) => {
      const lines = content.split(/\r?\n/);
      const ordered = [...tasks].sort((a, b) => b.line - a.line);
      for (const task of ordered) {
        if (!selected.has(task.id) || lines[task.line] !== task.rawLine) { stale = true; break; }
        lines.splice(task.line, 1);
      }
      return stale ? content : lines.join(content.includes("\r\n") ? "\r\n" : "\n");
    });
    if (stale) new Notice("Задачи скопированы в сегодняшнюю заметку, но исходник изменился и строки не удалены. Проверьте обе заметки.");
  }

  private async saveScheduleEvent(path: string, event: NewScheduleEvent): Promise<void> {
    const line = formatScheduleLine(event);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing && !(existing instanceof TFile)) throw new Error(`Путь ${path} занят папкой.`);
    if (existing instanceof TFile) {
      await this.app.vault.process(existing, (content) => appendTaskToSection(content, "События", line));
      return;
    }
    let content = buildDailyContent(new Date(), this.settings.dailyBlocks, this.stats?.getSnapshot().events ?? []).content;
    content = appendTaskToSection(content, "События", line);
    await this.ensureParentFolder(path);
    if (this.app.vault.getAbstractFileByPath(path)) throw new Error(`Файл ${path} уже существует. Повторите попытку.`);
    await this.app.vault.create(path, content);
  }

  private taskFilePath(): string {
    const configured = normalizePath(this.settings.taskFilePath.trim().replace(/\\/g, "/").replace(/^\/+/, ""));
    if (!configured) return DEFAULT_SETTINGS.taskFilePath;
    return configured.toLowerCase().endsWith(".md") ? configured : `${configured}.md`;
  }

  private async saveTask(path: string, task: NewTaskData): Promise<void> {
    const line = buildTaskLine(task);
    const dailyTarget = this.settings.taskDestination === "daily";
    const section = dailyTarget ? "План дня" : "Задачи";
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing && !(existing instanceof TFile)) throw new Error(`Путь ${path} занят папкой.`);
    if (existing instanceof TFile) {
      await this.app.vault.process(existing, (content) => appendTaskToSection(content, section, line));
      return;
    }
    let content: string;
    if (dailyTarget) {
      content = buildDailyContent(new Date(), this.settings.dailyBlocks, this.stats?.getSnapshot().events ?? []).content;
    } else {
      content = "---\ntype: task-list\n---\n\n# Задачи\n";
    }
    content = appendTaskToSection(content, section, line);
    await this.ensureParentFolder(path);
    if (this.app.vault.getAbstractFileByPath(path)) throw new Error(`Файл ${path} уже существует. Повторите попытку, чтобы добавить задачу в него.`);
    await this.app.vault.create(path, content);
  }

  private async ensureParentFolder(path: string): Promise<void> {
    const parent = path.split("/").slice(0, -1).join("/");
    if (!parent) return;
    let current = "";
    for (const segment of parent.split("/")) {
      current = current ? `${current}/${segment}` : segment;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing && !(existing instanceof TFolder)) throw new Error(`Папка ${current} занята файлом.`);
      if (!existing) await this.app.vault.createFolder(current);
    }
  }
}
