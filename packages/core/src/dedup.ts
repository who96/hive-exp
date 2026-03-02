import type { ExperienceRecord } from './types/index.js';

export interface SupersedeAction {
  winner_id: string;
  loser_id: string;
  reason: string;
  winner_confidence: number;
  loser_confidence: number;
}

function toMillis(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function detectDuplicates(experiences: ExperienceRecord[]): SupersedeAction[] {
  const active = experiences.filter((experience) => !experience.archived && experience.superseded_by === null);
  const groups = new Map<string, ExperienceRecord[]>();

  for (const experience of active) {
    const key = experience.strategy.name;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(experience);
  }

  const actions: SupersedeAction[] = [];
  for (const [, group] of groups) {
    if (group.length < 2) {
      continue;
    }

    group.sort((a, b) => {
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }
      return toMillis(b.last_confirmed) - toMillis(a.last_confirmed);
    });

    const winner = group[0]!;
    for (let i = 1; i < group.length; i++) {
      const loser = group[i]!;
      actions.push({
        winner_id: winner.id,
        loser_id: loser.id,
        reason: `Duplicate strategy '${winner.strategy.name}': confidence ${winner.confidence} >= ${loser.confidence}`,
        winner_confidence: winner.confidence,
        loser_confidence: loser.confidence,
      });
    }
  }

  return actions;
}
