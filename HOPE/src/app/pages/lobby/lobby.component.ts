import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LobbyService } from '../../core/services/lobby.service';
import { TankService } from '../../core/services/tank.service';
import { AuthService } from '../../core/services/auth.service';
import { Lobby } from '../../models/lobby';
import { Tank } from '../../models/tank';

@Component({
  selector: 'app-lobby',
  imports: [RouterLink],
  template: `
    <main class="screen command-screen">
      <nav class="topbar">
        <a routerLink="/profile">Профиль</a>
        <strong>Лобби</strong>
        <button class="button small primary" (click)="createLobby()">Создать комнату</button>
      </nav>

      @if (!currentLobby()) {
        <section class="lobby-list">
          @for (room of lobbies(); track room.id) {
            <button class="panel room-card" (click)="join(room.id)">
              <strong>{{ room.name }}</strong>
              <span>{{ room.player_count }}/{{ room.max_players }}</span>
            </button>
          } @empty {
            <div class="panel empty-room">Активных комнат нет. Создай первую.</div>
          }
        </section>
      } @else {
        <section class="panel lobby-room">
          <div class="room-head">
            <div>
              <p class="eyebrow">max 10 players</p>
              <h1>{{ currentLobby()?.name }}</h1>
            </div>
            <a class="button primary" [routerLink]="['/game', currentLobby()?.id]" (click)="enterGame()">Играть</a>
          </div>

          <div class="side-switch">
            <button class="button" (click)="setSide('allies')">СССР</button>
            <button class="button" (click)="setSide('axis')">Немцы</button>
          </div>

          <div class="lobby-tank-select">
            <p class="eyebrow">choose tank</p>
            <div class="lobby-tanks">
              @for (tank of tanks(); track tank.id) {
                <button
                  class="tank-pick"
                  [class.selected]="selectedTankId() === tank.id"
                  (click)="selectTank(tank.id)"
                >
                  <span class="tank-mark">{{ tank.side === 'Germany' ? 'PZ' : 'T34' }}</span>
                  <strong>{{ tank.name }}</strong>
                  <small>HP {{ tank.stats.maxHP }} / DMG {{ tank.stats.bulletDamage }}</small>
                </button>
              }
            </div>
          </div>

          <div class="teams-grid">
            <section class="team-panel">
              <h2>СССР</h2>
              <div class="team-slots">
                @for (slot of teamSlots('allies'); track $index) {
                  <div class="player-slot" [class.empty]="!slot">
                    @if (slot) {
                      <div class="avatar">{{ slot.avatar }}</div>
                      <strong>{{ slot.nickname }}</strong>
                      <span>{{ slot.selectedTank?.name || 'танк не выбран' }}</span>
                    } @else {
                      <div class="avatar">--</div>
                      <strong>Свободно</strong>
                      <span>ожидание</span>
                    }
                  </div>
                }
              </div>
            </section>

            <section class="team-panel">
              <h2>Немцы</h2>
              <div class="team-slots">
                @for (slot of teamSlots('axis'); track $index) {
                  <div class="player-slot" [class.empty]="!slot">
                    @if (slot) {
                      <div class="avatar">{{ slot.avatar }}</div>
                      <strong>{{ slot.nickname }}</strong>
                      <span>{{ slot.selectedTank?.name || 'танк не выбран' }}</span>
                    } @else {
                      <div class="avatar">--</div>
                      <strong>Свободно</strong>
                      <span>ожидание</span>
                    }
                  </div>
                }
              </div>
            </section>
          </div>
        </section>
      }
    </main>
  `,
})
export class LobbyComponent implements OnInit, OnDestroy {
  lobbies = signal<Lobby[]>([]);
  currentLobby = signal<Lobby | null>(null);
  tanks = signal<Tank[]>([]);
  selectedTankId = signal<number | null>(null);
  private pollId?: number;
  private enteringGame = false;

  constructor(
    private lobbyApi: LobbyService,
    private tankApi: TankService,
    private auth: AuthService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.tankApi.getTanks().subscribe((tanks) => this.tanks.set(tanks));
    this.auth.loadProfile().subscribe((profile) => {
      this.selectedTankId.set(profile.selectedTank?.id || null);
    });
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (id) {
      this.loadLobby(id);
      this.pollId = window.setInterval(() => this.loadLobby(id), 3000);
    } else {
      this.loadList();
    }
  }

  ngOnDestroy(): void {
    if (this.pollId) window.clearInterval(this.pollId);
    const routeLobbyId = Number(this.route.snapshot.paramMap.get('id'));
    const lobbyId = this.currentLobby()?.id;
    if (routeLobbyId && lobbyId && !this.enteringGame) {
      this.lobbyApi.leave(lobbyId).subscribe();
    }
  }

  teamSlots(side: 'allies' | 'axis') {
    const players = (this.currentLobby()?.players || []).filter((player) => player.side === side);
    return Array.from({ length: 5 }, (_, index) => players[index] || null);
  }

  loadList(): void {
    this.lobbyApi.list().subscribe((lobbies) => this.lobbies.set(lobbies));
  }

  loadLobby(id: number): void {
    this.lobbyApi.detail(id).subscribe({
      next: (lobby) => this.setCurrentLobby(lobby),
      error: () => {
        this.currentLobby.set(null);
        this.router.navigate(['/lobby']);
      },
    });
  }

  createLobby(): void {
    this.lobbyApi.create(`Room ${Math.floor(Math.random() * 900 + 100)}`).subscribe((lobby) => {
      this.setCurrentLobby(lobby);
      this.router.navigate(['/lobby', lobby.id]);
    });
  }

  join(id: number): void {
    this.lobbyApi.join(id).subscribe((lobby) => {
      this.setCurrentLobby(lobby);
      this.router.navigate(['/lobby', lobby.id]);
    });
  }

  setSide(side: 'allies' | 'axis'): void {
    const id = this.currentLobby()?.id;
    if (!id) return;
    this.lobbyApi.setSide(id, side).subscribe((lobby) => this.setCurrentLobby(lobby));
  }

  enterGame(): void {
    this.enteringGame = true;
  }

  sideLabel(side: 'allies' | 'axis'): string {
    return side === 'axis' ? 'Немцы' : 'СССР';
  }

  selectTank(tankId: number): void {
    this.tankApi.selectTank(tankId).subscribe(() => {
      this.selectedTankId.set(tankId);
      const id = this.currentLobby()?.id;
      if (id) this.loadLobby(id);
    });
  }

  private setCurrentLobby(lobby: Lobby): void {
    this.currentLobby.set(lobby);
  }
}
