import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { FriendService } from '../../core/services/friend.service';
import { FriendPlayer, FriendsSummary, LobbyInvite } from '../../models/friend';

@Component({
  selector: 'app-friends',
  imports: [FormsModule, RouterLink],
  template: `
    <main class="screen command-screen">
      <nav class="topbar">
        <div class="topnav">
          <a routerLink="/profile">Профиль</a>
          <a routerLink="/garage">Танки</a>
          <a routerLink="/lobby">Лобби</a>
          <a routerLink="/friends" class="active">Друзья</a>
        </div>
      </nav>

      <section class="friends-layout friends-layout-expanded">
        <article class="panel friend-add-panel">
          <p class="eyebrow">мой ID</p>
          <h1>{{ summary()?.playerId || '...' }}</h1>
          <label>
            ID друга
            <input name="friendId" [(ngModel)]="friendId" placeholder="XXXXXXXX">
          </label>
          @if (message()) {
            <div class="friend-message">{{ message() }}</div>
          }
          <button class="button primary" (click)="search()">Найти</button>

          @if (foundPlayer()) {
            <div class="found-player">
              <div class="avatar">{{ foundPlayer()?.avatar }}</div>
              <div>
                <strong>{{ foundPlayer()?.nickname }}</strong>
                <span>{{ foundPlayer()?.publicId }}</span>
              </div>
              <button class="button small primary" (click)="send()">Отправить заявку</button>
            </div>
          }
        </article>

        <article class="panel friend-list-panel friend-detail-panel">
          <h2>Профиль друга</h2>
          @if (selectedFriend()) {
            <div class="friend-profile-card">
              <div class="friend-profile-head">
                <div class="avatar large">{{ selectedFriend()?.avatar }}</div>
                <div>
                  <strong>{{ selectedFriend()?.nickname }}</strong>
                  <p>{{ selectedFriend()?.publicId }}</p>
                  <span class="status-chip" [class.online]="selectedFriend()?.isOnline">
                    {{ statusLabel(selectedFriend()) }}
                  </span>
                </div>
              </div>

              <div class="friend-profile-stats">
                <div><span>K/D</span><strong>{{ kdValue(selectedFriend()) }}</strong></div>
                <div><span>Матчи</span><strong>{{ selectedFriend()?.matchesPlayed || 0 }}</strong></div>
                <div><span>Убийства</span><strong>{{ selectedFriend()?.totalKills || 0 }}</strong></div>
                <div><span>Смерти</span><strong>{{ selectedFriend()?.totalDeaths || 0 }}</strong></div>
              </div>

              <div class="friend-profile-meta">
                <p>Танк: <strong>{{ selectedFriend()?.selectedTank?.name || 'не выбран' }}</strong></p>
                <p>Лобби: <strong>{{ selectedFriend()?.activeLobbyName || 'не в лобби' }}</strong></p>
              </div>

              <div class="friend-profile-actions">
                <button class="button" (click)="viewLobby()" [disabled]="!selectedFriend()?.activeLobbyId">Открыть лобби</button>
                <button class="button primary" (click)="inviteSelected()">Позвать в лобби</button>
              </div>
            </div>
          } @else {
            <div class="friend-empty">Выбери друга справа, чтобы увидеть профиль и пригласить в лобби.</div>
          }
        </article>

        <article class="panel friend-list-panel">
          <h2>Друзья</h2>
          @for (friend of summary()?.friends || []; track friend.publicId) {
            <button class="friend-row friend-row-button" (click)="selectFriend(friend.publicId)">
              <div class="avatar">{{ friend.avatar }}</div>
              <div class="friend-main">
                <strong>{{ friend.nickname }}</strong>
                <span>{{ friend.publicId }}</span>
              </div>
              <div class="friend-presence">
                <span class="status-chip" [class.online]="friend.isOnline">{{ statusLabel(friend) }}</span>
                @if (!friend.isOnline) {
                  <small>{{ lastSeenLabel(friend) }}</small>
                }
              </div>
            </button>
          } @empty {
            <div class="friend-empty">Пока нет друзей</div>
          }
        </article>

        <article class="panel friend-list-panel">
          <h2>Приглашения в лобби</h2>
          @for (invite of summary()?.incomingInvites || []; track invite.id) {
            <div class="friend-row invite-row">
              <div class="avatar">{{ invite.fromPlayer.avatar }}</div>
              <div class="friend-main">
                <strong>{{ invite.fromPlayer.nickname }}</strong>
                <span>{{ invite.lobbyName }}</span>
              </div>
              <button class="button small primary" (click)="acceptInvite(invite.id)">Войти</button>
              <button class="button small" (click)="declineInvite(invite.id)">Отказать</button>
            </div>
          } @empty {
            <div class="friend-empty">Нет входящих приглашений</div>
          }
        </article>

        <article class="panel friend-list-panel">
          <h2>Исходящие</h2>
          @for (request of summary()?.outgoing || []; track request.id) {
            <div class="friend-row">
              <div class="avatar">{{ request.toPlayer.avatar }}</div>
              <div class="friend-main">
                <strong>{{ request.toPlayer.nickname }}</strong>
                <span>ожидает дружбу</span>
              </div>
              <button class="button small" (click)="cancel(request.id)">Отменить</button>
            </div>
          } @empty {
            <div class="friend-empty">Нет исходящих заявок</div>
          }
        </article>

        <article class="panel friend-list-panel">
          <h2>Входящие</h2>
          @for (request of summary()?.incoming || []; track request.id) {
            <div class="friend-row">
              <div class="avatar">{{ request.fromPlayer.avatar }}</div>
              <div class="friend-main">
                <strong>{{ request.fromPlayer.nickname }}</strong>
                <span>{{ request.fromPlayer.publicId }}</span>
              </div>
              <button class="button small primary" (click)="accept(request.id)">Принять</button>
              <button class="button small" (click)="cancel(request.id)">Отклонить</button>
            </div>
          } @empty {
            <div class="friend-empty">Нет входящих заявок</div>
          }
        </article>
      </section>
    </main>
  `,
})
export class FriendsComponent implements OnInit, OnDestroy {
  summary = signal<FriendsSummary | null>(null);
  foundPlayer = signal<FriendPlayer | null>(null);
  selectedFriend = signal<FriendPlayer | null>(null);
  friendId = '';
  message = signal('');
  lobbyInviteToast = signal<LobbyInvite | null>(null);
  private selectedFriendId = signal<string | null>(null);
  readonly selectedFriendPublicId = computed(() => this.selectedFriendId());
  private pollId?: number;
  private knownInviteIds = new Set<number>();
  private toastTimeoutId?: number;

