import { App, Modal, Notice, TAbstractFile, TFile } from "obsidian";

export type TaskPriority = "highest" | "high" | "normal" | "low" | "lowest" | "none";

export interface TaskRecord {
  id: string;
  path: string;
  line: number;
  rawLine: string;
  text: string;
  completed: boolean;
  due: string | null;
  priority: TaskPriority;
  tags: string[];
}

export interface NewTaskData {
  text: string;
  due: string;
  priority: TaskPriority;
  tags: string[];
}

const PRIORITY_MARKERS: Record<TaskPriority, string> = {
  highest: "🔺", high: "⏫", normal: "🔼", low: "🔽", lowest: "⏬", none: "",
};

const PRIORITY_ORDER: TaskPriority[] = ["highest", "high", "normal", "low", "lowest", "none"];

export function parseTasks(path: string, content: string): TaskRecord[] {
  const tasks: TaskRecord[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index];
    const match = rawLine.match(/^(\s*[-*]\s+)\[([ xX])\]\s+(.*)$/);
    if (!match || match.length < 4) continue;
    
    const body = match[3].trim();
    if (!body) continue;
    
    const dueMatch = body.match(/(?:📅|@due\()\s*(\d{4}-\d{2}-\d{2})\)?/);
    const tags = [...new Set(body.match(/#[\p{L}\p{N}_/-]+/gu) ?? [])];
    let priority: TaskPriority = "none";
    
    for (const value of PRIORITY_ORDER) {
      if (value !== "none" && body.includes(PRIORITY_MARKERS[value])) { priority = value; break; }
    }
    
    const text = body
      .replace(/(?:📅|@due\()\s*\d{4}-\d{2}-\d{2}\)?/g, "")
      .replace(/🔺|⏫|🔼|🔽|⏬/g, "")
      .replace(/#[\p{L}\p{N}_/-]+/gu, "")
      .replace(/\s+/g, " ").trim();
      
    tasks.push({
      id: `${path}:${index}:${rawLine}`,
      path,
      line: index,
      rawLine,
      text,
      completed: match[2].toLowerCase() === "x",
      due: dueMatch && dueMatch[1] ? dueMatch[1] : null,
      priority,
      tags,
    });
  }
  return tasks;
}

export function buildTaskLine(task: NewTaskData): string {
  const parts = [`- [ ] ${task.text.trim()}`];
  for (const tag of task.tags) {
    const normalized = tag.startsWith("#") ? tag : `#${tag}`;
    if (/^#[\p{L}\p{N}_/-]+$/u.test(normalized)) parts.push(normalized);
  }
  if (task.due) parts.push(`📅 ${task.due}`);
  if (task.priority !== "none") parts.push(PRIORITY_MARKERS[task.priority]);
  return parts.join(" ");
}

export function compareTaskPriority(a: TaskRecord, b: TaskRecord): number {
  return PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
}

export class TaskService {
  private byPath = new Map<string, TaskRecord[]>();
  private ready = false;
  private queuedPaths = new Set<string>();
  private timer: number | null = null;
  private onUpdate: () => void;

  constructor(private app: App, onUpdate: () => void) { this.onUpdate = onUpdate; }

  async start(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      try { 
        this.byPath.set(file.path, parseTasks(file.path, await this.app.vault.cachedRead(file))); 
      } catch { 
        this.byPath.set(file.path, []); 
      }
      if (index > 0 && index % 100 === 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
    this.ready = true;
    for (const path of this.queuedPaths) this.updatePath(path);
    this.queuedPaths.clear();
    this.onUpdate();
  }

  getTasks(): TaskRecord[] {
    return Array.from(this.byPath.values()).reduce<TaskRecord[]>((tasks, fileTasks) => tasks.concat(fileTasks), []);
  }

  onCreate(file: TAbstractFile): void { this.queueFile(file); }
  onModify(file: TAbstractFile): void { this.queueFile(file); }

  onDelete(file: TAbstractFile): void {
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") return;
    this.byPath.delete(file.path);
    this.onUpdate();
  }

  onRename(file: TAbstractFile, oldPath: string): void {
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") return;
    this.byPath.delete(oldPath);
    this.queueFile(file);
  }

  async setCompleted(task: TaskRecord, completed: boolean): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) { new Notice("Заметка с этой задачей больше не найдена."); return; }
    let stale = false;
    try {
      await this.app.vault.process(file, (content) => {
        const lines = content.split(/\r?\n/);
        const line = lines[task.line];
        if (line !== task.rawLine) { stale = true; return content; }
        lines[task.line] = completed
          ? line.replace(/^(\s*[-*]\s+\[)[ xX](\]\s+)/, "$1x$2")
          : line.replace(/^(\s*[-*]\s+\[)[xX](\]\s+)/, "$1 $2");
        return lines.join(content.includes("\r\n") ? "\r\n" : "\n");
      });
      if (stale) new Notice("Задача изменилась. Обновите список и попробуйте ещё раз.");
    } catch (error: unknown) {
      new Notice(`Не удалось обновить задачу: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private queueFile(file: TAbstractFile): void {
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") return;
    if (!this.ready) { this.queuedPaths.add(file.path); return; }
    this.queuedPaths.add(file.path);
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      for (const path of this.queuedPaths) this.updatePath(path);
      this.queuedPaths.clear();
      this.onUpdate();
    }, 250);
  }

  private updatePath(path: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") {
      this.byPath.delete(path);
      return;
    }
    void this.app.vault.cachedRead(file).then((content) => {
      this.byPath.set(path, parseTasks(path, content));
      this.onUpdate();
    }).catch(() => this.byPath.delete(path));
  }
}

export class NewTaskModal extends Modal {
  constructor(app: App, private targetPath: string, private onCreate: (task: NewTaskData) => Promise<void>) { super(app); }

  onOpen(): void {
    this.setTitle("Новая задача");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { text: `Новая задача будет сохранена в ${this.targetPath}.` });
    const form = contentEl.createDiv({ cls: "vp-task-form" });
    const titleLabel = form.createEl("label", { text: "Задача" });
    const title = titleLabel.createEl("input", { attr: { type: "text", placeholder: "Например, подготовить обзор недели" } });
    const dueLabel = form.createEl("label", { text: "Срок" });
    const due = dueLabel.createEl("input", { attr: { type: "date" } });
    const priorityLabel = form.createEl("label", { text: "Приоритет" });
    const priority = priorityLabel.createEl("select");
    const options: [TaskPriority, string][] = [
      ["none", "Без приоритета"], ["highest", "Срочный"], ["high", "Высокий"],
      ["normal", "Обычный"], ["low", "Низкий"], ["lowest", "Самый низкий"],
    ];
    for (const [value, label] of options) priority.createEl("option", { text: label, value });
    const tagsLabel = form.createEl("label", { text: "Теги" });
    const tags = tagsLabel.createEl("input", { attr: { type: "text", placeholder: "проект, работа" } });
    const preview = contentEl.createDiv({ cls: "vp-task-markdown-preview" });
    
    const updatePreview = () => { 
      preview.setText(buildTaskLine({
        text: title.value || "Название задачи",
        due: due.value,
        priority: priority.value as TaskPriority,
        tags: tags.value.split(/[\s,]+/).map((tag) => tag.replace(/^#/, "")).filter(Boolean),
      })); 
    };
    
    title.addEventListener("input", updatePreview);
    due.addEventListener("change", updatePreview);
    priority.addEventListener("change", updatePreview);
    tags.addEventListener("input", updatePreview);
    updatePreview();
    
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Отмена" }).addEventListener("click", () => this.close());
    const save = buttons.createEl("button", { text: "Добавить задачу", cls: "mod-cta" });
    save.addEventListener("click", () => {
      const text = title.value.trim();
      if (!text) { title.focus(); return; }
      save.disabled = true;
      const task: NewTaskData = {
        text,
        due: due.value,
        priority: priority.value as TaskPriority,
        tags: tags.value.split(/[\s,]+/).map((tag) => tag.replace(/^#/, "")).filter(Boolean),
      };
      void this.onCreate(task).then(() => this.close()).catch((error: unknown) => {
        new Notice(`Не удалось добавить задачу: ${error instanceof Error ? error.message : String(error)}`);
        save.disabled = false;
      });
    });
  }

  onClose(): void { this.contentEl.empty(); }
}

export class TaskRolloverModal extends Modal {
  constructor(
    app: App,
    private sourcePath: string,
    private targetPath: string,
    private tasks: TaskRecord[],
    private onMove: (tasks: TaskRecord[]) => Promise<void>,
  ) { super(app); }

  onOpen(): void {
    this.setTitle("Перенос незавершённых задач");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { text: `Задачи будут перемещены из ${this.sourcePath} в ${this.targetPath}. Исходные строки удалятся только после успешного копирования.` });
    const selected = new Map<string, boolean>();
    const list = contentEl.createDiv({ cls: "vp-rollover-list" });
    
    for (const task of this.tasks) {
      selected.set(task.id, true);
      const label = list.createEl("label", { cls: "vp-rollover-item" });
      const checkbox = label.createEl("input", { attr: { type: "checkbox" } });
      checkbox.checked = true;
      checkbox.addEventListener("change", () => selected.set(task.id, checkbox.checked));
      label.createSpan({ text: task.rawLine.trim() });
    }
    
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Отмена" }).addEventListener("click", () => this.close());
    const move = buttons.createEl("button", { text: `Перенести ${this.tasks.length} задач`, cls: "mod-cta" });
    
    const updateMoveButton = () => {
      const count = [...selected.values()].filter(Boolean).length;
      move.textContent = `Перенести ${count} задач`;
      move.disabled = count === 0;
    };
    
    for (const checkbox of Array.from(list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
      checkbox.addEventListener("change", updateMoveButton);
    }
    
    move.addEventListener("click", () => {
      const tasks = this.tasks.filter((task) => selected.get(task.id));
      if (!tasks.length) return;
      move.disabled = true;
      void this.onMove(tasks).then(() => this.close()).catch((error: unknown) => {
        new Notice(`Не удалось перенести задачи: ${error instanceof Error ? error.message : String(error)}`);
        move.disabled = false;
      });
    });
  }

  onClose(): void { this.contentEl.empty(); }
}
