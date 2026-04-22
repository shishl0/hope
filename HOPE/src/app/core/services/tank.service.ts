import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Tank } from '../../models/tank';
import { PlayerProfile } from '../../models/player';

@Injectable({ providedIn: 'root' })
export class TankService {
  private readonly apiUrl = `http://${window.location.hostname}:8000/api`;

  constructor(private http: HttpClient) {}

  getTanks(): Observable<Tank[]> {
    return this.http.get<Tank[]>(`${this.apiUrl}/tanks/`);
  }

  selectTank(tankId: number): Observable<PlayerProfile> {
    return this.http.post<PlayerProfile>(`${this.apiUrl}/profile/select-tank/`, {
      tank_id: tankId,
    });
  }
}
