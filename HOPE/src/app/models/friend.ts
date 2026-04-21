import { Tank } from './tank';

export interface FriendPlayer {
  id: number;
  publicId: string;
  nickname: string;
  avatar: string;
  rating: number;
  selectedTank?: Tank | null;
  matchesPlayed?: number;
  totalKills?: number;
  totalDeaths?: number;
  wins?: number;
  losses?: number;
  lastSeenAt?: string;
  isOnline?: boolean;
  daysSinceSeen?: number;
  activeLobbyId?: number | null;
  activeLobbyName?: string | null;
}

export interface FriendRequest {
  id: number;
  fromPlayer: FriendPlayer;
  toPlayer: FriendPlayer;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
}

export interface FriendsSummary {
  playerId: string;
  friends: FriendPlayer[];
  outgoing: FriendRequest[];
  incoming: FriendRequest[];
  outgoingInvites: LobbyInvite[];
  incomingInvites: LobbyInvite[];
}

export interface LobbyInvite {
  id: number;
  fromPlayer: FriendPlayer;
  toPlayer: FriendPlayer;
  lobbyId: number;
  lobbyName: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
}
