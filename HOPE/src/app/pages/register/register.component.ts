import { Component, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { PixelTitleComponent } from '../../shared/pixel-title/pixel-title.component';

@Component({
  selector: 'app-register',
  imports: [FormsModule, RouterLink, PixelTitleComponent],
  template: `
    <main class="screen auth-screen">
      <form class="panel auth-panel" (ngSubmit)="submit()">
        <div class="pixel-tank" aria-hidden="true">
          <span class="tank-square turret"></span>
          <span class="tank-square barrel"></span>
          <span class="tank-square body one"></span>
          <span class="tank-square body two"></span>
          <span class="tank-square body three"></span>
          <span class="tank-square track left"></span>
          <span class="tank-square track mid"></span>
          <span class="tank-square track right"></span>
        </div>
        <app-pixel-title />
        <h1>Регистрация</h1>
        <label>Никнейм <input name="nickname" [(ngModel)]="nickname" autocomplete="username"></label>
        <label>Пароль <input name="password" [(ngModel)]="password" type="password" autocomplete="new-password"></label>
        @if (error()) {
          <div class="error">{{ error() }}</div>
        }
        <div class="auth-actions">
          <button class="button primary auth-button" type="submit" [disabled]="loading()">
            {{ loading() ? 'Создание...' : 'Готово' }}
          </button>
          <a routerLink="/login" class="button auth-button secondary">Войти</a>
        </div>
      </form>
    </main>
  `,
})
export class RegisterComponent {
  nickname = '';
  password = '';
  loading = signal(false);
  error = signal('');

  constructor(private auth: AuthService, private router: Router) {}

  submit(): void {
    this.loading.set(true);
    this.error.set('');
    this.auth.register(this.nickname.trim(), this.password).subscribe({
      next: () => this.router.navigateByUrl('/profile'),
      error: (err) => {
        const nicknameError = err?.error?.nickname?.[0];
        this.error.set(this.translateError(nicknameError));
        this.loading.set(false);
      },
    });
  }

  private translateError(message?: string): string {
    if (!message) return 'Не удалось создать профиль.';
    if (message.includes('already taken')) return 'Такой ник уже занят.';
    if (message.includes('required')) return 'Введите никнейм.';
    return message;
  }
}
