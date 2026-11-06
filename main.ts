import {
  ItemView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  normalizePath,
  SecretComponent,
  setIcon,
  WorkspaceLeaf,
} from "obsidian";
import { ActivityClassification, ActivityEvent, NoteRecord, StatsPeriod, StatsService, eventInPeriod, findActivityBursts, getDateRange } from "./stats";
import { DAILY_BLOCKS, DailyBlockId, DailyNotePreviewModal, buildDailyContent, buildDailyPath, dailyDateKey, parseDailySummary } from "./daily";
import { NewTaskData, NewTaskModal, TaskPriority, TaskRecord, TaskService, TaskRolloverModal, buildTaskLine, compareTaskPriority, parseTasks } from "./tasks";
import { NewScheduleEvent, NewScheduleEventModal, ScheduleEvent, eventsOverlap, formatScheduleLine, parseScheduleEvents, timeToMinutes } from "./schedule";
import { DEFAULT_PERIOD_TEMPLATES, PeriodPlanPreviewModal, PlanningPeriod, buildPeriodPath, getPeriodInfo, mergePeriodReview, renderPeriodTemplate } from "./planning";
import { GitHubCommit, fetchRepositoryCommits, normalizeRepository } from "./github";
import { DeleteLearningCourseModal, LearningCourse, LearningCourseInput, LearningCourseModal, LearningPlatform, normalizeLearningCourses } from "./learning";

const VIEW_TYPE = "vault-pulse-dashboard";

type Period = "day" | "week" | "month" | "year";
type Density = "comfortable" | "compact";
type PanelStyle = "mac" | "minimal" | "outlined";
type ChartStyle = "bars" | "line" | "area";
type AccentPalette = "system" | "obsidianite" | "ocean" | "violet" | "mint" | "sunset";
type PanelId = "summary" | "activity" | "folders" | "tasks" | "today" | "schedule" | "planning" | "github" | "learning";
type TaskDestination = "daily" | "file";
type TaskGrouping = "due" | "priority" | "folder";
type DashboardSection = "overview" | "day" | "planning" | "github" | "learning";

interface PanelDefinition {
  id: PanelId;
  title: string;
  description: string;
}

const PANELS: PanelDefinition[] = [
  { id: "summary", title: "Коротко", description: "Основные показатели за выбранный период." },
  { id: "activity", title: "Активность", description: "Как менялось хранилище со временем." },
  { id: "folders", title: "Хранилище", description: "Распределение заметок по папкам и тегам." },
  { id: "tasks", title: "Задачи", description: "Открытые, просроченные и выполненные задачи." },
  { id: "today", title: "Сегодня", description: "Активность заметок, дневная запись и события." },
  { id: "schedule", title: "Расписание", description: "Занятые интервалы и свободное время." },
  { id: "planning", title: "Планы периода", description: "Недельные, месячные и годовые цели и обзоры." },
  { id: "github", title: "GitHub", description: "Коммиты выбранных репозиториев за период." },
  { id: "learning", title: "Обучение", description: "Курсы и прогресс обучения." },
];

interface VaultPulseSettings {
  period: Period;
  density: Density;
  panelStyle: PanelStyle;
  chartStyle: ChartStyle;
  accentPalette: AccentPalette;
  panelOrder: PanelId[];
  hiddenPanels: PanelId[];
  excludedFolders: string[];
  excludedTags: string[];
  dailyFolder: string;
  dailyDateFormat: string;
  dailyBlocks: DailyBlockId[];
  taskDestination: TaskDestination;
  taskFilePath: string;
  taskGrouping: TaskGrouping;
  showCompletedTasks: boolean;
  taskDisplayLimit: number;
  scheduleStart: string;
  scheduleEnd: string;
  scheduleSlotMinutes: number;
  weekStartsMonday: boolean;
  timeFormat: "24h" | "12h";
  rolloverTasks: boolean;
  planningDefaultPeriod: PlanningPeriod;
  weeklyFolder: string;
  weeklyFormat: string;
  weeklyTemplate: string;
  monthlyFolder: string;
  monthlyFormat: string;
  monthlyTemplate: string;
  yearlyFolder: string;
  yearlyFormat: string;
  yearlyTemplate: string;
  githubRepositories: string[];
  githubSecretId: string;
  githubSyncMinutes: number;
  learningStepikEnabled: boolean;
  learningUdemyEnabled: boolean;
  learningOtherEnabled: boolean;
}

const DEFAULT_SETTINGS: VaultPulseSettings = {
  period: "day",
  density: "comfortable",
  panelStyle: "mac",
  chartStyle: "bars",
  accentPalette: "system",
  panelOrder: ["summary", "activity", "folders", "tasks", "today", "schedule", "planning", "github", "learning"],
  hiddenPanels: [],
  excludedFolders: [],
  excludedTags: [],
  dailyFolder: "Планирование/Дни",
  dailyDateFormat: "YYYY-MM-DD",
  dailyBlocks: ["plan", "events", "activity", "completed", "review"],
  taskDestination: "daily",
  taskFilePath: "Планирование/Задачи.md",
  taskGrouping: "due",
  showCompletedTasks: true,
  taskDisplayLimit: 5,
  scheduleStart: "09:00",
  scheduleEnd: "17:00",
  scheduleSlotMinutes: 30,
  weekStartsMonday: true,
  timeFormat: "24h",
  rolloverTasks: true,
  planningDefaultPeriod: "week",
  weeklyFolder: "Планирование/Недели",
  weeklyFormat: "YYYY-[W]WW",
  weeklyTemplate: DEFAULT_PERIOD_TEMPLATES.week,
  monthlyFolder: "Планирование/Месяцы",
  monthlyFormat: "YYYY-MM",
  monthlyTemplate: DEFAULT_PERIOD_TEMPLATES.month,
  yearlyFolder: "Планирование/Годы",
  yearlyFormat: "YYYY",
  yearlyTemplate: DEFAULT_PERIOD_TEMPLATES.year,
  githubRepositories: [],
  githubSecretId: "",
  githubSyncMinutes: 0,
  learningStepikEnabled: true,
  learningUdemyEnabled: true,
  learningOtherEnabled: true,
};

export default class VaultPulsePlugin extends Plugin {
  settings: VaultPulseSettings = DEFAULT_SETTINGS;
  stats?: StatsService;
  tasks?: TaskService;
  githubCommits: GitHubCommit[] = [];
  githubStatus = "Синхронизация ещё не запускалась.";
  githubSyncing = false;
  learningCourses: LearningCourse[] = [];
  private learningDataPath = "Vault Pulse/learning.json";
  private githubTimer?: number;

