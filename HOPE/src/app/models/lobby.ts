import { Tank } from './tank';

export interface LobbyPlayer {
  id: number;
  nickname: string;
  avatar: string;
  rating: number;
  selectedTank?: Tank | null;
  side: 'allies' | 'axis';
  is_ready: boolean;
  joined_at: string;
}

export interface Lobby {
  id: number;
  name: string;
  is_active: boolean;
  max_players: number;
  player_count: number;
  players: LobbyPlayer[];
  game_mode: 'team' | 'deathmatch';
  created_at: string;
}
