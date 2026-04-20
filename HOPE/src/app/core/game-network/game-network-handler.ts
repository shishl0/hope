import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  MoveRequestDto,
  MoveResponseDto,
  ProtoTankMoveRequestDto,
  ProtoTankMoveResponseDto,
} from './player-state-dto';

@Injectable({
  providedIn: 'root',
})
export class GameNetworkHandler {

  private readonly cubeMoveUrl = 'http://127.0.0.1:8001/api/object/move/';
  private readonly protoTankMoveUrl = 'http://127.0.0.1:8001/api/proto-tank/move/';

  constructor(private http: HttpClient) {}

  sendPlayerInput(input: MoveRequestDto): Observable<MoveResponseDto> {
    return this.sendCubeMoveInput(input);
  }

  sendCubeMoveInput(input: MoveRequestDto): Observable<MoveResponseDto> {
    return this.http.post<MoveResponseDto>(this.cubeMoveUrl, input);
  }

  sendProtoTankMoveInput(input: ProtoTankMoveRequestDto): Observable<ProtoTankMoveResponseDto> {
    return this.http.post<ProtoTankMoveResponseDto>(this.protoTankMoveUrl, input);
  }

}
