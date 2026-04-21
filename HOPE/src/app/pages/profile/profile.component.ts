import { Component, OnInit, computed, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { PlayerProfile, kdRatio } from '../../models/player';

@Component({
  selector: 'app-profile',
  imports: [RouterLink],
  template: `
    <main class="screen command-screen">
      <nav class="topbar">
        <div class="topnav">
          <a routerLink="/profile" class="active">Профиль</a>
          <a routerLink="/garage">Танки</a>
          <a routerLink="/lobby">Лобби</a>
          <a routerLink="/friends">Друзья</a>
        </div>
        <button class="button small danger" (click)="auth.logout()">Выход</button>
      </nav>

      <section class="profile-layout">
        <article class="panel profile-card">
          <div class="profile-avatar">{{ avatar() }}</div>
          <div>
            <p class="eyebrow">профиль игрока</p>
            <h1>{{ profile()?.nickname || 'Танкист' }}</h1>
            <p class="muted">ID: {{ profile()?.publicId || '...' }}</p>
            <p class="muted">Выбран: {{ profile()?.selectedTank?.name || 'не выбран' }}</p>
          </div>
        </article>

        <article class="panel stats-panel">
          <div class="stat-box"><span>K/D</span><strong>{{ kd() }}</strong></div>
          <div class="stat-box"><span>Убийства</span><strong>{{ profile()?.totalKills || 0 }}</strong></div>
          <div class="stat-box"><span>Смерти</span><strong>{{ profile()?.totalDeaths || 0 }}</strong></div>
          <div class="stat-box"><span>Матчи</span><strong>{{ profile()?.matchesPlayed || 0 }}</strong></div>
        </article>
      </section>

      <section class="profile-actions panel">
        <a routerLink="/garage" class="profile-action">Танки</a>
        <a routerLink="/lobby" class="profile-action play">Играть</a>
      </section>
    </main>
  `,
})
export class ProfileComponent implements OnInit {
  profile = signal<PlayerProfile | null>(null);
  kd = computed(() => kdRatio(this.profile()));
  avatar = computed(() => (this.profile()?.nickname || 'D').slice(0, 1).toUpperCase());

  constructor(public auth: AuthService, private router: Router) {}

  ngOnInit(): void {
    this.auth.loadProfile().subscribe({
      next: (profile) => this.profile.set(profile),
      error: () => this.router.navigateByUrl('/login'),
    });
  }
}
