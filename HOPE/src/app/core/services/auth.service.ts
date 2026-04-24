import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, catchError, of } from 'rxjs';
import { PlayerProfile } from '../../models/player';

interface AuthResponse {
  access: string;
  refresh: string;
  profile?: PlayerProfile;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = `http://${window.location.hostname}:8080/api`;
  readonly profile = signal<PlayerProfile | null>(null);

  constructor(private http: HttpClient, private router: Router) {
    const saved = localStorage.getItem('hope_profile');
    if (saved) {
      try {
        this.profile.set(JSON.parse(saved));
      } catch (e) {
        localStorage.removeItem('hope_profile');
      }
    }
  }

  get token(): string | null {
    return localStorage.getItem('hope_access');
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

  loadProfile(): Observable<PlayerProfile | null> {
    if (!this.isLoggedIn) return of(null);
    return this.http.get<PlayerProfile>(`${this.apiUrl}/profile/`).pipe(
      tap((profile) => {
        this.profile.set(profile);
        localStorage.setItem('hope_profile', JSON.stringify(profile));
      }),
      catchError(() => {
        this.logout();
        return of(null);
      })
    );
  }

  updateProfile(nickname: string): Observable<PlayerProfile> {
    return this.http.put<PlayerProfile>(`${this.apiUrl}/profile/`, {
      nickname,
    }).pipe(tap((profile) => {
      this.profile.set(profile);
      localStorage.setItem('hope_profile', JSON.stringify(profile));
    }));
  }

  changePassword(currentPassword: string, newPassword: string): Observable<{ detail: string }> {
    return this.http.post<{ detail: string }>(`${this.apiUrl}/auth/change-password/`, {
      currentPassword,
      newPassword,
    });
  }

  logout(): void {
    localStorage.removeItem('hope_access');
    localStorage.removeItem('hope_refresh');
    localStorage.removeItem('hope_profile');
    this.profile.set(null);
    this.router.navigateByUrl('/login');
  }

  private storeTokens(response: AuthResponse): void {
    localStorage.setItem('hope_access', response.access);
    localStorage.setItem('hope_refresh', response.refresh);
    if (response.profile) {
      this.profile.set(response.profile);
      localStorage.setItem('hope_profile', JSON.stringify(response.profile));
    }
  }
}
