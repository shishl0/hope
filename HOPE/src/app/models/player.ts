import { Tank } from './tank';

export interface PlayerProfile {
  id: number;
  publicId: string;
  nickname: string;
  selectedTank?: Tank | null;
  matchesPlayed: number;
  totalKills: number;
  totalDeaths: number;
  wins: number;
  losses: number;
  rating: number;
}

export function kdRatio(profile: PlayerProfile | null): string {
  if (!profile) return '0.00';
  if (profile.totalDeaths === 0) return profile.totalKills.toFixed(2);
  return (profile.totalKills / profile.totalDeaths).toFixed(2);
}