  async onload(): Promise<void> {
    this.settings = this.normalizeSettings(await this.loadData());
    await this.loadLearningData();
    this.scheduleGitHubSync();
    this.registerView(VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    this.addRibbonIcon("activity", "Открыть Vault Pulse", () => this.openDashboard());
    this.addCommand({ id: "open-dashboard", name: "Открыть панель", callback: () => this.openDashboard() });
    this.addSettingTab(new VaultPulseSettingTab(this.app, this));
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
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  refreshDashboards(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      (leaf.view as DashboardView).refresh();
    }
  }

  async openDashboard(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  async saveSettings(): Promise<void> {
    this.settings = this.normalizeSettings(this.settings);
    await this.saveData(this.settings);
    this.scheduleGitHubSync();
    this.refreshDashboards();
  }

  private normalizeSettings(value: Partial<VaultPulseSettings> | null): VaultPulseSettings {
    const input = value ?? {};
    const validTime = (value: unknown): value is string => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
    const scheduleStart = validTime(input.scheduleStart) ? input.scheduleStart : DEFAULT_SETTINGS.scheduleStart;
    const requestedEnd = validTime(input.scheduleEnd) ? input.scheduleEnd : DEFAULT_SETTINGS.scheduleEnd;
    const scheduleEnd = timeToMinutes(requestedEnd) > timeToMinutes(scheduleStart) ? requestedEnd : DEFAULT_SETTINGS.scheduleEnd;
    const panelOrder = Array.isArray(input.panelOrder)
      ? [...input.panelOrder.filter((id): id is PanelId => PANELS.some((panel) => panel.id === id))]
      : [];
    for (const panel of PANELS) if (!panelOrder.includes(panel.id)) panelOrder.push(panel.id);
    const hiddenPanels = Array.isArray(input.hiddenPanels)
      ? input.hiddenPanels.filter((id): id is PanelId => PANELS.some((panel) => panel.id === id))
      : [];
    const periods: Period[] = ["day", "week", "month", "year"];
    return {
      period: periods.includes(input.period as Period) ? input.period as Period : DEFAULT_SETTINGS.period,
      density: input.density === "compact" ? "compact" : "comfortable",
      panelStyle: input.panelStyle === "minimal" || input.panelStyle === "outlined" ? input.panelStyle : "mac",
      chartStyle: input.chartStyle === "line" || input.chartStyle === "area" ? input.chartStyle : "bars",
      accentPalette: input.accentPalette === "obsidianite" || input.accentPalette === "ocean" || input.accentPalette === "violet" || input.accentPalette === "mint" || input.accentPalette === "sunset"
        ? input.accentPalette : "system",
      panelOrder,
      hiddenPanels,
      excludedFolders: Array.isArray(input.excludedFolders) ? input.excludedFolders.filter((item) => typeof item === "string") : [],
      excludedTags: Array.isArray(input.excludedTags) ? input.excludedTags.filter((item) => typeof item === "string") : [],
      dailyFolder: typeof input.dailyFolder === "string" ? input.dailyFolder : DEFAULT_SETTINGS.dailyFolder,
      dailyDateFormat: typeof input.dailyDateFormat === "string" && input.dailyDateFormat ? input.dailyDateFormat : DEFAULT_SETTINGS.dailyDateFormat,
      dailyBlocks: Array.isArray(input.dailyBlocks)
        ? [...new Set(input.dailyBlocks.filter((id): id is DailyBlockId => DAILY_BLOCKS.some((block) => block.id === id)))]
        : [...DEFAULT_SETTINGS.dailyBlocks],
      taskDestination: input.taskDestination === "file" ? "file" : "daily",
      taskFilePath: typeof input.taskFilePath === "string" ? input.taskFilePath : DEFAULT_SETTINGS.taskFilePath,
      taskGrouping: input.taskGrouping === "priority" || input.taskGrouping === "folder" ? input.taskGrouping : "due",
      showCompletedTasks: input.showCompletedTasks !== false,
      taskDisplayLimit: [3, 5, 10, 0].includes(input.taskDisplayLimit as number) ? input.taskDisplayLimit as number : DEFAULT_SETTINGS.taskDisplayLimit,
      scheduleStart,
      scheduleEnd,
      scheduleSlotMinutes: [15, 30, 60].includes(input.scheduleSlotMinutes as number) ? input.scheduleSlotMinutes as number : DEFAULT_SETTINGS.scheduleSlotMinutes,
      weekStartsMonday: input.weekStartsMonday !== false,
      timeFormat: input.timeFormat === "12h" ? "12h" : "24h",
      rolloverTasks: input.rolloverTasks !== false,
      planningDefaultPeriod: input.planningDefaultPeriod === "month" || input.planningDefaultPeriod === "year" ? input.planningDefaultPeriod : "week",
      weeklyFolder: typeof input.weeklyFolder === "string" ? input.weeklyFolder : DEFAULT_SETTINGS.weeklyFolder,
      weeklyFormat: typeof input.weeklyFormat === "string" && input.weeklyFormat ? input.weeklyFormat : DEFAULT_SETTINGS.weeklyFormat,
      weeklyTemplate: typeof input.weeklyTemplate === "string" && input.weeklyTemplate ? input.weeklyTemplate : DEFAULT_SETTINGS.weeklyTemplate,
      monthlyFolder: typeof input.monthlyFolder === "string" ? input.monthlyFolder : DEFAULT_SETTINGS.monthlyFolder,
      monthlyFormat: typeof input.monthlyFormat === "string" && input.monthlyFormat ? input.monthlyFormat : DEFAULT_SETTINGS.monthlyFormat,
      monthlyTemplate: typeof input.monthlyTemplate === "string" && input.monthlyTemplate ? input.monthlyTemplate : DEFAULT_SETTINGS.monthlyTemplate,
      yearlyFolder: typeof input.yearlyFolder === "string" ? input.yearlyFolder : DEFAULT_SETTINGS.yearlyFolder,
      yearlyFormat: typeof input.yearlyFormat === "string" && input.yearlyFormat ? input.yearlyFormat : DEFAULT_SETTINGS.yearlyFormat,
      yearlyTemplate: typeof input.yearlyTemplate === "string" && input.yearlyTemplate ? input.yearlyTemplate : DEFAULT_SETTINGS.yearlyTemplate,
      githubRepositories: Array.isArray(input.githubRepositories)
        ? [...new Set(input.githubRepositories.map((repo) => typeof repo === "string" ? normalizeRepository(repo) : null).filter((repo): repo is string => repo !== null))]
        : [],
      githubSecretId: typeof input.githubSecretId === "string" ? input.githubSecretId : "",
      githubSyncMinutes: [0, 15, 60, 1440].includes(input.githubSyncMinutes as number) ? input.githubSyncMinutes as number : 0,
      learningStepikEnabled: input.learningStepikEnabled !== false,
      learningUdemyEnabled: input.learningUdemyEnabled !== false,
      learningOtherEnabled: input.learningOtherEnabled !== false,
    };
  }

  private async loadLearningData(): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.learningDataPath);
    if (!(file instanceof TFile)) { this.learningCourses = []; return; }
    try {
      this.learningCourses = normalizeLearningCourses(JSON.parse(await this.app.vault.read(file)));
    } catch {
      new Notice("Не удалось прочитать Vault Pulse/learning.json. Файл оставлен без изменений.");
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
      const range = getDateRange(this.settings.period, new Date(), this.settings.weekStartsMonday);
      const token = this.settings.githubSecretId ? this.app.secretStorage.getSecret(this.settings.githubSecretId) : null;
      const results = await Promise.all(repos.map((repo) => fetchRepositoryCommits(repo, range.start, range.end, token)));
      this.githubCommits = results.flat().sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      this.githubStatus = `Обновлено: ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date())}. Коммитов: ${this.githubCommits.length}.`;
    } catch (error) {
      this.githubStatus = error instanceof Error ? error.message : "Не удалось получить данные GitHub.";
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

class DashboardView extends ItemView {
  private selectedFolder = "*";
  private selectedTag = "*";
  private burstSelections = new Map<string, ActivityClassification | "">();
  private taskStatusFilter: "all" | "open" | "completed" = "all";
  private taskPriorityFilter: "all" | TaskPriority = "all";
  private planningPeriod: PlanningPeriod = "week";
  private dailySummary = { completedTasks: [] as string[], events: [] as string[] };
  private scheduleEvents: ScheduleEvent[] = [];
  private dailySummaryPath = "";
  private githubRepoFilter = "*";
  private githubAuthorFilter = "";
  private learningPlatformFilter: LearningPlatform | "all" = "all";
  private learningStatusFilter: "all" | "active" | "paused" | "completed" = "all";
  private activeSection: DashboardSection = "overview";

  constructor(leaf: WorkspaceLeaf, private plugin: VaultPulsePlugin) { super(leaf); this.planningPeriod = plugin.settings.planningDefaultPeriod; }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Vault Pulse"; }
  getIcon(): string { return "activity"; }

  async onOpen(): Promise<void> { this.refresh(); }

  refresh(): void {
    this.render();
    void this.loadDailySummary();
  }

  private async loadDailySummary(): Promise<void> {
    const path = buildDailyPath(this.plugin.settings.dailyFolder, this.plugin.settings.dailyDateFormat);
    this.dailySummaryPath = path;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      this.dailySummary = { completedTasks: [], events: [] };
      this.scheduleEvents = [];
      this.render();
      return;
    }
    try {
      const content = await this.app.vault.cachedRead(file);
      if (this.dailySummaryPath !== path) return;
      this.dailySummary = parseDailySummary(content);
      this.scheduleEvents = parseScheduleEvents(content, this.plugin.settings.scheduleSlotMinutes);
      this.render();
    } catch {
      // Keep the dashboard usable if the daily note is temporarily unavailable.
    }
  }

  render(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.removeClass("vp-density-comfortable", "vp-density-compact");
    root.addClass("vp-dashboard", `vp-density-${this.plugin.settings.density}`);
    root.setAttribute("data-panel-style", this.plugin.settings.panelStyle);
    root.setAttribute("data-accent", this.plugin.settings.accentPalette);
    const snapshot = this.plugin.stats?.getSnapshot();
    const notes = (snapshot?.notes ?? []).filter((note) => this.isIncluded(note));
    const folders = [...new Set(notes.map((note) => note.folder))].sort((a, b) => a.localeCompare(b));
    const tags = [...new Set(notes.flatMap((note) => note.tags))].sort((a, b) => a.localeCompare(b));
    if (!folders.includes(this.selectedFolder)) this.selectedFolder = "*";
    if (!tags.includes(this.selectedTag)) this.selectedTag = "*";
    const filteredNotes = notes.filter((note) => this.matchesSelectedFilters(note));
    const events = (snapshot?.events ?? []).filter((event) => this.isIncluded(event)
      && (this.selectedFolder === "*" || event.folder === this.selectedFolder)
      && (this.selectedTag === "*" || event.tags.includes(this.selectedTag)));

    const header = root.createDiv({ cls: "vp-header" });
    const heading = header.createDiv({ cls: "vp-heading" });
    heading.createEl("h1", { text: "Vault Pulse" });
    const sectionDescriptions: Record<DashboardSection, string> = {
      overview: "Активность, заметки и структура хранилища.",
      day: "Задачи, события и ближайшие дела.",
      planning: "Обзоры и цели на неделю, месяц и год.",
      github: "Коммиты выбранных репозиториев.",
      learning: "Курсы и ваш текущий прогресс.",
    };
    heading.createEl("p", { text: sectionDescriptions[this.activeSection], cls: "vp-subtitle" });

    const sections: { id: DashboardSection; label: string }[] = [
      { id: "overview", label: "Обзор" }, { id: "day", label: "Мой день" },
      { id: "planning", label: "Планы" }, { id: "learning", label: "Обучение" }, { id: "github", label: "GitHub" },
    ];
    const sectionIcons: Record<DashboardSection, string> = {
      overview: "chart-no-axes-combined", day: "calendar-check", planning: "notebook-pen",
      learning: "graduation-cap", github: "git-commit-horizontal",
    };
    const sectionNav = root.createDiv({ cls: "vp-section-nav", attr: { role: "tablist", "aria-label": "Разделы панели" } });
    for (const section of sections) {
      const button = sectionNav.createEl("button", { cls: "vp-section-tab", attr: { role: "tab", "aria-selected": String(this.activeSection === section.id) } });
      button.type = "button";
      if (this.activeSection === section.id) button.addClass("is-active");
      const icon = button.createSpan({ cls: "vp-section-icon", attr: { "aria-hidden": "true" } });
      setIcon(icon, sectionIcons[section.id]);
      button.createSpan({ text: section.label });
      button.addEventListener("click", () => { this.activeSection = section.id; this.render(); });
    }

    if (this.activeSection === "overview" || this.activeSection === "day" || this.activeSection === "github") {
      const periodBar = root.createDiv({ cls: "vp-period-bar" });
      periodBar.createEl("span", { text: "Период", cls: "vp-section-label" });
      const periodSwitch = periodBar.createDiv({ cls: "vp-period-switch", attr: { role: "group", "aria-label": "Период обзора" } });
      const periods: { id: Period; label: string }[] = [
        { id: "day", label: "День" }, { id: "week", label: "Неделя" },
        { id: "month", label: "Месяц" }, { id: "year", label: "Год" },
      ];
      for (const period of periods) {
        const button = periodSwitch.createEl("button", { text: period.label, cls: "vp-period-button" });
        button.type = "button";
        button.setAttribute("aria-pressed", String(this.plugin.settings.period === period.id));
        if (this.plugin.settings.period === period.id) button.addClass("is-active");
        button.addEventListener("click", async () => { this.plugin.settings.period = period.id; await this.plugin.saveSettings(); });
      }
    }

    if (this.activeSection === "overview" || this.activeSection === "day") {
      const filters = root.createDiv({ cls: "vp-filters" });
      filters.createEl("span", { text: "Фильтровать", cls: "vp-section-label" });
      this.addFilter(filters, "Все папки", this.selectedFolder, folders, (value) => { this.selectedFolder = value; this.render(); });
      this.addFilter(filters, "Все теги", this.selectedTag, tags, (value) => { this.selectedTag = value; this.render(); });
    }

    const grid = root.createDiv({ cls: "vp-grid" });
    const sectionPanels: Record<DashboardSection, PanelId[]> = {
      overview: ["summary", "activity", "folders"],
      day: ["today", "tasks", "schedule"],
      planning: ["planning"],
      github: ["github"],
      learning: ["learning"],
    };
    for (const id of this.plugin.settings.panelOrder) {
      if (this.plugin.settings.hiddenPanels.includes(id) || !sectionPanels[this.activeSection].includes(id)) continue;
      const panel = PANELS.find((item) => item.id === id);
      if (panel) this.renderPanel(grid, panel, snapshot, filteredNotes, events);
    }

    if (this.activeSection === "overview") {
      const footer = root.createDiv({ cls: "vp-footer" });
      footer.createSpan({ cls: "vp-status-dot" });
      footer.createSpan({ text: snapshot?.error
        ? `Ошибка статистики: ${snapshot.error}`
        : snapshot?.ready ? `Индекс обновлён · ${notes.length} заметок` : "Индексируем заметки…" });
    }
  }

  private addFilter(container: HTMLElement, label: string, current: string, options: string[], onChange: (value: string) => void): void {
    const select = container.createEl("select", { cls: "vp-filter-select", attr: { "aria-label": label } });
    select.createEl("option", { text: label, value: "*" });
    for (const option of options) select.createEl("option", { text: option, value: option });
    select.value = current;
    select.addEventListener("change", () => onChange(select.value));
  }

  private isIncluded(item: NoteRecord | ActivityEvent): boolean {
    const folders = this.plugin.settings.excludedFolders.map((folder) => folder.replace(/\\/g, "/").replace(/\/$/, ""));
    const tags = this.plugin.settings.excludedTags.map((tag) => tag.startsWith("#") ? tag : `#${tag}`);
    return !folders.some((folder) => item.folder === folder || item.folder.startsWith(`${folder}/`))
      && !item.tags.some((tag) => tags.includes(tag));
  }

  private matchesSelectedFilters(note: NoteRecord): boolean {
    return (this.selectedFolder === "*" || note.folder === this.selectedFolder)
      && (this.selectedTag === "*" || note.tags.includes(this.selectedTag));
  }

  private isTaskIncluded(task: TaskRecord): boolean {
    const folder = folderOf(task.path);
    const excludedFolders = this.plugin.settings.excludedFolders.map((path) => path.replace(/\\/g, "/").replace(/\/$/, ""));
    const excludedTags = this.plugin.settings.excludedTags.map((tag) => tag.startsWith("#") ? tag : `#${tag}`);
    return !excludedFolders.some((path) => folder === path || folder.startsWith(`${path}/`))
      && !task.tags.some((tag) => excludedTags.includes(tag))
      && (this.selectedFolder === "*" || folder === this.selectedFolder)
      && (this.selectedTag === "*" || task.tags.includes(this.selectedTag));
  }

  private renderPanel(grid: HTMLElement, panel: PanelDefinition, snapshot: ReturnType<StatsService["getSnapshot"]> | undefined, notes: NoteRecord[], events: ActivityEvent[]): void {
    const card = grid.createDiv({ cls: `vp-card vp-card-${panel.id}` });
    const cardHeader = card.createDiv({ cls: "vp-card-header" });
    cardHeader.createEl("h2", { text: panel.title });
    cardHeader.createSpan({ text: panel.id === "tasks" ? "СПИСОК ДЕЛ" : panel.id === "today" ? "ДНЕВНАЯ СВОДКА" : panel.id === "schedule" ? "РАСПИСАНИЕ" : panel.id === "planning" ? "ПЛАНЫ ПЕРИОДА" : panel.id === "github" ? "ВНЕШНИЙ ИСТОЧНИК" : panel.id === "learning" ? "РУЧНОЙ УЧЁТ" : "ЛОКАЛЬНЫЕ ДАННЫЕ", cls: "vp-card-kicker" });
    const selectedEvents = events.filter((event) => eventInPeriod(event, this.plugin.settings.period, new Date(), this.plugin.settings.weekStartsMonday));
    if (panel.id === "summary") {
      card.createEl("p", { text: snapshot?.ready ? periodCaption(this.plugin.settings.period) : "Подготавливаем данные заметок…", cls: "vp-card-lead" });
      const stats = card.createDiv({ cls: "vp-stat-row" });
      const metrics: [string, string][] = [
        [String(selectedEvents.filter((event) => event.kind === "created").length), "Создано"],
        [String(selectedEvents.filter((event) => event.kind === "modified").length), "Изменено"],
        [String(notes.length), "Заметок в фильтре"],
        [String(notes.reduce((sum, note) => sum + note.links, 0)), "Ссылок и встраиваний"],
      ];
      for (const [value, label] of metrics) {
        const stat = stats.createDiv({ cls: "vp-stat" });
        stat.createEl("strong", { text: value });
        stat.createEl("span", { text: label });
      }
      card.createEl("p", { text: "Создание и изменение считаются по уникальным заметкам за день, чтобы автосохранение не раздувало показатели.", cls: "vp-helper" });
    } else if (panel.id === "activity") {
      card.createEl("p", { text: "Создание и изменения заметок по выбранному периоду.", cls: "vp-card-lead" });
      this.renderActivityChart(card, events);
      this.renderBurstControls(card, events);
    } else if (panel.id === "folders") {
      card.createEl("p", { text: panel.description, cls: "vp-card-lead" });
      this.renderBreakdown(card, notes, "folder");
      this.renderBreakdown(card, notes, "tag");
    } else if (panel.id === "tasks") {
      card.createEl("p", { text: panel.description, cls: "vp-card-lead" });
      this.renderTaskList(card);
    } else if (panel.id === "schedule") {
      card.createEl("p", { text: panel.description, cls: "vp-card-lead" });
      this.renderSchedule(card);
    } else if (panel.id === "planning") {
      card.createEl("p", { text: panel.description, cls: "vp-card-lead" });
      this.renderPlanning(card, events, notes);
    } else if (panel.id === "github") {
      this.renderGitHub(card);
    } else if (panel.id === "learning") {
      this.renderLearning(card);
    } else {
      this.renderTodayPanel(card, events);
    }
  }

  private renderGitHub(card: HTMLElement): void {
    const status = card.createEl("p", { text: this.plugin.githubStatus, cls: "vp-helper vp-github-status" });
    if (this.plugin.githubSyncing) status.addClass("is-loading");
    card.createEl("p", { text: `Период: ${periodCaption(this.plugin.settings.period)}. Данные загружаются только вручную или с настроенной частотой.`, cls: "vp-card-lead" });
    const actions = card.createDiv({ cls: "vp-github-actions" });
    const sync = actions.createEl("button", { text: this.plugin.githubSyncing ? "Загрузка…" : "Синхронизировать", cls: "vp-burst-save" });
    sync.type = "button";
    sync.disabled = this.plugin.githubSyncing;
    sync.addEventListener("click", () => { void this.plugin.syncGitHub(); });
    const repos = this.plugin.settings.githubRepositories;
    if (!repos.length) {
      card.createEl("p", { text: "Добавьте репозитории в настройках Vault Pulse, затем нажмите «Синхронизировать»." , cls: "vp-empty-state" });
      return;
    }
    const filters = card.createDiv({ cls: "vp-github-filters" });
    this.addFilter(filters, "Все репозитории", this.githubRepoFilter, repos, (value) => { this.githubRepoFilter = value; this.refresh(); });
    const author = filters.createEl("input", { cls: "vp-filter-select", attr: { type: "search", placeholder: "Фильтр по автору", "aria-label": "Фильтр коммитов по автору" } });
    author.value = this.githubAuthorFilter;
    author.addEventListener("change", () => { this.githubAuthorFilter = author.value; this.refresh(); });
    const commits = this.plugin.githubCommits.filter((commit) => (this.githubRepoFilter === "*" || commit.repo === this.githubRepoFilter)
      && (!this.githubAuthorFilter.trim() || commit.author.toLocaleLowerCase().includes(this.githubAuthorFilter.trim().toLocaleLowerCase())));
    if (!commits.length) {
      card.createEl("p", { text: "Коммитов по текущим фильтрам нет." , cls: "vp-empty-state" });
      return;
    }
    const list = card.createDiv({ cls: "vp-github-list" });
    for (const commit of commits.slice(0, 50)) {
      const row = list.createDiv({ cls: "vp-github-commit" });
      const title = row.createEl("a", { text: commit.message || "Без сообщения", href: commit.url, cls: "vp-github-message" });
      title.setAttribute("target", "_blank");
      title.setAttribute("rel", "noopener noreferrer");
      row.createEl("span", { text: `${commit.repo} · ${commit.author} · ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(commit.date))}`, cls: "vp-github-meta" });
    }
    if (commits.length > 50) card.createEl("p", { text: `Показаны первые 50 из ${commits.length}.`, cls: "vp-helper" });
  }

  private renderLearning(card: HTMLElement): void {
    const enabledPlatforms: LearningPlatform[] = [];
    if (this.plugin.settings.learningStepikEnabled) enabledPlatforms.push("stepik");
    if (this.plugin.settings.learningUdemyEnabled) enabledPlatforms.push("udemy");
    if (this.plugin.settings.learningOtherEnabled) enabledPlatforms.push("other");
    const platformNames: Record<LearningPlatform, string> = { stepik: "Stepik", udemy: "Udemy", other: "Другая платформа" };
    const statusNames = { active: "Прохожу", paused: "Пауза", completed: "Завершён" };
    const visibleCourses = this.plugin.learningCourses.filter((course) => enabledPlatforms.includes(course.platform));
    const add = card.createEl("button", { text: "＋ Добавить курс", cls: "vp-burst-save" });
    add.type = "button";
    add.disabled = enabledPlatforms.length === 0;
    add.addEventListener("click", () => {
      new LearningCourseModal(this.app, enabledPlatforms, (course) => this.plugin.saveLearningCourse(course)).open();
    });
    card.createEl("p", { text: "Прогресс вводится вручную. Записи хранятся в этом хранилище и не отправляются платформам.", cls: "vp-card-lead" });
    if (!enabledPlatforms.length) {
      card.createEl("p", { text: "Включите хотя бы одну платформу в настройках Vault Pulse.", cls: "vp-empty-state" });
      return;
    }
    const activeCount = visibleCourses.filter((course) => course.status === "active").length;
    const completedCount = visibleCourses.filter((course) => course.status === "completed").length;
    const averageProgress = visibleCourses.length
      ? Math.round(visibleCourses.reduce((sum, course) => sum + course.progress, 0) / visibleCourses.length)
      : 0;
    const metrics = card.createDiv({ cls: "vp-stat-row vp-learning-metrics" });
    this.addDailyCount(metrics, String(activeCount), "В процессе");
    this.addDailyCount(metrics, String(completedCount), "Завершено");
    this.addDailyCount(metrics, `${averageProgress}%`, "Средний прогресс");
    const filters = card.createDiv({ cls: "vp-learning-filters" });
    const platformSelect = filters.createEl("select", { cls: "vp-filter-select", attr: { "aria-label": "Фильтр платформы обучения" } });
    platformSelect.createEl("option", { text: "Все платформы", value: "all" });
    for (const platform of enabledPlatforms) platformSelect.createEl("option", { text: platformNames[platform], value: platform });
    if (this.learningPlatformFilter !== "all" && !enabledPlatforms.includes(this.learningPlatformFilter)) this.learningPlatformFilter = "all";
    platformSelect.value = this.learningPlatformFilter;
    platformSelect.addEventListener("change", () => { this.learningPlatformFilter = platformSelect.value as LearningPlatform | "all"; this.render(); });
    const statusSelect = filters.createEl("select", { cls: "vp-filter-select", attr: { "aria-label": "Фильтр статуса курса" } });
    statusSelect.createEl("option", { text: "Любой статус", value: "all" });
    for (const [value, label] of Object.entries(statusNames)) statusSelect.createEl("option", { text: label, value });
    statusSelect.value = this.learningStatusFilter;
    statusSelect.addEventListener("change", () => { this.learningStatusFilter = statusSelect.value as typeof this.learningStatusFilter; this.render(); });
    const courses = visibleCourses.filter((course) => (this.learningPlatformFilter === "all" || course.platform === this.learningPlatformFilter)
      && (this.learningStatusFilter === "all" || course.status === this.learningStatusFilter));
    if (!courses.length) {
      card.createEl("p", { text: visibleCourses.length ? "Курсов по выбранным фильтрам нет." : "Пока нет курсов. Добавьте первый, чтобы вести прогресс здесь.", cls: "vp-empty-state" });
      return;
    }
    const list = card.createDiv({ cls: "vp-learning-list" });
    for (const course of courses) {
      const row = list.createDiv({ cls: `vp-learning-course is-${course.status}` });
      const top = row.createDiv({ cls: "vp-learning-course-top" });
      const titleBox = top.createDiv({ cls: "vp-learning-title" });
      if (course.url) {
        const link = titleBox.createEl("a", { text: course.title, href: course.url, cls: "vp-learning-course-name" });
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
      } else titleBox.createEl("strong", { text: course.title, cls: "vp-learning-course-name" });
      titleBox.createSpan({ text: `${platformNames[course.platform]} · ${statusNames[course.status]}`, cls: "vp-learning-course-meta" });
      const progressValue = row.createDiv({ cls: "vp-learning-progress" });
      const progress = progressValue.createEl("progress", { attr: { max: "100", value: String(course.progress), "aria-label": `Прогресс курса ${course.title}` } });
      progress.value = course.progress;
      progressValue.createSpan({ text: `${course.progress}%`, cls: "vp-learning-progress-label" });
      if (course.nextStep) row.createEl("p", { text: `Следующий шаг: ${course.nextStep}`, cls: "vp-learning-next" });
      const actions = row.createDiv({ cls: "vp-learning-actions" });
      const edit = actions.createEl("button", { text: "Изменить", cls: "vp-learning-action" });
      edit.type = "button";
      edit.addEventListener("click", () => new LearningCourseModal(this.app, enabledPlatforms,
        (input, existing) => this.plugin.saveLearningCourse(input, existing), course).open());
      const remove = actions.createEl("button", { text: "Удалить", cls: "vp-learning-action is-danger" });
      remove.type = "button";
      remove.addEventListener("click", () => new DeleteLearningCourseModal(this.app, course, () => this.plugin.deleteLearningCourse(course)).open());
    }
  }

  private renderTodayPanel(card: HTMLElement, events: ActivityEvent[]): void {
    const key = dailyDateKey(new Date());
    const todayEvents = events.filter((event) => event.date === key).sort((a, b) => b.timestamp - a.timestamp);
    const dateLabel = new Intl.DateTimeFormat("ru-RU", { dateStyle: "full" }).format(new Date());
    card.createEl("p", { text: dateLabel, cls: "vp-card-lead" });
    const actionRow = card.createDiv({ cls: "vp-daily-actions" });
    const prepare = actionRow.createEl("button", { text: "Подготовить дневную заметку", cls: "vp-burst-save" });
    prepare.type = "button";
    prepare.addEventListener("click", () => { void this.plugin.prepareDailyNote(); });

    const counts = card.createDiv({ cls: "vp-daily-counts" });
    this.addDailyCount(counts, String(todayEvents.length), "Заметок сегодня");
    this.addDailyCount(counts, String(this.dailySummary.completedTasks.length), "Выполнено задач");
    this.addDailyCount(counts, String(this.dailySummary.events.length), "Событий в записи");

    if (todayEvents.length) {
      card.createEl("h3", { text: "Активность в заметках", cls: "vp-daily-heading" });
      const list = card.createDiv({ cls: "vp-today-activity" });
      const seen = new Set<string>();
      for (const event of todayEvents) {
        if (seen.has(event.path)) continue;
        seen.add(event.path);
        if (seen.size > 6) break;
        const item = list.createDiv({ cls: "vp-today-item" });
        const open = item.createEl("button", { text: event.path.replace(/\.md$/i, ""), cls: "vp-note-link" });
        open.type = "button";
        open.addEventListener("click", () => {
          const file = this.app.vault.getAbstractFileByPath(event.path);
          if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
        });
        item.createSpan({ text: event.kind === "created" ? "Создана" : "Изменена", cls: "vp-helper" });
      }
    }

    this.renderDailyList(card, "События", this.dailySummary.events);
    this.renderDailyList(card, "Выполненные задачи", this.dailySummary.completedTasks);
    if (todayEvents.length === 0 && this.dailySummary.events.length === 0 && this.dailySummary.completedTasks.length === 0) {
      card.createEl("p", { text: "Создайте дневную запись и добавьте в неё события, задачи или итоги.", cls: "vp-helper" });
    }
  }

  private renderTaskList(card: HTMLElement): void {
    const today = dailyDateKey(new Date());
    const allTasks = (this.plugin.tasks?.getTasks() ?? [])
      .filter((task) => this.isTaskIncluded(task))
      .filter((task) => this.taskStatusFilter === "all" || (this.taskStatusFilter === "completed" ? task.completed : !task.completed))
      .filter((task) => this.taskPriorityFilter === "all" || task.priority === this.taskPriorityFilter);
    const visible = this.plugin.settings.showCompletedTasks ? allTasks : allTasks.filter((task) => !task.completed);
    const overdueCount = visible.filter((task) => !task.completed && task.due !== null && task.due < today).length;
    const todayCount = visible.filter((task) => !task.completed && task.due === today).length;
    const section = card.createDiv({ cls: "vp-task-section" });
    const heading = section.createDiv({ cls: "vp-task-section-heading" });
    heading.createEl("h3", { text: "Задачи" });
    const add = heading.createEl("button", { text: "＋ Новая", cls: "vp-burst-save" });
    add.type = "button";
    add.addEventListener("click", () => this.plugin.addTask());
    const counts = section.createDiv({ cls: "vp-task-summary" });
    counts.createSpan({ text: `Просрочено: ${overdueCount}` });
    counts.createSpan({ text: `На сегодня: ${todayCount}` });

    const filters = section.createDiv({ cls: "vp-task-filters" });
    const status = filters.createEl("select", { cls: "vp-filter-select", attr: { "aria-label": "Фильтр состояния задач" } });
    status.createEl("option", { text: "Все задачи", value: "all" });
    status.createEl("option", { text: "Открытые", value: "open" });
    status.createEl("option", { text: "Выполненные", value: "completed" });
    status.value = this.taskStatusFilter;
    status.addEventListener("change", () => { this.taskStatusFilter = status.value as "all" | "open" | "completed"; this.render(); });
    const priority = filters.createEl("select", { cls: "vp-filter-select", attr: { "aria-label": "Фильтр приоритета задач" } });
    priority.createEl("option", { text: "Любой приоритет", value: "all" });
    const priorityOptions: [TaskPriority, string][] = [
      ["highest", "Срочный"], ["high", "Высокий"], ["normal", "Обычный"], ["low", "Низкий"], ["lowest", "Самый низкий"], ["none", "Без приоритета"],
    ];
    for (const [value, label] of priorityOptions) priority.createEl("option", { text: label, value });
    priority.value = this.taskPriorityFilter;
    priority.addEventListener("change", () => { this.taskPriorityFilter = priority.value as "all" | TaskPriority; this.render(); });
    if (this.plugin.settings.rolloverTasks) {
      const rollover = section.createEl("button", { text: "Перенести незавершённые задачи со вчера", cls: "vp-rollover-button" });
      rollover.type = "button";
      rollover.addEventListener("click", () => {
        void this.plugin.rolloverYesterdayTasks().catch((error: unknown) => new Notice(`Перенос не выполнен: ${error instanceof Error ? error.message : String(error)}`));
      });
    }

    if (visible.length === 0) {
      section.createEl("p", { text: "Задач по выбранным фильтрам не найдено.", cls: "vp-helper" });
      return;
    }
    const groups = new Map<string, TaskRecord[]>();
    for (const task of visible) {
      let group: string;
      if (this.plugin.settings.taskGrouping === "priority") group = task.completed ? "Выполнено" : priorityLabel(task.priority);
      else if (this.plugin.settings.taskGrouping === "folder") group = task.completed ? "Выполнено" : folderOf(task.path);
      else if (task.completed) group = "Выполнено";
      else if (task.due && task.due < today) group = "Просрочено";
      else if (task.due === today) group = "Сегодня";
      else if (task.due) group = "Позже";
      else group = "Без срока";
      const list = groups.get(group) ?? [];
      list.push(task);
      groups.set(group, list);
    }
    const defaultOrder = ["Просрочено", "Сегодня", "Позже", "Без срока", "Выполнено", "Срочный", "Высокий", "Обычный", "Низкий", "Самый низкий", "Без приоритета"];
    const ordered = [...groups.keys()].sort((a, b) => {
      const ai = defaultOrder.indexOf(a); const bi = defaultOrder.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 100 : ai) - (bi === -1 ? 100 : bi);
      return a.localeCompare(b);
    });
    for (const group of ordered) {
      const tasks = groups.get(group)!;
      tasks.sort((a, b) => {
        if (this.plugin.settings.taskGrouping === "priority") return compareTaskPriority(a, b);
        if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
        if (a.due && !b.due) return -1;
        if (!a.due && b.due) return 1;
        return compareTaskPriority(a, b);
      });
      const groupEl = section.createEl("details", { cls: "vp-task-group" });
      groupEl.open = group === "Просрочено" || group === "Сегодня";
      groupEl.createEl("summary", { text: `${group} · ${tasks.length}`, cls: "vp-task-group-summary" });
      const limit = this.plugin.settings.taskDisplayLimit;
      for (const task of limit === 0 ? tasks : tasks.slice(0, limit)) this.renderTask(groupEl, task);
    }
  }

  private renderTask(container: HTMLElement, task: TaskRecord): void {
    const row = container.createDiv({ cls: `vp-task-row${task.completed ? " is-completed" : ""}` });
    const checkbox = row.createEl("input", { attr: { type: "checkbox", "aria-label": task.completed ? "Отметить задачу невыполненной" : "Отметить задачу выполненной" } });
    checkbox.checked = task.completed;
    checkbox.addEventListener("change", () => { void this.plugin.tasks?.setCompleted(task, checkbox.checked); });
    const body = row.createDiv({ cls: "vp-task-body" });
    const title = body.createEl("button", { text: task.text || "(без названия)", cls: "vp-note-link" });
    title.type = "button";
    title.addEventListener("click", () => {
      const file = this.app.vault.getAbstractFileByPath(task.path);
      if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
    });
    const metadata: string[] = [];
    if (task.due) metadata.push(`Срок: ${task.due}`);
    if (task.priority !== "none") metadata.push(priorityLabel(task.priority));
    if (task.tags.length) metadata.push(task.tags.join(" "));
    if (metadata.length) body.createEl("span", { text: metadata.join(" · "), cls: "vp-task-meta" });
  }

  private renderSchedule(card: HTMLElement): void {
    const action = card.createDiv({ cls: "vp-schedule-actions" });
    const add = action.createEl("button", { text: "＋ Добавить событие", cls: "vp-burst-save" });
    add.type = "button";
    add.addEventListener("click", () => {
      void this.plugin.addScheduleEvent().catch((error: unknown) => new Notice(`Не удалось открыть форму: ${error instanceof Error ? error.message : String(error)}`));
    });
    card.createEl("p", { text: `Рабочее время ${this.formatTime(this.plugin.settings.scheduleStart)}–${this.formatTime(this.plugin.settings.scheduleEnd)} · шаг ${this.plugin.settings.scheduleSlotMinutes} мин.`, cls: "vp-helper" });
    if (this.scheduleEvents.length === 0) card.createEl("p", { text: "Записанных событий пока нет.", cls: "vp-helper" });
    const start = timeToMinutes(this.plugin.settings.scheduleStart);
    const end = timeToMinutes(this.plugin.settings.scheduleEnd);
    const step = this.plugin.settings.scheduleSlotMinutes;
    const timeline = card.createDiv({ cls: "vp-timeline" });
    for (let minute = start; minute < end; minute += step) {
      const slotEnd = Math.min(minute + step, end);
      const slotStartText = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      const slotEndText = `${String(Math.floor(slotEnd / 60)).padStart(2, "0")}:${String(slotEnd % 60).padStart(2, "0")}`;
      const overlapping = this.scheduleEvents.filter((event) => eventsOverlap({ start: slotStartText, end: slotEndText }, event));
      const row = timeline.createDiv({ cls: `vp-timeline-row${overlapping.length ? " is-busy" : " is-free"}` });
      row.createSpan({ text: this.formatTime(slotStartText), cls: "vp-timeline-time" });
      const content = row.createDiv({ cls: "vp-timeline-content" });
      if (!overlapping.length) content.createSpan({ text: "Свободно", cls: "vp-timeline-free" });
      const startingEvents = overlapping.filter((event) => timeToMinutes(event.start) >= minute && timeToMinutes(event.start) < slotEnd);
      for (const event of startingEvents) {
        const block = content.createDiv({ cls: "vp-timeline-event" });
        block.createEl("strong", { text: event.title });
        block.createSpan({ text: `${this.formatTime(event.start)}–${this.formatTime(event.end)}` });
        if (event.taskPath) block.createSpan({ text: `Задача: ${event.taskPath}`, cls: "vp-task-meta" });
      }
      if (overlapping.length && startingEvents.length === 0) content.createSpan({ text: "Занято", cls: "vp-timeline-occupied" });
    }
    const outside = this.scheduleEvents.filter((event) => timeToMinutes(event.start) < start || timeToMinutes(event.end) > end);
    if (outside.length) {
      const section = card.createDiv({ cls: "vp-schedule-outside" });
      section.createEl("h3", { text: "За пределами рабочего времени" });
      for (const event of outside) section.createEl("p", { text: `${this.formatTime(event.start)}–${this.formatTime(event.end)} · ${event.title}` });
    }
  }

  private formatTime(value: string): string {
    if (this.plugin.settings.timeFormat === "24h") return value;
    const [hourText, minute] = value.split(":");
    const hour = Number(hourText);
    return `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
  }

  private renderPlanning(card: HTMLElement, events: ActivityEvent[], notes: NoteRecord[]): void {
    const tabs = card.createDiv({ cls: "vp-period-switch vp-planning-switch", attr: { role: "group", "aria-label": "Период планирования" } });
    const periods: { id: PlanningPeriod; label: string }[] = [
      { id: "week", label: "Неделя" }, { id: "month", label: "Месяц" }, { id: "year", label: "Год" },
    ];
    for (const item of periods) {
      const button = tabs.createEl("button", { text: item.label, cls: "vp-period-button" });
      button.type = "button";
      if (this.planningPeriod === item.id) button.addClass("is-active");
      button.setAttribute("aria-pressed", String(this.planningPeriod === item.id));
      button.addEventListener("click", () => { this.planningPeriod = item.id; this.render(); });
    }
    const info = getPeriodInfo(this.planningPeriod, new Date(), this.plugin.settings.weekStartsMonday);
    const periodEvents = events.filter((event) => event.timestamp >= info.start.getTime() && event.timestamp <= info.end.getTime());
    const activeNotes = new Set(periodEvents.map((event) => event.path));
    const periodTasks = (this.plugin.tasks?.getTasks() ?? []).filter((task) => this.isTaskIncluded(task)
      && task.due !== null && task.due >= dateKeyForPlanning(info.start) && task.due <= dateKeyForPlanning(info.end));
    const folder = this.planningFolder(this.planningPeriod);
    const format = this.planningFormat(this.planningPeriod);
    const path = buildPeriodPath(folder, format, info);
    const planFile = this.app.vault.getAbstractFileByPath(path);

    card.createEl("p", { text: `${info.label} · ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(info.start)} — ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(info.end)}`, cls: "vp-card-lead" });
    const metrics = card.createDiv({ cls: "vp-stat-row vp-planning-metrics" });
    this.addDailyCount(metrics, String(periodEvents.filter((event) => event.kind === "created").length), "Создано");
    this.addDailyCount(metrics, String(periodEvents.filter((event) => event.kind === "modified").length), "Изменено");
    this.addDailyCount(metrics, String(activeNotes.size), "Активных заметок");
    this.addDailyCount(metrics, String(periodTasks.length), "Задач со сроком");

    const action = card.createDiv({ cls: "vp-planning-actions" });
    const prepare = action.createEl("button", { text: "Подготовить обзор периода", cls: "vp-burst-save" });
    prepare.type = "button";
    prepare.addEventListener("click", () => { void this.plugin.preparePeriodPlan(this.planningPeriod, this.selectedFolder, this.selectedTag); });
    if (planFile instanceof TFile) {
      const open = action.createEl("button", { text: "Открыть план", cls: "vp-planning-open" });
      open.type = "button";
      open.addEventListener("click", () => { void this.app.workspace.getLeaf(false).openFile(planFile); });
    } else card.createEl("p", { text: `Заметка плана ещё не создана · ${path}`, cls: "vp-helper" });

    const noteLinks = [...activeNotes].slice(0, 8);
    if (noteLinks.length) {
      const list = card.createDiv({ cls: "vp-period-note-list" });
      list.createEl("h3", { text: "Активные заметки периода" });
      for (const notePath of noteLinks) {
        const line = list.createDiv({ cls: "vp-today-item" });
        const button = line.createEl("button", { text: notePath.replace(/\.md$/i, ""), cls: "vp-note-link" });
        button.type = "button";
        button.addEventListener("click", () => {
          const file = this.app.vault.getAbstractFileByPath(notePath);
          if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
        });
      }
    }
  }

  private planningFolder(period: PlanningPeriod): string {
    return period === "week" ? this.plugin.settings.weeklyFolder : period === "month" ? this.plugin.settings.monthlyFolder : this.plugin.settings.yearlyFolder;
  }

  private planningFormat(period: PlanningPeriod): string {
    return period === "week" ? this.plugin.settings.weeklyFormat : period === "month" ? this.plugin.settings.monthlyFormat : this.plugin.settings.yearlyFormat;
  }

  private addDailyCount(container: HTMLElement, value: string, label: string): void {
    const item = container.createDiv({ cls: "vp-daily-count" });
    item.createEl("strong", { text: value });
    item.createEl("span", { text: label });
  }

  private renderDailyList(card: HTMLElement, heading: string, entries: string[]): void {
    if (entries.length === 0) return;
    const section = card.createDiv({ cls: "vp-daily-list" });
    section.createEl("h3", { text: heading, cls: "vp-daily-heading" });
    const list = section.createEl("ul");
    for (const entry of entries.slice(0, 5)) list.createEl("li", { text: entry });
  }

  private renderBurstControls(card: HTMLElement, events: ActivityEvent[]): void {
    const currentPeriodEvents = events.filter((event) => eventInPeriod(event, this.plugin.settings.period, new Date(), this.plugin.settings.weekStartsMonday));
    const bursts = findActivityBursts(currentPeriodEvents).slice(-3).reverse();
    const section = card.createDiv({ cls: "vp-bursts" });
    section.createEl("h3", { text: "Возможные массовые изменения" });
    section.createEl("p", { text: "Серии от 20 заметок за 2 минуты подсвечиваются автоматически. Укажите их причину, если знаете её.", cls: "vp-helper" });
    if (bursts.length === 0) {
      section.createEl("p", { text: "Подозрительных серий пока нет.", cls: "vp-helper" });
      return;
    }
    for (const burst of bursts) {
      const ids = burst.map((event) => event.id);
      const key = ids[0];
      const row = section.createDiv({ cls: "vp-burst-row" });
      row.createSpan({ text: `${new Date(burst[0].timestamp).toLocaleString()} · ${new Set(burst.map((event) => event.path)).size} заметок`, cls: "vp-burst-label" });
      const select = row.createEl("select", { cls: "vp-filter-select", attr: { "aria-label": "Причина серии изменений" } });
      select.createEl("option", { text: "Обычная активность", value: "normal" });
      select.createEl("option", { text: "Импорт", value: "import" });
      select.createEl("option", { text: "Синхронизация", value: "sync" });
      select.createEl("option", { text: "Массовое изменение", value: "bulk" });
      select.value = this.burstSelections.get(key) || burst.find((event) => event.classification)?.classification || "normal";
      select.addEventListener("change", () => this.burstSelections.set(key, select.value as ActivityClassification));
      const button = row.createEl("button", { text: "Сохранить", cls: "vp-burst-save" });
      button.type = "button";
      button.addEventListener("click", () => this.plugin.stats?.classifyEvents(ids, select.value as ActivityClassification));
    }
  }

  private renderActivityChart(card: HTMLElement, events: ActivityEvent[]): void {
    const period = this.plugin.settings.period as StatsPeriod;
    const { start, bucketCount } = getDateRange(period, new Date(), this.plugin.settings.weekStartsMonday);
    const buckets = Array.from({ length: bucketCount }, () => ({ created: 0, modified: 0 }));
    for (const event of events) {
      if (!eventInPeriod(event, period, new Date(), this.plugin.settings.weekStartsMonday)) continue;
      const date = new Date(event.timestamp);
      let index = 0;
      if (period === "day") index = date.getHours();
      else if (period === "week") index = Math.floor((localDayNumber(date) - localDayNumber(start)) / 86400000);
      else if (period === "month") index = date.getDate() - 1;
      else index = date.getMonth();
      if (index >= 0 && index < buckets.length) buckets[index][event.kind] += 1;
    }
    const max = Math.max(1, ...buckets.map((bucket) => bucket.created + bucket.modified));
    const labels = period === "day" ? Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"))
      : period === "week" ? ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
      : period === "month" ? Array.from({ length: bucketCount }, (_, i) => String(i + 1))
      : ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
    const chartStyle = this.plugin.settings.chartStyle;
    if (chartStyle === "bars") {
      const chart = card.createDiv({ cls: `vp-chart vp-chart-${period} vp-chart-bars`, attr: { role: "img", "aria-label": `График активности за период: ${periodCaption(period)}` } });
      buckets.forEach((bucket, index) => {
        const column = chart.createDiv({ cls: "vp-chart-column", attr: { "aria-label": `${labels[index]}: ${bucket.created} создано, ${bucket.modified} изменено` } });
        const stack = column.createDiv({ cls: "vp-chart-stack" });
        const totalHeight = (bucket.created + bucket.modified) / max * 100;
        const createdHeight = bucket.created + bucket.modified === 0 ? 0 : bucket.created / (bucket.created + bucket.modified) * 100;
        stack.setCssProps({ "--vp-stack-height": `${Math.max(2, totalHeight)}%`, "--vp-created-height": `${createdHeight}%` });
        column.createSpan({ text: labels[index], cls: "vp-chart-label" });
      });
    } else {
      const plot = card.createDiv({ cls: `vp-chart-plot vp-chart-${chartStyle}`, attr: { role: "img", "aria-label": `График активности за период: ${periodCaption(period)}` } });
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("aria-hidden", "true");
      plot.appendChild(svg);
      for (const y of [12, 32, 52, 72, 92]) {
        const guide = document.createElementNS("http://www.w3.org/2000/svg", "line");
        guide.setAttribute("x1", "0"); guide.setAttribute("x2", "100");
        guide.setAttribute("y1", String(y)); guide.setAttribute("y2", String(y));
        guide.setAttribute("class", "vp-chart-guide");
        svg.appendChild(guide);
      }
      const pointString = (key: "created" | "modified") => buckets.map((bucket, index) => {
        const x = buckets.length === 1 ? 50 : index / (buckets.length - 1) * 100;
        const y = 92 - bucket[key] / max * 80;
        return `${x},${y}`;
      }).join(" ");
      if (chartStyle === "area") {
        const points = pointString("created");
        const area = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        area.setAttribute("points", `0,92 ${points} 100,92`);
        area.setAttribute("class", "vp-chart-area-fill");
        svg.appendChild(area);
      }
      for (const key of ["modified", "created"] as const) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        line.setAttribute("points", pointString(key));
        line.setAttribute("class", `vp-chart-line vp-chart-line-${key}`);
        svg.appendChild(line);
      }
      const xLabels = card.createDiv({ cls: `vp-chart-x-labels vp-chart-x-labels-${period}` });
      for (const label of labels) xLabels.createSpan({ text: label });
    }
    const legend = card.createDiv({ cls: "vp-legend" });
    legend.createSpan({ cls: "vp-legend-created" }); legend.createSpan({ text: "Создано" });
    legend.createSpan({ cls: "vp-legend-modified" }); legend.createSpan({ text: "Изменено" });
    if (events.length === 0) card.createEl("p", { text: "За выбранный период активности нет.", cls: "vp-helper" });
  }

  private renderBreakdown(card: HTMLElement, notes: NoteRecord[], kind: "folder" | "tag"): void {
    const title = kind === "folder" ? "Папки" : "Теги";
    const counts = new Map<string, number>();
    for (const note of notes) {
      const values = kind === "folder" ? [note.folder] : note.tags;
      for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const section = card.createDiv({ cls: "vp-breakdown" });
    section.createEl("h3", { text: title });
    if (sorted.length === 0) {
      section.createEl("p", { text: "Нет данных для выбранных фильтров.", cls: "vp-helper" });
      return;
    }
    const max = sorted[0][1];
    for (const [name, count] of sorted) {
      const row = section.createDiv({ cls: "vp-breakdown-row" });
      row.createSpan({ text: name, cls: "vp-breakdown-name" });
      const track = row.createDiv({ cls: "vp-breakdown-track" });
      track.createDiv({ cls: "vp-breakdown-fill" }).setCssProps({ "--vp-fill-width": `${count / max * 100}%` });
      row.createSpan({ text: String(count), cls: "vp-breakdown-count" });
    }
  }
}

function localDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

function dateKeyForPlanning(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function folderOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "/" : path.slice(0, index);
}

function priorityLabel(priority: TaskPriority): string {
  const labels: Record<TaskPriority, string> = {
    highest: "Срочный", high: "Высокий", normal: "Обычный", low: "Низкий", lowest: "Самый низкий", none: "Без приоритета",
  };
  return labels[priority];
}

function appendTaskToSection(content: string, sectionTitle: string, taskLine: string): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const escaped = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingPattern = new RegExp(`^##\\s+${escaped}\\s*$`, "m");
  const heading = headingPattern.exec(content);
  if (!heading || heading.index === undefined) {
    const separator = !content ? "" : content.endsWith(newline + newline) ? "" : content.endsWith(newline) ? newline : newline + newline;
    return `${content}${separator}## ${sectionTitle}${newline}${newline}${taskLine}${newline}`;
  }
  const sectionStart = heading.index + heading[0].length;
  const tail = content.slice(sectionStart);
  const nextHeading = /\r?\n#{1,6}\s/.exec(tail);
  const insertion = nextHeading ? sectionStart + nextHeading.index : content.length;
  const before = content.slice(0, insertion);
  const after = content.slice(insertion);
  const separator = before.endsWith(newline + newline) ? "" : before.endsWith(newline) ? newline : newline + newline;
  return `${before}${separator}${taskLine}${newline}${after}`;
}

