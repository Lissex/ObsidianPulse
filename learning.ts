import { App, Modal, Notice } from "obsidian";

export type LearningPlatform = "stepik" | "udemy" | "other";
export type LearningStatus = "active" | "paused" | "completed";

export interface LearningCourse {
  id: string;
  platform: LearningPlatform;
  title: string;
  url: string;
  progress: number;
  status: LearningStatus;
  nextStep: string;
  updatedAt: string;
}

export type LearningCourseInput = Omit<LearningCourse, "id" | "updatedAt">;

export function normalizeLearningCourses(value: unknown): LearningCourse[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const course = item as Partial<LearningCourse>;
    if (typeof course.title !== "string" || !course.title.trim()) return [];
    const platform: LearningPlatform = course.platform === "stepik" || course.platform === "udemy" ? course.platform : "other";
    const status: LearningStatus = course.status === "paused" || course.status === "completed" ? course.status : "active";
    const progress = Number.isFinite(course.progress) ? Math.max(0, Math.min(100, Number(course.progress))) : 0;
    return [{
      id: typeof course.id === "string" ? course.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      platform,
      title: course.title.trim(),
      url: typeof course.url === "string" ? course.url : "",
      progress,
      status: progress >= 100 ? "completed" : status,
      nextStep: typeof course.nextStep === "string" ? course.nextStep : "",
      updatedAt: typeof course.updatedAt === "string" ? course.updatedAt : new Date().toISOString(),
    }];
  });
}

export class LearningCourseModal extends Modal {
  constructor(
    app: App,
    private enabledPlatforms: LearningPlatform[],
    private onSave: (course: LearningCourseInput, existing?: LearningCourse) => Promise<void>,
    private existing?: LearningCourse,
  ) { super(app); }

  onOpen(): void {
    this.setTitle(this.existing ? "Изменить курс" : "Добавить курс");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("vp-learning-modal");
    contentEl.createEl("p", { text: "Запись хранится локально в тестовом хранилище. Прогресс можно обновлять вручную.", cls: "vp-helper" });
    const form = contentEl.createDiv({ cls: "vp-task-form" });
    const platformLabel = form.createEl("label", { text: "Платформа" });
    const platform = platformLabel.createEl("select");
    const platformNames: Record<LearningPlatform, string> = { stepik: "Stepik", udemy: "Udemy", other: "Другая" };
    for (const item of this.enabledPlatforms) platform.createEl("option", { text: platformNames[item], value: item });
    platform.value = this.existing?.platform ?? this.enabledPlatforms[0] ?? "other";
    const titleLabel = form.createEl("label", { text: "Название курса" });
    const title = titleLabel.createEl("input", { attr: { type: "text", placeholder: "Например, основы TypeScript" } });
    title.value = this.existing?.title ?? "";
    const urlLabel = form.createEl("label", { text: "Ссылка (необязательно)" });
    const url = urlLabel.createEl("input", { attr: { type: "url", placeholder: "https://…" } });
    url.value = this.existing?.url ?? "";
    const progressLabel = form.createEl("label", { text: "Прогресс, %" });
    const progress = progressLabel.createEl("input", { attr: { type: "number", min: "0", max: "100", step: "1" } });
    progress.value = String(this.existing?.progress ?? 0);
    const statusLabel = form.createEl("label", { text: "Статус" });
    const status = statusLabel.createEl("select");
    status.createEl("option", { text: "Прохожу", value: "active" });
    status.createEl("option", { text: "Приостановлен", value: "paused" });
    status.createEl("option", { text: "Завершён", value: "completed" });
    status.value = this.existing?.status ?? "active";
    const nextLabel = form.createEl("label", { text: "Следующий шаг (необязательно)" });
    const nextStep = nextLabel.createEl("input", { attr: { type: "text", placeholder: "Например, пройти модуль 3" } });
    nextStep.value = this.existing?.nextStep ?? "";
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Отмена" }).addEventListener("click", () => this.close());
    const save = buttons.createEl("button", { text: this.existing ? "Сохранить" : "Добавить курс", cls: "mod-cta" });
    save.addEventListener("click", () => {
      const courseTitle = title.value.trim();
      const courseUrl = url.value.trim();
      if (!courseTitle) { title.focus(); return; }
      if (courseUrl && !/^https?:\/\//i.test(courseUrl)) { url.focus(); new Notice("Ссылка должна начинаться с http:// или https://."); return; }
      const value = Math.max(0, Math.min(100, Number(progress.value) || 0));
      save.disabled = true;
      void this.onSave({
        platform: platform.value as LearningPlatform,
        title: courseTitle,
        url: courseUrl,
        progress: value,
        status: value >= 100 ? "completed" : status.value as LearningStatus,
        nextStep: nextStep.value.trim(),
      }, this.existing).then(() => this.close()).catch((error: unknown) => {
        new Notice(`Не удалось сохранить курс: ${error instanceof Error ? error.message : String(error)}`);
        save.disabled = false;
      });
    });
  }

  onClose(): void { this.contentEl.empty(); }
}

export class DeleteLearningCourseModal extends Modal {
  constructor(app: App, private course: LearningCourse, private onDelete: () => Promise<void>) { super(app); }

  onOpen(): void {
    this.setTitle("Удалить курс");
    this.contentEl.createEl("p", { text: `Удалить запись «${this.course.title}» из локального списка обучения? Это не изменит данные на платформе.` });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Отмена" }).addEventListener("click", () => this.close());
    buttons.createEl("button", { text: "Удалить", cls: "mod-warning" }).addEventListener("click", () => {
      void this.onDelete().then(() => this.close()).catch((error: unknown) => {
        new Notice(`Не удалось удалить курс: ${error instanceof Error ? error.message : String(error)}`);
      });
    });
  }

  onClose(): void { this.contentEl.empty(); }
}
