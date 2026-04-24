import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Lobby } from '../../models/lobby';

@Injectable({ providedIn: 'root' })
export class LobbyService {
  private readonly apiUrl = `http://${window.location.hostname}:8080/api`;

  constructor(private http: HttpClient) {}

  list(): Observable<Lobby[]> {
    return this.http.get<Lobby[]>(`${this.apiUrl}/lobbies/`);
  }

  create(name = 'Steel Room', side: 'allies' | 'axis' = 'allies'): Observable<Lobby> {
    return this.http.post<Lobby>(`${this.apiUrl}/lobbies/`, { name, side });
  }

  detail(id: number): Observable<Lobby> {
    return this.http.get<Lobby>(`${this.apiUrl}/lobbies/${id}/`);
  }

  delete(id: number): Observable<unknown> {
    return this.http.delete(`${this.apiUrl}/lobbies/${id}/`);
  }

  join(id: number, side: 'allies' | 'axis' = 'allies'): Observable<Lobby> {
    return this.http.post<Lobby>(`${this.apiUrl}/lobbies/${id}/join/`, { side });
  }

  leave(id: number): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/lobbies/${id}/leave/`, {});
  }

  setSide(id: number, side: 'allies' | 'axis'): Observable<Lobby> {
    return this.http.post<Lobby>(`${this.apiUrl}/lobbies/${id}/side/`, { side });
  }

  setMode(id: number, mode: 'team' | 'deathmatch'): Observable<Lobby> {
    return this.http.post<Lobby>(`${this.apiUrl}/lobbies/${id}/mode/`, { mode });
  }
}
