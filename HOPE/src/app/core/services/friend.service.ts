import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { FriendPlayer, FriendRequest, FriendsSummary, LobbyInvite } from '../../models/friend';
import { Lobby } from '../../models/lobby';

@Injectable({ providedIn: 'root' })
export class FriendService {
  private readonly apiUrl = `http://${window.location.hostname}:8000/api`;

  constructor(private http: HttpClient) {}

  summary(): Observable<FriendsSummary> {
    return this.http.get<FriendsSummary>(`${this.apiUrl}/friends/`);
  }

  search(publicId: string): Observable<FriendPlayer> {
    return this.http.get<FriendPlayer>(`${this.apiUrl}/friends/search/`, {
      params: { public_id: publicId },
    });
  }

  profile(publicId: string): Observable<FriendPlayer> {
    return this.http.get<FriendPlayer>(`${this.apiUrl}/friends/${publicId}/profile/`);
  }

  sendRequest(publicId: string): Observable<FriendRequest> {
    return this.http.post<FriendRequest>(`${this.apiUrl}/friends/request/`, {
      public_id: publicId,
    });
  }

  accept(requestId: number): Observable<FriendRequest> {
    return this.http.post<FriendRequest>(`${this.apiUrl}/friends/requests/${requestId}/accept/`, {});
  }

  decline(requestId: number): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/friends/requests/${requestId}/decline/`, {});
  }

  inviteToLobby(publicId: string): Observable<LobbyInvite> {
    return this.http.post<LobbyInvite>(`${this.apiUrl}/friends/${publicId}/invite/`, {});
  }

  acceptLobbyInvite(inviteId: number): Observable<Lobby> {
    return this.http.post<Lobby>(`${this.apiUrl}/friends/invites/${inviteId}/accept/`, {});
  }

  declineLobbyInvite(inviteId: number): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/friends/invites/${inviteId}/decline/`, {});
  }
}
