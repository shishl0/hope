import { inject, Injectable } from '@angular/core';
import * as THREE from 'three';
import { Subscription } from 'rxjs';

import { CameraService } from './camera';
import { RendererService } from './renderer';
import { LightService } from './light';

import { InputHandler } from '../input/input-handler';
import { PlayerInput } from '../input/player-input';
import { GameNetworkHandler } from '../game-network/game-network-handler';
import { PlayerStateDto } from '../game-network/player-state-dto';

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
  private cube?: CubeMesh;
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

    
    // Example: Add a simple cube to the scene
    this.cube = new CubeMesh();
    this.cube.addtoScene(this.scene);

    // input handling example
    this.InputHandler.startListening();
    this.inputSubscription = this.InputHandler.inputState$.subscribe(inputState => {
      this.inputState = inputState;
    });

    this.GameNetworkHandler.getPlayerState().subscribe({
      next: state => this.applyServerState(state),
      error: error => console.error('Could not load player state:', error),
    });

    this.animate();

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

  private animate(): void {

    const loop = (frameTime: number) => {
      this.syncCubeWithBackend();
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
    this.cube?.dispose();
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

  private syncCubeWithBackend(): void {
    if (!this.cube || this.requestInFlight || !this.hasMovementInput()) {
      return;
    }

    this.requestInFlight = true;

    this.GameNetworkHandler.sendPlayerInput(this.inputState).subscribe({
      next: state => this.applyServerState(state),
      error: error => {
        console.error('Could not sync player input:', error);
        this.requestInFlight = false;
      },
      complete: () => {
        this.requestInFlight = false;
      },
    });
  }

  private applyServerState(state: PlayerStateDto): void {
    if (!this.cube) {
      return;
    }

    const mesh = this.cube.mash;
    mesh.position.set(state.position.x, state.position.y, state.position.z);
    mesh.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
    this.CameraService.follow(mesh.position);
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
