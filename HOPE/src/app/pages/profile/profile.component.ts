import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { PlayerProfile, kdRatio } from '../../models/player';

import { HangarPreviewComponent } from '../../shared/hangar-preview/hangar-preview.component';

@Component({
  selector: 'app-profile',
  imports: [FormsModule, RouterLink, RouterLinkActive, HangarPreviewComponent],
  template: `
    <main class="screen command-screen">
      <nav class="topbar">
        <div class="topnav">
          <a routerLink="/profile" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Профиль</a>
          <a routerLink="/garage" routerLinkActive="active">Танки</a>
          <a routerLink="/lobby" routerLinkActive="active">Лобби</a>
          <a routerLink="/friends" routerLinkActive="active">Друзья</a>
        </div>
        <button class="button small danger" (click)="auth.logout()">Выход</button>
      </nav>

      <section class="profile-layout">
        <article class="panel profile-card">
          <div class="profile-avatar">{{ avatar() }}</div>
          <div>
            <p class="eyebrow">профиль игрока</p>
            <h1>{{ profile()?.nickname || 'Танкист' }}</h1>
            <p class="muted">User ID: {{ profile()?.userId || '...' }}</p>
            <p class="muted">Public ID: {{ profile()?.publicId || '...' }}</p>
            <p class="muted">Выбранный танк: {{ profile()?.selectedTank?.name || 'не выбран' }}</p>
          </div>
        </article>

        <article class="panel stats-panel">
          <div class="stat-box"><span>K/D</span><strong>{{ kd() }}</strong></div>
          <div class="stat-box"><span>Убийства</span><strong>{{ profile()?.totalKills || 0 }}</strong></div>
          <div class="stat-box"><span>Смерти</span><strong>{{ profile()?.totalDeaths || 0 }}</strong></div>
          <div class="stat-box"><span>Матчи</span><strong>{{ profile()?.matchesPlayed || 0 }}</strong></div>
        </article>
      </section>

      <section class="profile-preview-section">
        <article class="panel garage-preview-card">
          <div>
            <p class="eyebrow">ангар</p>
            <h2>{{ profile()?.selectedTank?.name || 'Танк не выбран' }}</h2>
            <p class="muted">{{ profile()?.selectedTank?.description || 'Открой гараж и выбери танк для боя.' }}</p>
          </div>
          <app-hangar-preview [tank]="profile()?.selectedTank"></app-hangar-preview>
        </article>
      </section>

      <section class="profile-console">
        <article class="panel settings-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">настройки</p>
              <h2>Профиль и безопасность</h2>
            </div>
            <span class="status-chip online">активен</span>
          </div>

          <form class="settings-form" (ngSubmit)="saveNickname()">
            <label>
              Никнейм
              <input
                name="nickname"
                [(ngModel)]="nickname"
                maxlength="100"
                autocomplete="nickname"
                [disabled]="savingNickname()"
              >
            </label>
            <button class="button primary" type="submit" [disabled]="savingNickname() || !nickname.trim()">
              {{ savingNickname() ? 'Сохранение...' : 'Сменить никнейм' }}
            </button>
          </form>

          @if (nicknameMessage()) {
            <div class="notice success">{{ nicknameMessage() }}</div>
          }
          @if (nicknameError()) {
            <div class="notice error">{{ nicknameError() }}</div>
          }

          <form class="settings-form password-form" (ngSubmit)="savePassword()">
            <label>
              Текущий пароль
              <input
                name="currentPassword"
                [(ngModel)]="currentPassword"
                type="password"
                autocomplete="current-password"
                [disabled]="savingPassword()"
              >
            </label>
            <label>
              Новый пароль
              <input
                name="newPassword"
                [(ngModel)]="newPassword"
                type="password"
                autocomplete="new-password"
                [disabled]="savingPassword()"
              >
            </label>
            <button
              class="button"
              type="submit"
              [disabled]="savingPassword() || !currentPassword || !newPassword"
            >
              {{ savingPassword() ? 'Обновление...' : 'Сменить пароль' }}
            </button>
          </form>

          @if (passwordMessage()) {
            <div class="notice success">{{ passwordMessage() }}</div>
          }
          @if (passwordError()) {
            <div class="notice error">{{ passwordError() }}</div>
          }
        </article>

        <section class="profile-actions panel">
          <a routerLink="/garage" class="profile-action">
            <span class="action-kicker">Настройка</span>
            <strong>Танки</strong>
          </a>
          <a routerLink="/lobby" class="profile-action play">
            <span class="action-kicker">Быстрый старт</span>
            <strong>Играть</strong>
          </a>
        </section>
      </section>
    </main>
  `,
})
export class ProfileComponent implements OnInit {
  profile = signal<PlayerProfile | null>(null);
  kd = computed(() => kdRatio(this.profile()));
  avatar = computed(() => (this.profile()?.nickname || 'D').slice(0, 1).toUpperCase());

  nickname = '';
  currentPassword = '';
  newPassword = '';

  savingNickname = signal(false);
  savingPassword = signal(false);
  nicknameMessage = signal('');
  nicknameError = signal('');
  passwordMessage = signal('');
  passwordError = signal('');

  constructor(public auth: AuthService, private router: Router) {}

  ngOnInit(): void {
    const cachedProfile = this.auth.profile();
    if (cachedProfile) this.setProfile(cachedProfile);

    this.auth.loadProfile().subscribe({
      next: (profile) => {
          if (profile) this.setProfile(profile);
      },
      error: () => this.router.navigateByUrl('/login'),
    });
  }

  saveNickname(): void {
    this.savingNickname.set(true);
    this.nicknameMessage.set('');
    this.nicknameError.set('');
    this.auth.updateProfile(this.nickname.trim()).subscribe({
      next: (profile) => {
        this.setProfile(profile);
        this.nicknameMessage.set('Никнейм обновлен.');
        this.savingNickname.set(false);
      },
      error: (err) => {
        this.nicknameError.set(this.extractError(err, 'Не удалось обновить никнейм.'));
        this.savingNickname.set(false);
      },
    });
  }

  savePassword(): void {
    this.savingPassword.set(true);
    this.passwordMessage.set('');
    this.passwordError.set('');
    this.auth.changePassword(this.currentPassword, this.newPassword).subscribe({
      next: () => {
        this.currentPassword = '';
        this.newPassword = '';
        this.passwordMessage.set('Пароль обновлен.');
        this.savingPassword.set(false);
      },
      error: (err) => {
        this.passwordError.set(this.extractError(err, 'Не удалось обновить пароль.'));
        this.savingPassword.set(false);
      },
    });
  }

  private setProfile(profile: PlayerProfile): void {
    this.profile.set(profile);
    this.nickname = profile.nickname;
  }

  private extractError(err: any, fallback: string): string {
    const error = err?.error;
    if (typeof error?.detail === 'string') return error.detail;
    if (Array.isArray(error?.nickname) && error.nickname[0]) return error.nickname[0];
    if (Array.isArray(error?.currentPassword) && error.currentPassword[0]) return error.currentPassword[0];
    if (Array.isArray(error?.newPassword) && error.newPassword[0]) return error.newPassword[0];
    return fallback;
  }
}
