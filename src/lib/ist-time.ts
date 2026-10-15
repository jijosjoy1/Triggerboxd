const istFormatter = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function formatIstTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'Unknown time';
  const parts = Object.fromEntries(istFormatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} IST`;
}
