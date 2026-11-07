import { Period } from "./settings-model";
import { TaskPriority } from "./tasks";

export function localDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

export function dateKeyForPlanning(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function folderOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "/" : path.slice(0, index);
}

export function priorityLabel(priority: TaskPriority): string {
  const labels: Record<TaskPriority, string> = {
    highest: "Срочный", high: "Высокий", normal: "Обычный", low: "Низкий", lowest: "Самый низкий", none: "Без приоритета",
  };
  return labels[priority];
}

export function appendTaskToSection(content: string, sectionTitle: string, taskLine: string): string {
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

export function periodCaption(period: Period): string {
  if (period === "day") return "Сегодня";
  if (period === "week") return "Эта неделя";
  if (period === "month") return "Этот месяц";
  return "С начала года";
}

