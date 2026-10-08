export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
