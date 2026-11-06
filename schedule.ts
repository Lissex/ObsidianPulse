import { App, Modal } from "obsidian";
import { TaskRecord } from "./tasks";

export interface ScheduleEvent {
  start: string;
  end: string;
  title: string;
  line: string;
  taskPath?: string;
}

export interface NewScheduleEvent {
  start: string;
  end: string;
  title: string;
  task: TaskRecord | null;
}

export function parseScheduleEvents(content: string, defaultDuration = 30): ScheduleEvent[] {
  const events: ScheduleEvent[] = [];
  let inSection = false;
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      inSection = heading[1].trim().toLocaleLowerCase() === "события";
      continue;
    }
    if (!inSection) continue;
    const match = line.match(/^\s*[-*]\s+(\d{1,2}):([0-5]\d)(?:\s*[–—-]\s*(\d{1,2}):([0-5]\d))?\s*(?:\||·|—|-)?\s*(.*?)\s*$/);
    if (!match) continue;
    const startHour = Number(match[1]);
    if (startHour > 23) continue;
    const startMinute = startHour * 60 + Number(match[2]);
    const endHour = match[3] === undefined ? Math.floor((startMinute + defaultDuration) / 60) : Number(match[3]);
    const endMinute = match[4] === undefined ? (startMinute + defaultDuration) % 60 : Number(match[4]);
    if (endHour > 23) continue;
    const endTotal = endHour * 60 + endMinute;
    if (endTotal <= startMinute) continue;
    const taskMatch = match[5].match(/\[\[([^\]]+)\]\]/);
    events.push({
      start: `${String(startHour).padStart(2, "0")}:${match[2]}`,
      end: `${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`,
      title: match[5].replace(/\s*·\s*Задача:.*$/i, "").trim() || "Событие",
      line,
      taskPath: taskMatch?.[1],
    });
  }
  return events.sort((a, b) => a.start.localeCompare(b.start));
}

export function formatScheduleLine(event: NewScheduleEvent): string {
  const task = event.task ? ` · Задача: [[${event.task.path.replace(/\.md$/i, "")}]] — ${event.task.text}` : "";
  return `- ${event.start}–${event.end} | ${event.title.trim()}${task}`;
}

export function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function eventsOverlap(a: Pick<ScheduleEvent, "start" | "end">, b: Pick<ScheduleEvent, "start" | "end">): boolean {
  return timeToMinutes(a.start) < timeToMinutes(b.end) && timeToMinutes(b.start) < timeToMinutes(a.end);
}

export class NewScheduleEventModal extends Modal {
  constructor(
    app: App,
    private targetPath: string,
    private tasks: TaskRecord[],
    private existing: ScheduleEvent[],
    private initialStart: string,
    private initialEnd: string,
    private onCreate: (event: NewScheduleEvent) => Promise<void>,
  ) { super(app); }

  onOpen(): void {
    this.setTitle("Новое событие");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { text: `Событие будет записано в ${this.targetPath}.` });
    const form = contentEl.createDiv({ cls: "vp-task-form" });
    const title = this.inputField(form, "Название", "Например, встреча с командой", "text");
    const timeRow = form.createDiv({ cls: "vp-schedule-time-inputs" });
    const start = this.inputField(timeRow, "Начало", "", "time");
    const end = this.inputField(timeRow, "Окончание", "", "time");
    start.value = this.initialStart;
    end.value = this.initialEnd;
    const taskLabel = form.createEl("label", { text: "Связать с задачей (необязательно)" });
    const taskSelect = taskLabel.createEl("select");
    taskSelect.createEl("option", { text: "Без связанной задачи", value: "" });
    const openTasks = this.tasks.filter((task) => !task.completed);
    for (const task of openTasks) taskSelect.createEl("option", { text: `${task.text} · ${task.path}`, value: task.id });
    const preview = contentEl.createDiv({ cls: "vp-task-markdown-preview" });
    const warning = contentEl.createEl("p", { cls: "vp-schedule-conflict", attr: { "aria-live": "polite" } });
    const getEvent = (): NewScheduleEvent => ({
      start: start.value,
      end: end.value,
      title: title.value.trim(),
      task: openTasks.find((task) => task.id === taskSelect.value) ?? null,
    });
    const update = () => {
      const event = getEvent();
      preview.setText(event.start && event.end && event.title ? formatScheduleLine(event) : "Заполните название и время.");
      const conflict = this.existing.some((item) => eventsOverlap(event, item));
      warning.setText(conflict ? "Это время пересекается с уже записанным событием." : "Свободное время.");
      warning.toggleClass("is-conflict", conflict);
    };
    for (const input of [title, start, end, taskSelect]) input.addEventListener("input", update);
    taskSelect.addEventListener("change", update);
    update();
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Отмена" }).addEventListener("click", () => this.close());
    const save = buttons.createEl("button", { text: "Добавить событие", cls: "mod-cta" });
    save.addEventListener("click", () => {
      const event = getEvent();
      if (!event.title || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(event.start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(event.end)) return;
      if (timeToMinutes(event.end) <= timeToMinutes(event.start)) return;
      save.disabled = true;
      void this.onCreate(event).then(() => this.close()).catch((error: unknown) => {
        warning.setText(`Не удалось сохранить событие: ${error instanceof Error ? error.message : String(error)}`);
        warning.addClass("is-conflict");
        save.disabled = false;
      });
    });
  }

  private inputField(parent: HTMLElement, labelText: string, placeholder: string, type: string): HTMLInputElement {
    const label = parent.createEl("label", { text: labelText });
    return label.createEl("input", { attr: { type, placeholder } });
  }
}
