import { inject, Injectable } from '@angular/core';
import * as THREE from 'three';
import { Subscription } from 'rxjs';

import { CameraService } from './camera';
import { RendererService } from './renderer';
import { LightService } from './light';

import { InputHandler } from '../input/input-handler';
import { PlayerInput } from '../input/player-input';
import { GameNetworkHandler } from '../game-network/game-network-handler';

import { CubeMesh } from '../meshes/cube.mesh';

@Injectable({
  providedIn: 'root',
})
export class SceneService {

  private scene!: THREE.Scene;
  private animationId!: number;
  private canvas?: HTMLCanvasElement;
  private resizeObserver?: ResizeObserver;
  private inputSubscription?: Subscription;
  private sceneObjects: CubeMesh[] = [];
  private requestInFlight = false;
  private inputState: PlayerInput = {
    forward: false,
    backward: false,
    rotateLeft: false,
    rotateRight: false,
    timestamp: Date.now(),
  };

  private CameraService = inject(CameraService);
  private RendererService = inject(RendererService);
  private LightService = inject(LightService);

  private is_greed_helpor_work: boolean = true;
  private readonly handleWindowResize = () => this.onWindowResize();

  private readonly InputHandler = inject(InputHandler);
  private readonly GameNetworkHandler = inject(GameNetworkHandler);

  private initWebGLContext(canvas: HTMLCanvasElement): void {
  // Here you would set up your WebGL context, load assets, etc.
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111111);
  }

  private greedHelperTurn(): void {
    // adding greed helper
    if (this.is_greed_helpor_work) {
      const gridHelper = new THREE.GridHelper(50, 50, 0x888888, 0x222222);
      this.scene.add(gridHelper);
    }
  }

  private initLigt(): void {
    this.LightService.createSunLight(this.scene);
  }

  init(canvas: HTMLCanvasElement): void {

    // Initialize the 3D scene using the provided canvas element

    console.log('Initializing scene with canvas:', canvas);
    this.canvas = canvas;

    this.initWebGLContext(canvas);
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;

    this.RendererService.init(canvas);
    this.CameraService.init(width / height);
    this.greedHelperTurn();
    this.initLigt();

    const cube = new CubeMesh('player', 0x00ff00, new THREE.Vector3(1, 1, 1));
    cube.mash.position.set(0, 0.5, 0);
    cube.addtoScene(this.scene);

    const obstacle = new CubeMesh('obstacle-1', 0x888888, new THREE.Vector3(2, 1, 2));
    obstacle.mash.position.set(0, 0.5, 5);
    obstacle.addtoScene(this.scene);

    const obstacle2 = new CubeMesh('obstacle-2', 0x888888, new THREE.Vector3(2, 1, 2));
    obstacle2.mash.position.set(4, 0.5, 2);
    obstacle2.addtoScene(this.scene);

    const obstacles = [obstacle, obstacle2];
    this.sceneObjects = [cube, ...obstacles];

    // input handling example
    this.InputHandler.startListening();
    this.inputSubscription = this.InputHandler.inputState$.subscribe(inputState => {
      this.inputState = inputState;
    });

    this.animate(cube, obstacles);

    window.addEventListener('resize', this.handleWindowResize);
    this.resizeObserver = new ResizeObserver(() => this.onWindowResize());
    this.resizeObserver.observe(canvas);
  }

  private render(): void {
    // This method can be called to trigger a render, if needed
    if (this.RendererService.getRenderer() && this.scene && this.CameraService.getCamera()) {
      this.RendererService.getRenderer().render(this.scene, this.CameraService.getCamera());
    }
  }

  private animate(cube: CubeMesh, obstacles: CubeMesh[]): void {

    const loop = (frameTime: number) => {
      this.syncCubeWithBackend(cube, obstacles);
      this.resizeCanvasIfNeeded();

      // Render the scene
      this.render();


      // This method would contain your animation loop logic
      this.animationId = requestAnimationFrame(loop);
    }

    this.animationId = requestAnimationFrame(loop);

  }

  stop(): void {
    // Clean up resources, stop animations, etc.
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.handleWindowResize);
    this.resizeObserver?.disconnect();
    this.inputSubscription?.unsubscribe();
    this.InputHandler.stopListening();
    this.sceneObjects.forEach(object => object.dispose());
    this.sceneObjects = [];
    console.log('Stopping scene and cleaning up resources.');
  }

  private onWindowResize(): void {
    this.resizeCanvasIfNeeded();
  }

  private resizeCanvasIfNeeded(): void {
    if (this.canvas && this.CameraService.getCamera() && this.RendererService.getRenderer()) {
      const canvas = this.canvas;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      if (this.RendererService.resizeToDisplaySize(canvas)) {
        this.CameraService.onResize(width / height);
      }
    }
  }

  private syncCubeWithBackend(cube: CubeMesh, obstacles: CubeMesh[]): void {
    if (this.requestInFlight || !this.hasMovementInput()) {
      return;
    }

    this.requestInFlight = true;

    this.GameNetworkHandler.sendPlayerInput({
      ...this.inputState,
      player: cube.toCollisionDto(),
      obstacles: obstacles.map(obstacle => obstacle.toCollisionDto()),
    }).subscribe({
      next: state => {
        cube.applyMoveResponse(state);
        this.CameraService.follow(cube.mash.position);
      },
      error: error => {
        console.error('Could not sync player input:', error);
        this.requestInFlight = false;
      },
      complete: () => {
        this.requestInFlight = false;
      },
    });
  }

  private hasMovementInput(): boolean {
    return (
      this.inputState.forward ||
      this.inputState.backward ||
      this.inputState.rotateLeft ||
      this.inputState.rotateRight
    );
  }
  
}