function periodCaption(period: Period): string {
  if (period === "day") return "Сегодня";
  if (period === "week") return "Эта неделя";
  if (period === "month") return "Этот месяц";
  return "С начала года";
}

class VaultPulseSettingTab extends PluginSettingTab {
  constructor(app: VaultPulsePlugin["app"], private plugin: VaultPulsePlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Vault Pulse" });
    containerEl.createEl("p", { text: "Настройки собраны по разделам. Откройте только те, которые хотите изменить." });
    containerEl.createEl("h3", { text: "Внешний вид" });
    new Setting(containerEl).setName("Стиль панелей").setDesc("Выберите оформление карточек дашборда.")
      .addDropdown((dropdown) => dropdown.addOption("mac", "MacBook · стекло")
        .addOption("minimal", "Минимализм").addOption("outlined", "Контурный")
        .setValue(this.plugin.settings.panelStyle)
        .onChange(async (value) => { this.plugin.settings.panelStyle = value as PanelStyle; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Стиль графика активности").setDesc("Столбцы показывают оба типа событий, линия и область — их динамику.")
      .addDropdown((dropdown) => dropdown.addOption("bars", "Столбцы")
        .addOption("line", "Линия").addOption("area", "Область")
        .setValue(this.plugin.settings.chartStyle)
        .onChange(async (value) => { this.plugin.settings.chartStyle = value as ChartStyle; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Цветовая палитра").setDesc("Цвет акцентов и графиков в панели Vault Pulse.")
      .addDropdown((dropdown) => dropdown.addOption("system", "Цвет темы Obsidian").addOption("obsidianite", "Obsidianite")
        .addOption("ocean", "Океан").addOption("violet", "Лаванда").addOption("mint", "Мята").addOption("sunset", "Закат")
        .setValue(this.plugin.settings.accentPalette)
        .onChange(async (value) => { this.plugin.settings.accentPalette = value as AccentPalette; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Плотность панели").setDesc("Свободная раскладка или больше данных на экране.")
      .addDropdown((dropdown) => dropdown.addOption("comfortable", "Свободная").addOption("compact", "Компактная")
        .setValue(this.plugin.settings.density)
        .onChange(async (value) => { this.plugin.settings.density = value as Density; await this.plugin.saveSettings(); }));

    containerEl.createEl("h3", { text: "Основное" });

    new Setting(containerEl).setName("Период по умолчанию").setDesc("Период, выбранный при открытии панели.")
      .addDropdown((dropdown) => dropdown.addOption("day", "День").addOption("week", "Неделя")
        .addOption("month", "Месяц").addOption("year", "Год")
        .setValue(this.plugin.settings.period)
        .onChange(async (value) => { this.plugin.settings.period = value as Period; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Исключить папки").setDesc("Укажите пути по одному на строку. По умолчанию учитываются все папки, включая архивы и шаблоны.")
      .addTextArea((text) => text.setPlaceholder("Например:\nПриватное\nПроекты/Закрытые")
        .setValue(this.plugin.settings.excludedFolders.join("\n"))
        .onChange(async (value) => {
          this.plugin.settings.excludedFolders = value.split(/\r?\n/).map((item) => item.trim().replace(/\\/g, "/").replace(/\/$/, "")).filter(Boolean);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl).setName("Исключить теги").setDesc("Укажите теги по одному на строку. Символ # можно не вводить.")
      .addTextArea((text) => text.setPlaceholder("Например:\nprivate\nчерновик")
        .setValue(this.plugin.settings.excludedTags.join("\n"))
        .onChange(async (value) => {
          this.plugin.settings.excludedTags = value.split(/\r?\n/).map((item) => item.trim().replace(/^#/, "")).filter(Boolean);
          await this.plugin.saveSettings();
        }));

    containerEl.createEl("h3", { text: "Дневная запись" });
    containerEl.createEl("p", { text: "Заметка создаётся или дополняется только после предпросмотра и вашего подтверждения." });
    new Setting(containerEl).setName("Папка дневных заметок").setDesc("Путь внутри хранилища. Папки будут созданы после подтверждения заметки.")
      .addText((text) => text.setPlaceholder("Планирование/Дни").setValue(this.plugin.settings.dailyFolder)
        .onChange(async (value) => { this.plugin.settings.dailyFolder = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Формат имени файла").setDesc("Поддерживаются YYYY, MM и DD. Например: YYYY-MM-DD.")
      .addText((text) => text.setPlaceholder("YYYY-MM-DD").setValue(this.plugin.settings.dailyDateFormat)
        .onChange(async (value) => {
          const format = value.trim();
          if (!format || /[*?:"<>|]/.test(format)) return;
          this.plugin.settings.dailyDateFormat = format;
          await this.plugin.saveSettings();
        }));
    containerEl.createEl("h4", { text: "Блоки дневной записи" });
    containerEl.createEl("p", { text: "Выберите блоки и настройте порядок кнопками со стрелками." });
    for (const [index, blockId] of this.plugin.settings.dailyBlocks.entries()) {
      const block = DAILY_BLOCKS.find((item) => item.id === blockId);
      if (!block) continue;
      const setting = new Setting(containerEl).setName(block.title).setDesc(`Раздел «${block.title}» в дневной заметке.`);
      setting.addToggle((toggle) => toggle.setValue(true).setTooltip("Добавлять этот блок").onChange(async (enabled) => {
        if (!enabled) this.plugin.settings.dailyBlocks = this.plugin.settings.dailyBlocks.filter((id) => id !== blockId);
        else this.plugin.settings.dailyBlocks.push(blockId);
        await this.plugin.saveSettings();
        this.display();
      }));
      setting.addExtraButton((button) => button.setIcon("arrow-up").setTooltip("Переместить выше")
        .setDisabled(index === 0).onClick(async () => { await this.moveDailyBlock(index, -1); }));
      setting.addExtraButton((button) => button.setIcon("arrow-down").setTooltip("Переместить ниже")
        .setDisabled(index === this.plugin.settings.dailyBlocks.length - 1).onClick(async () => { await this.moveDailyBlock(index, 1); }));
    }
    for (const block of DAILY_BLOCKS.filter((item) => !this.plugin.settings.dailyBlocks.includes(item.id))) {
      new Setting(containerEl).setName(block.title).setDesc(`Раздел «${block.title}» выключен.`)
        .addButton((button) => button.setButtonText("Добавить").onClick(async () => {
          this.plugin.settings.dailyBlocks.push(block.id);
          await this.plugin.saveSettings();
          this.display();
        }));
    }

    containerEl.createEl("h3", { text: "Задачи" });
    new Setting(containerEl).setName("Куда добавлять новые задачи").setDesc("Выберите дневную заметку или отдельный файл со списком задач.")
      .addDropdown((dropdown) => dropdown.addOption("daily", "В дневную заметку").addOption("file", "В отдельный файл")
        .setValue(this.plugin.settings.taskDestination)
        .onChange(async (value) => { this.plugin.settings.taskDestination = value as TaskDestination; await this.plugin.saveSettings(); this.display(); }));
    if (this.plugin.settings.taskDestination === "file") {
      new Setting(containerEl).setName("Файл списка задач").setDesc("Путь к Markdown-файлу. Если файла нет, он будет создан после добавления первой задачи.")
        .addText((text) => text.setPlaceholder("Планирование/Задачи.md").setValue(this.plugin.settings.taskFilePath)
          .onChange(async (value) => { this.plugin.settings.taskFilePath = value.trim().replace(/\\/g, "/"); await this.plugin.saveSettings(); }));
    }
    new Setting(containerEl).setName("Группировать задачи по").setDesc("Порядок группировки списка в панели «Сегодня».")
      .addDropdown((dropdown) => dropdown.addOption("due", "Сроку").addOption("priority", "Приоритету").addOption("folder", "Папке")
        .setValue(this.plugin.settings.taskGrouping)
        .onChange(async (value) => { this.plugin.settings.taskGrouping = value as TaskGrouping; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Показывать выполненные задачи").setDesc("Добавляет группу выполненных задач в список.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.showCompletedTasks)
        .onChange(async (value) => { this.plugin.settings.showCompletedTasks = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Задач в каждой группе").setDesc("Ограничивает высоту списка; выберите «Все», чтобы показать весь список.")
      .addDropdown((dropdown) => dropdown.addOption("3", "3").addOption("5", "5").addOption("10", "10").addOption("0", "Все")
        .setValue(String(this.plugin.settings.taskDisplayLimit))
        .onChange(async (value) => { this.plugin.settings.taskDisplayLimit = Number(value); await this.plugin.saveSettings(); }));

    containerEl.createEl("h3", { text: "Расписание" });
    new Setting(containerEl).setName("Начало рабочего дня").setDesc("Формат 24 часа: HH:MM.")
      .addText((text) => text.setPlaceholder("09:00").setValue(this.plugin.settings.scheduleStart)
        .onChange(async (value) => { await this.updateWorkingHours(value, this.plugin.settings.scheduleEnd); }));
    new Setting(containerEl).setName("Конец рабочего дня").setDesc("Должен быть позже начала рабочего дня.")
      .addText((text) => text.setPlaceholder("17:00").setValue(this.plugin.settings.scheduleEnd)
        .onChange(async (value) => { await this.updateWorkingHours(this.plugin.settings.scheduleStart, value); }));
    new Setting(containerEl).setName("Шаг расписания").setDesc("Размер временного интервала в сетке дня.")
      .addDropdown((dropdown) => dropdown.addOption("15", "15 минут").addOption("30", "30 минут").addOption("60", "60 минут")
        .setValue(String(this.plugin.settings.scheduleSlotMinutes))
        .onChange(async (value) => { this.plugin.settings.scheduleSlotMinutes = Number(value); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Формат времени").setDesc("Как показывать время в расписании.")
      .addDropdown((dropdown) => dropdown.addOption("24h", "24 часа").addOption("12h", "12 часов")
        .setValue(this.plugin.settings.timeFormat)
        .onChange(async (value) => { this.plugin.settings.timeFormat = value as "24h" | "12h"; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Первый день недели").setDesc("Используется для недельного периода.")
      .addDropdown((dropdown) => dropdown.addOption("monday", "Понедельник").addOption("sunday", "Воскресенье")
        .setValue(this.plugin.settings.weekStartsMonday ? "monday" : "sunday")
        .onChange(async (value) => { this.plugin.settings.weekStartsMonday = value === "monday"; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Переносить незавершённые задачи").setDesc("Показывает действие переноса из вчерашней дневной заметки в сегодняшнюю.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.rolloverTasks)
        .onChange(async (value) => { this.plugin.settings.rolloverTasks = value; await this.plugin.saveSettings(); this.display(); }));

    containerEl.createEl("h3", { text: "Периодические планы" });
    containerEl.createEl("p", { text: "Шаблоны содержат Markdown-разделы и подстановки {{period}}, {{start}}, {{end}}, {{stats}}, {{tasks}}, {{notes}} и {{projects}}." });
    new Setting(containerEl).setName("Период по умолчанию").setDesc("Какой обзор открывать первым в панели планирования.")
      .addDropdown((dropdown) => dropdown.addOption("week", "Неделя").addOption("month", "Месяц").addOption("year", "Год")
        .setValue(this.plugin.settings.planningDefaultPeriod)
        .onChange(async (value) => { this.plugin.settings.planningDefaultPeriod = value as PlanningPeriod; await this.plugin.saveSettings(); }));
    for (const period of ["week", "month", "year"] as PlanningPeriod[]) {
      const label = period === "week" ? "Неделя" : period === "month" ? "Месяц" : "Год";
      const folderValue = period === "week" ? this.plugin.settings.weeklyFolder : period === "month" ? this.plugin.settings.monthlyFolder : this.plugin.settings.yearlyFolder;
      const formatValue = period === "week" ? this.plugin.settings.weeklyFormat : period === "month" ? this.plugin.settings.monthlyFormat : this.plugin.settings.yearlyFormat;
      const templateValue = period === "week" ? this.plugin.settings.weeklyTemplate : period === "month" ? this.plugin.settings.monthlyTemplate : this.plugin.settings.yearlyTemplate;
      containerEl.createEl("h4", { text: `Шаблон: ${label.toLocaleLowerCase()}` });
      new Setting(containerEl).setName("Папка").setDesc("Путь внутри хранилища.")
        .addText((text) => text.setValue(folderValue).onChange(async (value) => {
          if (period === "week") this.plugin.settings.weeklyFolder = value.trim().replace(/\\/g, "/");
          else if (period === "month") this.plugin.settings.monthlyFolder = value.trim().replace(/\\/g, "/");
          else this.plugin.settings.yearlyFolder = value.trim().replace(/\\/g, "/");
          await this.plugin.saveSettings();
        }));
      new Setting(containerEl).setName("Формат имени файла").setDesc("Неделя: YYYY-[W]WW; месяц: YYYY-MM; год: YYYY. Также доступны DD.")
        .addText((text) => text.setValue(formatValue).onChange(async (value) => {
          if (!value.trim() || /[*?:"<>|]/.test(value)) return;
          if (period === "week") this.plugin.settings.weeklyFormat = value.trim();
          else if (period === "month") this.plugin.settings.monthlyFormat = value.trim();
          else this.plugin.settings.yearlyFormat = value.trim();
          await this.plugin.saveSettings();
        }));
      new Setting(containerEl).setName("Шаблон Markdown").setDesc("Разделы с тем же заголовком в существующем плане повторно не добавляются.")
        .addTextArea((text) => {
          text.inputEl.rows = 10;
          text.inputEl.addClass("vp-plan-template");
          return text.setValue(templateValue).onChange(async (value) => {
            if (period === "week") this.plugin.settings.weeklyTemplate = value;
            else if (period === "month") this.plugin.settings.monthlyTemplate = value;
            else this.plugin.settings.yearlyTemplate = value;
            await this.plugin.saveSettings();
          });
        });
    }

    containerEl.createEl("h3", { text: "Обучение" });
    containerEl.createEl("p", { text: "Выберите платформы для ручного учёта. Stepik API требует OAuth-доступ к аккаунту; личные данные прогресса Udemy доступны через корпоративные API Udemy Business с административной настройкой. Автоматическое подключение здесь не включено." });
    new Setting(containerEl).setName("Stepik").setDesc("Показывать курсы Stepik в списке обучения.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.learningStepikEnabled)
        .onChange(async (value) => { this.plugin.settings.learningStepikEnabled = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Udemy").setDesc("Показывать курсы Udemy в списке обучения.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.learningUdemyEnabled)
        .onChange(async (value) => { this.plugin.settings.learningUdemyEnabled = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Другие платформы").setDesc("Включает ручные записи для любых других сервисов.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.learningOtherEnabled)
        .onChange(async (value) => { this.plugin.settings.learningOtherEnabled = value; await this.plugin.saveSettings(); }));

    containerEl.createEl("h3", { text: "GitHub" });
    containerEl.createEl("p", { text: "Vault Pulse запрашивает только список коммитов выбранных репозиториев. Для закрытых репозиториев используйте fine-grained token с доступом только к нужным репозиториям и Contents: read. Токен хранится через SecretStorage Obsidian, его значение не записывается в data.json." });
    const repoInputSetting = new Setting(containerEl).setName("Добавить репозиторий").setDesc("Формат owner/repo или ссылка https://github.com/owner/repo.");
    let repoInputValue = "";
    repoInputSetting.addText((text) => text.setPlaceholder("owner/repo").onChange((value) => { repoInputValue = value; }));
    repoInputSetting.addButton((button) => button.setButtonText("Добавить").onClick(async () => {
      const repo = normalizeRepository(repoInputValue);
      if (!repo) { new Notice("Введите адрес в формате owner/repo."); return; }
      if (this.plugin.settings.githubRepositories.includes(repo)) { new Notice("Этот репозиторий уже добавлен."); return; }
      this.plugin.settings.githubRepositories.push(repo);
      await this.plugin.saveSettings();
      this.display();
    }));
    for (const repo of this.plugin.settings.githubRepositories) {
      new Setting(containerEl).setName(repo).setDesc("Репозиторий для отображения коммитов.")
        .addButton((button) => button.setButtonText("Удалить").setWarning().onClick(async () => {
          this.plugin.settings.githubRepositories = this.plugin.settings.githubRepositories.filter((item) => item !== repo);
          this.plugin.githubCommits = this.plugin.githubCommits.filter((commit) => commit.repo !== repo);
          await this.plugin.saveSettings();
          this.display();
        }));
    }
    new Setting(containerEl).setName("Токен GitHub").setDesc("Можно оставить пустым для публичных репозиториев. Создайте токен в SecretStorage; Vault Pulse не записывает секрет в настройки плагина.")
      .addComponent((element) => new SecretComponent(this.app, element)
        .setValue(this.plugin.settings.githubSecretId)
        .onChange(async (value) => {
          this.plugin.settings.githubSecretId = value ?? "";
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl).setName("Автоматическая синхронизация").setDesc("По умолчанию выключена. При включении запрашивает только список коммитов выбранных репозиториев.")
      .addDropdown((dropdown) => dropdown.addOption("0", "Только вручную").addOption("15", "Каждые 15 минут")
        .addOption("60", "Каждый час").addOption("1440", "Раз в день")
        .setValue(String(this.plugin.settings.githubSyncMinutes))
        .onChange(async (value) => { this.plugin.settings.githubSyncMinutes = Number(value); await this.plugin.saveSettings(); }));

    containerEl.createEl("h3", { text: "Панели" });
    containerEl.createEl("p", { text: "Выберите видимые панели и измените их порядок. Изменения применяются сразу." });
    for (const [index, id] of this.plugin.settings.panelOrder.entries()) {
      const panel = PANELS.find((item) => item.id === id);
      if (!panel) continue;
      const setting = new Setting(containerEl).setName(panel.title).setDesc(panel.description);
      setting.addToggle((toggle) => toggle.setValue(!this.plugin.settings.hiddenPanels.includes(id))
        .setTooltip("Показывать панель").onChange(async (visible) => {
          this.plugin.settings.hiddenPanels = visible
            ? this.plugin.settings.hiddenPanels.filter((hidden) => hidden !== id)
            : [...this.plugin.settings.hiddenPanels, id];
          await this.plugin.saveSettings();
        }));
      setting.addExtraButton((button) => button.setIcon("arrow-up").setTooltip("Переместить выше")
        .setDisabled(index === 0).onClick(async () => { await this.movePanel(index, -1); }));
      setting.addExtraButton((button) => button.setIcon("arrow-down").setTooltip("Переместить ниже")
        .setDisabled(index === this.plugin.settings.panelOrder.length - 1).onClick(async () => { await this.movePanel(index, 1); }));
    }
    this.wrapSettingsSections(containerEl);
  }

  private wrapSettingsSections(container: HTMLElement): void {
    const headings = Array.from(container.querySelectorAll(":scope > h3"));
    headings.forEach((heading, index) => {
      const details = document.createElement("details");
      details.className = "vp-settings-section";
      details.open = index === 0;
      const summary = document.createElement("summary");
      summary.appendChild(heading);
      details.appendChild(summary);
      const nodes: Node[] = [];
      let sibling = details.nextSibling;
      while (sibling && sibling !== headings[index + 1]) {
        const next = sibling.nextSibling;
        nodes.push(sibling);
        sibling = next;
      }
      heading.before(details);
      for (const node of nodes) details.appendChild(node);
    });
  }

  private async movePanel(index: number, direction: -1 | 1): Promise<void> {
    const target = index + direction;
    const order = [...this.plugin.settings.panelOrder];
    [order[index], order[target]] = [order[target], order[index]];
    this.plugin.settings.panelOrder = order;
    await this.plugin.saveSettings();
    this.display();
  }

  private async moveDailyBlock(index: number, direction: -1 | 1): Promise<void> {
    const target = index + direction;
    const order = [...this.plugin.settings.dailyBlocks];
    [order[index], order[target]] = [order[target], order[index]];
    this.plugin.settings.dailyBlocks = order;
    await this.plugin.saveSettings();
    this.display();
  }

  private async updateWorkingHours(start: string, end: string): Promise<void> {
    const valid = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
    if (!valid(start) || !valid(end) || timeToMinutes(end) <= timeToMinutes(start)) return;
    this.plugin.settings.scheduleStart = start;
    this.plugin.settings.scheduleEnd = end;
    await this.plugin.saveSettings();
  }
}
