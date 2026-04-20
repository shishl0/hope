import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { MoveRequestDto, MoveResponseDto } from './player-state-dto';

@Injectable({
  providedIn: 'root',
})
export class GameNetworkHandler {

  private readonly serverUrl = 'http://127.0.0.1:8001/api/object/move/';

  constructor(private http: HttpClient) {}

  sendPlayerInput(input: MoveRequestDto): Observable<MoveResponseDto> {
    return this.http.post<MoveResponseDto>(this.serverUrl, input);
  }

}
