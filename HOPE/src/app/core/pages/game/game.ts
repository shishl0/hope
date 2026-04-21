import { Component, AfterViewInit, OnDestroy, OnInit, viewChild, ElementRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { SceneService, GameHudStats } from '../../game3d/scene';

@Component({
  selector: 'app-game',
  templateUrl: './game.html',
  styleUrl: './game.css',
  imports: [CommonModule],
})
export class GameComponent implements OnInit, AfterViewInit, OnDestroy {

  canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('gameCanvas');

  hud = signal<GameHudStats>({
    fps: 0, tps: 0, ping: 0,
    speed_kmh: 0, velocity: 0,
    at_wall: false, reload: 0, connected: false,
    pos: { x: 0, z: 0 },
    hp: 100, dead: false,
  });

  private hudSub?: Subscription;

  constructor(private sceneService: SceneService) {}

  ngOnInit(): void {
    this.hudSub = this.sceneService.hud$.subscribe(s => this.hud.set(s));
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (canvas) this.sceneService.init(canvas);
  }

  ngOnDestroy(): void {
    this.hudSub?.unsubscribe();
    this.sceneService.stop();
  }
}
