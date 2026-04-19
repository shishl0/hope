import { Component, AfterViewInit, OnDestroy, viewChild, ElementRef } from '@angular/core';
import { SceneService } from '../../game3d/scene';

@Component({
  selector: 'app-game',
  templateUrl: './game.html',
  styleUrl: './game.css',
})
export class GameComponent implements AfterViewInit, OnDestroy {

  canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('gameCanvas');

  constructor(private sceneService: SceneService) {}

  ngAfterViewInit(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (canvas) {
      this.sceneService.init(canvas);
    }
  }
  
  ngOnDestroy(): void {
    this.sceneService.stop();
  }

}
