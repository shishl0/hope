import { Component, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { PixelTitleComponent } from '../../shared/pixel-title/pixel-title.component';

@Component({
  selector: 'app-login',
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
        <h1>Вход</h1>
        <label>Никнейм <input name="nickname" [(ngModel)]="nickname" autocomplete="username"></label>
        <label>Пароль <input name="password" [(ngModel)]="password" type="password" autocomplete="current-password"></label>
        @if (error()) {
          <div class="error">{{ error() }}</div>
        }
        <div class="auth-actions">
          <button class="button primary auth-button" type="submit" [disabled]="loading()">
            {{ loading() ? 'Проверка...' : 'Войти' }}
          </button>
          <a routerLink="/register" class="button auth-button secondary">Создать</a>
        </div>
      </form>
    </main>
  `,
})
export class LoginComponent {
  nickname = '';
  password = '';
  loading = signal(false);
  error = signal('');

  constructor(private auth: AuthService, private router: Router) {}

  submit(): void {
    this.loading.set(true);
    this.error.set('');
    this.auth.login(this.nickname.trim(), this.password).subscribe({
      next: () => this.router.navigateByUrl('/profile'),
      error: () => {
        this.error.set('Никнейм или пароль не подходят.');
        this.loading.set(false);
      },
    });
  }
}
