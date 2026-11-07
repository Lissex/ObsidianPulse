import { ItemView, Notice, TFile, setIcon, WorkspaceLeaf } from "obsidian";
import { ActivityClassification, ActivityEvent, NoteRecord, StatsService, eventInPeriod, findActivityBursts } from "./stats";
import { buildDailyPath, dailyDateKey, parseDailySummary } from "./daily";
import { TaskPriority, TaskRecord, compareTaskPriority } from "./tasks";
import { ScheduleEvent, eventsOverlap, parseScheduleEvents, timeToMinutes } from "./schedule";
import { PlanningPeriod, buildPeriodPath, getPeriodInfo } from "./planning";
import { DeleteLearningCourseModal, LearningCourseModal, LearningPlatform } from "./learning";

import type VaultPulsePlugin from "./main";
import { PANELS, PanelDefinition, PanelId, DashboardSection, Period } from "./settings-model";
import { dateKeyForPlanning, folderOf, periodCaption, priorityLabel } from "./view-utils";
import { renderActivityChart, renderBreakdown } from "./dashboard-charts";

const VIEW_TYPE = "vault-pulse-dashboard";

export class DashboardView extends ItemView {
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
  getDisplayText(): string { return "VaultScope"; }
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
    const tagSet = new Set<string>();
    for (const note of notes) {
      for (const tag of note.tags) tagSet.add(tag);
    }
    const tags = [...tagSet].sort((a, b) => a.localeCompare(b));
    if (!folders.includes(this.selectedFolder)) this.selectedFolder = "*";
    if (!tags.includes(this.selectedTag)) this.selectedTag = "*";
    const filteredNotes = notes.filter((note) => this.matchesSelectedFilters(note));
    const events = (snapshot?.events ?? []).filter((event) => this.isIncluded(event)
      && (this.selectedFolder === "*" || event.folder === this.selectedFolder)
      && (this.selectedTag === "*" || event.tags.includes(this.selectedTag)));

    const header = root.createDiv({ cls: "vp-header" });
    const heading = header.createDiv({ cls: "vp-heading" });
    heading.createEl("h1", { text: "VaultScope" });
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
        button.addEventListener("click", () => {
          this.plugin.settings.period = period.id;
          void this.plugin.saveSettings().catch((error: unknown) => {
            new Notice(`Не удалось сохранить настройки: ${error instanceof Error ? error.message : String(error)}`);
          });
        });
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
      this.renderPlanning(card, events);
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
    statusSelect.addEventListener("change", () => { this.learningStatusFilter = statusSelect.value as "all" | "active" | "paused" | "completed"; this.render(); });
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

  private renderPlanning(card: HTMLElement, events: ActivityEvent[]): void {
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
    renderActivityChart(card, events, this.plugin.settings.period, this.plugin.settings.weekStartsMonday, this.plugin.settings.chartStyle);
  }

  private renderBreakdown(card: HTMLElement, notes: NoteRecord[], kind: "folder" | "tag"): void {
    renderBreakdown(card, notes, kind);
  }

}

