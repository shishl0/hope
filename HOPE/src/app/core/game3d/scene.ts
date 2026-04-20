import { inject, Injectable } from '@angular/core';
import * as THREE from 'three';
import { Subscription } from 'rxjs';

import { CameraService } from './camera';
import { RendererService } from './renderer';
import { LightService } from './light';

import { InputHandler } from '../input/input-handler';
import { ProtoTankInput } from '../input/player-input';
import { GameNetworkHandler } from '../game-network/game-network-handler';

import { ArenaMesh } from '../meshes/ArenaMesh';
import { ObstacleMesh } from '../meshes/ObstacleMesh';
import { ProtoTankMesh } from '../meshes/protoTank.mes';

type SceneMesh = ArenaMesh | ObstacleMesh | ProtoTankMesh;

@Injectable({
  providedIn: 'root',
})
export class SceneService {

  private scene!: THREE.Scene;
  private animationId!: number;
  private canvas?: HTMLCanvasElement;
  private resizeObserver?: ResizeObserver;
  private inputSubscription?: Subscription;
  private sceneObjects: SceneMesh[] = [];
  private requestInFlight = false;
  private protoTankInputState: ProtoTankInput = {
    forward: false,
    backward: false,
    hullRotateLeft: false,
    hullRotateRight: false,
    turretLeft: false,
    turretRight: false,
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

    const arena = new ArenaMesh('/3d_Models/arena-1.fbx');
    arena.addtoScene(this.scene);

    const tank = new ProtoTankMesh('player', 0x2f8f46, new THREE.Vector3(1.6, 0.7, 2.4));
    tank.mash.position.set(0, 0.35, 0);
    tank.addtoScene(this.scene);

    const obstacle = new ObstacleMesh('obstacle-1', new THREE.Vector3(2, 1, 2));
    obstacle.mash.position.set(0, 0.5, 5);
    obstacle.addtoScene(this.scene);

    const obstacle2 = new ObstacleMesh('obstacle-2', new THREE.Vector3(2, 1, 2));
    obstacle2.mash.position.set(4, 0.5, 2);
    obstacle2.addtoScene(this.scene);

    const obstacles = [obstacle, obstacle2];
    this.sceneObjects = [arena, tank, ...obstacles];

    // input handling example
    this.InputHandler.startListening();
    this.inputSubscription = this.InputHandler.getProtoTankInputObservable().subscribe(inputState => {
      this.protoTankInputState = inputState;
    });

    this.animate(tank, obstacles);

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

  private animate(tank: ProtoTankMesh, obstacles: ObstacleMesh[]): void {

    const loop = () => {
      this.syncProtoTankMovementWithBackend(tank, obstacles);
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

  private syncProtoTankMovementWithBackend(tank: ProtoTankMesh, obstacles: ObstacleMesh[]): void {
    if (this.requestInFlight || !this.hasProtoTankInput()) {
      return;
    }

    this.requestInFlight = true;

    this.GameNetworkHandler.sendProtoTankMoveInput({
      forward: this.protoTankInputState.forward,
      backward: this.protoTankInputState.backward,
      hullRotateLeft: this.protoTankInputState.hullRotateLeft,
      hullRotateRight: this.protoTankInputState.hullRotateRight,
      turretLeft: this.protoTankInputState.turretLeft,
      turretRight: this.protoTankInputState.turretRight,
      tank: tank.toCollisionDto(),
      turretRotation: tank.getTurretRotationDto(),
      cannonRotation: tank.getCannonRotationDto(),
      obstacles: obstacles.map(obstacle => obstacle.toCollisionDto()),
    }).subscribe({
      next: state => {
        tank.applyProtoTankMoveResponse(state);
        this.CameraService.followTurretPivot(tank.getTurretWorldPosition(), tank.getTurretWorldYaw());
      },
      error: error => {
        console.error('Could not sync proto tank input:', error);
        this.requestInFlight = false;
      },
      complete: () => {
        this.requestInFlight = false;
      },
    });
  }

  private hasProtoTankInput(): boolean {
    return (
      this.protoTankInputState.forward ||
      this.protoTankInputState.backward ||
      this.protoTankInputState.hullRotateLeft ||
      this.protoTankInputState.hullRotateRight ||
      this.protoTankInputState.turretLeft ||
      this.protoTankInputState.turretRight
    );
  }
  
}