  constructor(
    private friendApi: FriendService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.load();
    this.pollId = window.setInterval(() => this.load(), 5000);
  }

  ngOnDestroy(): void {
    if (this.pollId) window.clearInterval(this.pollId);
    if (this.toastTimeoutId) window.clearTimeout(this.toastTimeoutId);
  }

  load(): void {
    this.friendApi.summary().subscribe((summary) => {
      this.handleIncomingInviteToast(summary);
      this.summary.set(summary);
      const selectedId = this.selectedFriendPublicId();
      if (selectedId) {
        const friendFromSummary = summary.friends.find((f) => f.publicId === selectedId);
        if (friendFromSummary && this.selectedFriend()) {
            // Update basic status in existing selected friend
            this.selectedFriend.update(cur => cur ? { ...cur, ...friendFromSummary } : null);
        } else if (!friendFromSummary) {
          this.selectedFriendId.set(null);
          this.selectedFriend.set(null);
        }
      }
    });
  }

  private handleIncomingInviteToast(summary: FriendsSummary): void {
    const incomingInvites = summary.incomingInvites || [];

    if (this.knownInviteIds.size === 0) {
      incomingInvites.forEach((invite) => this.knownInviteIds.add(invite.id));
      return;
    }

    const newInvite = incomingInvites.find((invite) => !this.knownInviteIds.has(invite.id));
    incomingInvites.forEach((invite) => this.knownInviteIds.add(invite.id));

    if (!newInvite) return;

    this.lobbyInviteToast.set(newInvite);
    if (this.toastTimeoutId) window.clearTimeout(this.toastTimeoutId);
    this.toastTimeoutId = window.setTimeout(() => {
      this.lobbyInviteToast.set(null);
      this.toastTimeoutId = undefined;
    }, 8001);
  }

