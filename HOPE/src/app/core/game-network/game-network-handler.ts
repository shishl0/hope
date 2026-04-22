import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  MoveRequestDto,
  MoveResponseDto,
  ProtoTankBulletRequestDto,
  ProtoTankBulletResponseDto,
  ProtoTankMoveRequestDto,
  ProtoTankMoveResponseDto,
} from './player-state-dto';

@Injectable({
  providedIn: 'root',
})
export class GameNetworkHandler {

  private readonly cubeMoveUrl = `http://${window.location.hostname}:8000/api/object/move/`;
  private readonly protoTankMoveUrl = `http://${window.location.hostname}:8000/api/proto-tank/move/`;
  private readonly protoTankBulletUrl = `http://${window.location.hostname}:8000/api/proto-tank/bullets/`;

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

  sendProtoTankBulletInput(input: ProtoTankBulletRequestDto): Observable<ProtoTankBulletResponseDto> {
    return this.http.post<ProtoTankBulletResponseDto>(this.protoTankBulletUrl, input);
  }

}
