import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { PlayerProfile } from '../../models/player';

interface AuthResponse {
  access: string;
  refresh: string;
  profile?: PlayerProfile;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = 'http://127.0.0.1:8000/api';
  readonly profile = signal<PlayerProfile | null>(null);

  constructor(private http: HttpClient, private router: Router) {}

  get token(): string | null {
    return sessionStorage.getItem('hope_access') || localStorage.getItem('hope_access');
  }

  get isLoggedIn(): boolean {
    return Boolean(this.token);
  }

  login(nickname: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/auth/login/`, {
      username: nickname,
      password,
    }).pipe(tap((response) => this.storeTokens(response)));
  }

  register(nickname: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/auth/register/`, {
      nickname,
      password,
    }).pipe(tap((response) => this.storeTokens(response)));
  }

  loadProfile(): Observable<PlayerProfile> {
    return this.http.get<PlayerProfile>(`${this.apiUrl}/profile/`).pipe(
      tap((profile) => this.profile.set(profile)),
    );
  }

  logout(): void {
    sessionStorage.removeItem('hope_access');
    sessionStorage.removeItem('hope_refresh');
    localStorage.removeItem('hope_access');
    localStorage.removeItem('hope_refresh');
    this.profile.set(null);
    this.router.navigateByUrl('/');
  }

  private storeTokens(response: AuthResponse): void {
    sessionStorage.setItem('hope_access', response.access);
    sessionStorage.setItem('hope_refresh', response.refresh);
    localStorage.removeItem('hope_access');
    localStorage.removeItem('hope_refresh');
    if (response.profile) this.profile.set(response.profile);
  }
}
