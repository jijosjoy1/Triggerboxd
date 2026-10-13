import type { FamilySummaryResult } from './representation-contracts';

// Deliberately accepts no warning, note, identity or revealed-category payload.
export function storyCaption(summary: FamilySummaryResult['familySummary'] | null): string {
  if (!summary || summary.value === null || summary.count === 0) return 'Grandma screening?\nThe jury is still out.';
  if (summary.provisional) return 'Grandma screening?\nEarly votes. Keep the remote handy.';
  if (summary.value <= 2) return 'Grandma screening?\nThe crowd says: less awkward.';
  if (summary.value === 3) return 'Grandma screening?\nTea-break timing may be an art.';
  return 'Grandma screening?\nThe remote deserves a supporting role.';
}

export function wrapStoryText(context: Pick<CanvasRenderingContext2D, 'measureText'>, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const character of Array.from(text.replace(/\s+/g, ' ').trim())) {
    if (current && context.measureText(current + character).width > maxWidth) {
      lines.push(current.trim()); current = character;
    } else current += character;
  }
  if (current.trim()) lines.push(current.trim());
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last && context.measureText(last + '…').width > maxWidth) last = Array.from(last).slice(0, -1).join('');
    lines[maxLines - 1] = last + '…';
  }
  return lines;
}

export function drawStoryCard(canvas: HTMLCanvasElement, title: string, summary: FamilySummaryResult['familySummary'] | null) {
  canvas.width = 1080; canvas.height = 1920;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not create the image. Copy the film link instead.');
  context.fillStyle = '#17151e'; context.fillRect(0, 0, 1080, 1920);
  context.strokeStyle = '#9274e4'; context.lineWidth = 4; context.strokeRect(60, 90, 960, 1740);
  context.fillStyle = '#bcabed'; context.font = 'bold 36px sans-serif'; context.fillText('TRIGGERBOXD / THE FAMILY SCREENING', 110, 200);
  context.fillStyle = '#f3eee4'; context.font = 'bold 82px sans-serif';
  wrapStoryText(context, title, 850, 4).forEach((line, i) => context.fillText(line, 110, 370 + i * 100));
  context.font = 'bold 72px sans-serif';
  let y = 900;
  for (const paragraph of storyCaption(summary).split('\n')) {
    for (const line of wrapStoryText(context, paragraph, 850, 4)) { context.fillText(line, 110, y); y += 88; }
  }
  context.fillStyle = '#bcabed'; context.font = '32px sans-serif';
  const evidence = !summary || summary.value === null || summary.count === 0 ? 'Family opinion: unknown / no verdict' : `Family awkwardness: ${summary.value}/5 / ${summary.count} votes${summary.provisional ? ' / early votes' : ''}`;
  wrapStoryText(context, evidence, 850, 2).forEach((line, i) => context.fillText(line, 110, 1460 + i * 45));
  context.fillStyle = '#f3eee4'; context.font = '30px sans-serif';
  context.fillText('Community opinion. Not a safety guarantee.', 110, 1630);
  context.fillText('Check the full guide before pressing play.', 110, 1675);
  context.font = 'bold 36px sans-serif'; context.fillText('triggerboxd.com', 110, 1760);
}