  search(): void {
    this.message.set('');
    this.foundPlayer.set(null);
    this.friendApi.search(this.friendId.trim()).subscribe({
      next: (player) => this.foundPlayer.set(player),
      error: (err) => this.message.set(err?.error?.detail || 'Игрок не найден.'),
    });
  }

  send(): void {
    const player = this.foundPlayer();
    if (!player) return;
    this.message.set('');
    this.friendApi.sendRequest(player.publicId).subscribe({
      next: () => {
        this.friendId = '';
        this.foundPlayer.set(null);
        this.message.set('Заявка отправлена.');
        this.load();
      },
      error: (err) => this.message.set(err?.error?.detail || 'Не удалось отправить заявку.'),
    });
  }

  selectFriend(publicId: string, showMessage = false): void {
    this.selectedFriendId.set(publicId);
    this.friendApi.profile(publicId).subscribe({
      next: (friend) => this.selectedFriend.set(friend),
      error: (err) => {
        this.selectedFriend.set(null);
        if (showMessage) this.message.set(err?.error?.detail || 'Не удалось открыть профиль друга.');
      },
    });
  }

  inviteSelected(): void {
    const friend = this.selectedFriend();
    if (!friend) return;

    this.friendApi.inviteToLobby(friend.publicId).subscribe({
      next: (invite) => {
        this.message.set(`Приглашение отправлено в лобби ${invite.lobbyName}.`);
        this.load();
      },
      error: (err) => this.message.set(err?.error?.detail || 'Не удалось отправить приглашение.'),
    });
  }

  acceptInvite(inviteId: number): void {
    this.friendApi.acceptLobbyInvite(inviteId).subscribe((lobby) => {
      this.router.navigate(['/lobby', lobby.id]);
    });
  }

  declineInvite(inviteId: number): void {
    this.friendApi.declineLobbyInvite(inviteId).subscribe(() => this.load());
  }

  accept(requestId: number): void {
    this.friendApi.accept(requestId).subscribe(() => this.load());
  }

  cancel(requestId: number): void {
    this.friendApi.decline(requestId).subscribe(() => this.load());
  }

  viewLobby(): void {
    const lobbyId = this.selectedFriend()?.activeLobbyId;
    if (!lobbyId) return;
    this.router.navigate(['/lobby', lobbyId]);
  }

  statusLabel(friend: FriendPlayer | null): string {
    if (!friend) return 'неизвестно';
    if (friend.activeLobbyId) return 'в комнате';
    return friend.isOnline ? 'в сети' : this.lastSeenLabel(friend);
  }

  lastSeenLabel(friend: FriendPlayer | null): string {
    if (!friend || friend.daysSinceSeen == null) return 'давно не был';
    if (friend.daysSinceSeen <= 0) return 'был сегодня';
    if (friend.daysSinceSeen === 1) return 'был 1 день назад';
    return `был ${friend.daysSinceSeen} дн. назад`;
  }

  kdValue(friend: FriendPlayer | null): string {
    if (!friend) return '0.00';
    const kills = friend.totalKills || 0;
    const deaths = friend.totalDeaths || 0;
    if (deaths === 0) return kills.toFixed(2);
    return (kills / deaths).toFixed(2);
  }
}
