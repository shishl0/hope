import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TankService } from '../../core/services/tank.service';
import { AuthService } from '../../core/services/auth.service';
import { Tank } from '../../models/tank';

@Component({
  selector: 'app-garage',
  imports: [RouterLink],
  template: `
    <main class="screen command-screen">
      <nav class="topbar">
        <a routerLink="/profile">Назад</a>
        <strong>Гараж</strong>
        <a routerLink="/lobby" class="button small primary">Играть</a>
      </nav>

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
            <button class="button primary" (click)="select(tank.id)">
              {{ selectedId() === tank.id ? 'Выбран' : 'Выбрать' }}
            </button>
          </article>
        }
      </section>
    </main>
  `,
})
export class GarageComponent implements OnInit {
  tanks = signal<Tank[]>([]);
  selectedId = signal<number | null>(null);

  constructor(private tanksApi: TankService, private auth: AuthService) {}

  ngOnInit(): void {
    this.auth.loadProfile().subscribe((profile) => this.selectedId.set(profile.selectedTank?.id || null));
    this.tanksApi.getTanks().subscribe((tanks) => this.tanks.set(tanks));
  }

  select(tankId: number): void {
    this.tanksApi.selectTank(tankId).subscribe((profile) => {
      this.selectedId.set(profile.selectedTank?.id || tankId);
      this.auth.profile.set(profile);
    });
  }
}
