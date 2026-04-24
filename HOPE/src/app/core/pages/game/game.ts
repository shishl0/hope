import { Component, AfterViewInit, OnDestroy, OnInit, viewChild, ElementRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { SceneService, GameHudStats } from '../../game3d/scene';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-game',
  templateUrl: './game.html',
  styleUrl: './game.css',
  imports: [CommonModule],
})
export class GameComponent implements OnInit, AfterViewInit, OnDestroy {

  canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('gameCanvas');
  isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window);

  hud = signal<GameHudStats>({
    fps: 0, tps: 0, ping: 0,
    speed_kmh: 0, velocity: 0,
    at_wall: false, reload: 0, connected: false,
    pos: { x: 0, z: 0 },
    hp: 100, dead: false,
    timer: 540, redScore: 0, blueScore: 0, leaderboard: [],
    match_state: 'playing',
    winner: null,
    restart_timer: 0,
    loadingProgress: 0
  });

  private hudSub?: Subscription;

  constructor(
    public sceneService: SceneService,
    public auth: AuthService,
    private route: ActivatedRoute,
    private router: Router
  ) { }

  showLeaderboard = signal(false);
  showSettings = signal(false);
  rebindingAction = signal<string | null>(null);

  get keybindings() { return this.sceneService.keybindings; }

  getRedTeam() { return this.hud().leaderboard.filter(row => row.team === 'red'); }
  getBlueTeam() { return this.hud().leaderboard.filter(row => row.team === 'blue'); }

  ngOnInit(): void {
    this.hudSub = this.sceneService.hud$.subscribe(s => this.hud.set(s));
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef()?.nativeElement;
    const sessionId = this.route.snapshot.paramMap.get('id') || 'global';
    if (canvas) this.sceneService.init(canvas, sessionId);

    window.addEventListener('keydown', this.handleGlobalKey);
    window.addEventListener('keyup', this.handleGlobalKeyUp);
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.handleGlobalKey);
    window.removeEventListener('keyup', this.handleGlobalKeyUp);
    this.hudSub?.unsubscribe();
    this.sceneService.stop();
  }

  handleGlobalKey = (e: KeyboardEvent) => {
    if (e.code === 'Tab') {
      e.preventDefault();
      this.showLeaderboard.set(true);
    }
    if (e.code === 'Escape') {
      this.showSettings.set(!this.showSettings());
    }

    if (this.rebindingAction()) {
      e.preventDefault();
      this.sceneService.setKey(this.rebindingAction() as any, e.code);
      this.rebindingAction.set(null);
    }
  }

  handleGlobalKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Tab') {
      this.showLeaderboard.set(false);
    }
  }

  startRebind(action: string) {
    this.rebindingAction.set(action);
  }

  exitGame() {
    this.router.navigate(['/lobby']);
  }

  // ── Mobile Controls ──
  handleTouch(action: string, isDown: boolean, event: TouchEvent | MouseEvent) {
    event.preventDefault();
    this.sceneService.setKeyState(action, isDown);
  }

  formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  isMe(nick: string): boolean {
    return nick === this.auth.profile()?.nickname;
  }
}
