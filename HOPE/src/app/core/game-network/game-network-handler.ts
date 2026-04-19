import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { PlayerInput } from '../input/player-input';
import { PlayerStateDto } from './player-state-dto';

@Injectable({
  providedIn: 'root',
})
export class GameNetworkHandler {

  private readonly serverUrl = 'http://127.0.0.1:8000/object/move';

  constructor(private http: HttpClient) {}

  sendPlayerInput(input: PlayerInput): Observable<void> {
    return this.http.post<void>(`${this.serverUrl}/input`, input);
  }

  getPlayerState(): Observable<PlayerStateDto> {
    return this.http.get<PlayerStateDto>(`${this.serverUrl}/state`);
  }

}
