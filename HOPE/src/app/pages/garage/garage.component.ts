import { Component, OnInit, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { TankService } from '../../core/services/tank.service';
import { AuthService } from '../../core/services/auth.service';
import { Tank } from '../../models/tank';

import { HangarPreviewComponent } from '../../shared/hangar-preview/hangar-preview.component';

@Component({
  selector: 'app-garage',
  imports: [RouterLink, RouterLinkActive, HangarPreviewComponent],
  template: `
    <main class="screen command-screen">
      <nav class="topbar">
        <div class="topnav">
          <a routerLink="/profile" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Профиль</a>
          <a routerLink="/garage" routerLinkActive="active">Танки</a>
          <a routerLink="/lobby" routerLinkActive="active">Лобби</a>
          <a routerLink="/friends" routerLinkActive="active">Друзья</a>
        </div>
        <a routerLink="/lobby" class="button small primary">Играть</a>
      </nav>

      <section class="garage-layout">
        <article class="panel garage-preview-card">
          <div>
            <p class="eyebrow">предпросмотр</p>
            <h1>{{ selectedTank()?.name || 'Танк не выбран' }}</h1>
            <p class="muted">{{ selectedTank()?.description || 'Выбери танк, чтобы увидеть его в ангаре.' }}</p>
          </div>
          <app-hangar-preview [tank]="selectedTank()"></app-hangar-preview>
        </article>

        <section class="tank-grid">
        @for (tank of tanks(); track tank.id) {
          <article class="panel tank-card" [class.selected]="selectedId() === tank.id">
            <div class="tank-icon">{{ tank.side === 'Germany' ? 'PZ' : 'T34' }}</div>
            <div>
              <p class="eyebrow">{{ tank.side }}</p>
              <h2>{{ tank.name }}</h2>
              <p class="muted">{{ tank.description }}</p>
            </div>
            <div class="tank-stats">
              <span>HP {{ tank.stats.maxHP }}</span>
              <span>DMG {{ tank.stats.bulletDamage }}</span>
              <span>SPD {{ tank.stats.moveSpeed }}</span>
            </div>
            <button class="button primary" [class.is-selected]="selectedId() === tank.id" (click)="select(tank.id)">
              {{ selectedId() === tank.id ? 'Выбран' : 'Выбрать' }}
            </button>
          </article>
        }
        </section>
      </section>
    </main>
  `,
})
export class GarageComponent implements OnInit {
  tanks = signal<Tank[]>([]);
  selectedId = signal<number | null>(null);

  constructor(private tanksApi: TankService, private auth: AuthService, private router: Router) {}

  ngOnInit(): void {
    this.auth.loadProfile().subscribe((profile) => this.selectedId.set(profile?.selectedTank?.id || null));
    this.tanksApi.getTanks().subscribe((tanks) => this.tanks.set(tanks));
  }

  selectedTank(): Tank | null {
    const selectedId = this.selectedId();
    return this.tanks().find((tank) => tank.id === selectedId) || null;
  }

  select(tankId: number): void {
    this.tanksApi.selectTank(tankId).subscribe((profile) => {
      this.selectedId.set(profile?.selectedTank?.id || tankId);
      this.auth.profile.set(profile);
      this.router.navigateByUrl('/profile');
    });
  }
}
