import { inject, Injectable, NgZone } from '@angular/core';
import * as THREE from 'three';
import { BehaviorSubject, Subscription } from 'rxjs';

import { CameraService } from './camera';
import { RendererService } from './renderer';
import { LightService } from './light';

import { InputHandler } from '../input/input-handler';
import { ProtoTankInput } from '../input/player-input';
import { ProtoTankWsService, WsStats } from '../game-network/proto-tank-ws.service';
import { ProtoTankMoveResponseDto } from '../game-network/player-state-dto';

import { ArenaMesh } from '../meshes/ArenaMesh';
import { ObstacleMesh } from '../meshes/ObstacleMesh';
import { ProtoTankMesh } from '../meshes/protoTank.mes';

type SceneMesh = ArenaMesh | ObstacleMesh | ProtoTankMesh;

/** Per-frame Lerp factor. */
const LERP_ALPHA = 0.15;

/** World bounds — MUST match ProtoTankConsumer */
const WORLD_MIN = -110;
const WORLD_MAX =   90;
const WORLD_CENTER_X = (WORLD_MIN + WORLD_MAX) / 2;  // -10
const WORLD_CENTER_Z = (WORLD_MIN + WORLD_MAX) / 2;  // -10
const WORLD_SIZE = WORLD_MAX - WORLD_MIN;             // 200

/**
 * Shortest-path angle lerp — prevents 360° flipping artefacts.
 * Both angles are normalised to (-π, π].
 */
function lerpAngle(current: number, target: number, alpha: number): number {
  let delta = ((target - current) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  return current + delta * alpha;
}

// ── Public HUD stats interface ────────────────────────────────────

export interface GameHudStats {
  fps:       number;
  tps:       number;
  ping:      number;
  speed_kmh: number;
  velocity:  number;
  at_wall:   boolean;
  connected: boolean;
  pos: { x: number; z: number };
}

// ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class SceneService {

  // Exposed to GameComponent for the HUD overlay
  readonly hud$ = new BehaviorSubject<GameHudStats>({
    fps: 0, tps: 0, ping: 0,
    speed_kmh: 0, velocity: 0,
    at_wall: false, connected: false,
    pos: { x: 0, z: 0 },
  });

  private scene!: THREE.Scene;
  private animationId!: number;
  private canvas?: HTMLCanvasElement;
  private resizeObserver?: ResizeObserver;

  private inputSub?: Subscription;
  private stateSub?: Subscription;
  private statsSub?: Subscription;

  private sceneObjects: SceneMesh[] = [];

  // Server-authoritative targets (updated on every server tick)
  private targetPos     = new THREE.Vector3(0, 0.35, 0);
  private targetRotY    = 0;
  private targetTurretY = 0;
  private lastState = { speed_kmh: 0, velocity: 0, at_wall: false };
  private wsStats: WsStats = { ping: 0, tps: 0, connected: false };

  // FPS counter
  private fpsFrames  = 0;
  private fpsLast    = performance.now();
  private currentFps = 0;

  private readonly CameraService   = inject(CameraService);
  private readonly RendererService = inject(RendererService);
  private readonly LightService    = inject(LightService);
  private readonly InputHandler    = inject(InputHandler);
  private readonly WsService       = inject(ProtoTankWsService);
  private readonly ngZone          = inject(NgZone);

  private lastHudUpdate = 0;
  private readonly HUD_INTERVAL = 100; // ms

  private readonly _onResize = () => this.resizeCanvasIfNeeded();


  // ── Init ─────────────────────────────────────────────────────────

  init(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a2a4a);
    // Blue atmospheric haze — density 0.005 visible ~200+ units away
    this.scene.fog = new THREE.FogExp2(0x2a4070, 0.005);

    this.RendererService.init(canvas);
    this.CameraService.init(
      (canvas.clientWidth || window.innerWidth) /
      (canvas.clientHeight || window.innerHeight)
    );

    this.LightService.createSunLight(this.scene);
    this._buildWorldGeometry();

    // ── Game objects ──────────────────────────────────────────────
    const arena = new ArenaMesh('/3d_Models/arena-1.fbx');
    arena.addtoScene(this.scene);

    const tank = new ProtoTankMesh('player', 0x2f8f46, new THREE.Vector3(1.6, 0.7, 2.4));
    tank.mash.position.set(0, 0.35, 0);
    tank.addtoScene(this.scene);

    const obs1 = new ObstacleMesh('obstacle-1', new THREE.Vector3(2, 1, 2));
    obs1.mash.position.set(0, 0.5, 5);
    obs1.addtoScene(this.scene);

    const obs2 = new ObstacleMesh('obstacle-2', new THREE.Vector3(2, 1, 2));
    obs2.mash.position.set(4, 0.5, 2);
    obs2.addtoScene(this.scene);

    this.sceneObjects = [arena, tank, obs1, obs2];

    // ── Network ───────────────────────────────────────────────────
    this.WsService.connect();

    // Receive server ticks → update lerp targets
    this.stateSub = this.WsService.state$.subscribe(s => this._applyState(s));

    // Receive ping/tps stats
    this.statsSub = this.WsService.stats$.subscribe(s => { this.wsStats = s; });

    // Forward key events to server on CHANGE only
    // (server now drives the physics loop — no polling needed)
    this.InputHandler.startListening();
    this.inputSub = this.InputHandler.getProtoTankInputObservable().subscribe(inp => {
      this.WsService.sendInput(inp);
    });

    // ── Render loop (Run outside Angular Zone for 60 FPS) ────────
    this.ngZone.runOutsideAngular(() => {
      this._animate(tank);
    });

    window.addEventListener('resize', this._onResize);
    this.resizeObserver = new ResizeObserver(this._onResize);
    this.resizeObserver.observe(canvas);
  }

  // ── World geometry (ground + red boundary) ────────────────────

  private _buildWorldGeometry(): void {
    const cx = WORLD_CENTER_X;
    const cz = WORLD_CENTER_Z;
    const sz = WORLD_SIZE;

    // Ground plane — centred on the world centre
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(sz, sz),
      new THREE.MeshStandardMaterial({ color: 0x1a2e10, roughness: 0.9 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, 0, cz);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Grid — same centre, 40 divisions
    const grid = new THREE.GridHelper(sz, 40, 0x2a4020, 0x1e3010);
    grid.position.set(cx, 0.01, cz);
    this.scene.add(grid);

    // ── Red boundary ────────────────────────────────────────────
    const mn = WORLD_MIN;
    const mx = WORLD_MAX;
    const by = 0.05;

    const corners = [
      new THREE.Vector3(mn, by, mn),
      new THREE.Vector3(mx, by, mn),
      new THREE.Vector3(mx, by, mx),
      new THREE.Vector3(mn, by, mx),
      new THREE.Vector3(mn, by, mn),
    ];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(corners);
    this.scene.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xff1111 })));

    // Corner pillars
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xdd0000, emissive: 0x660000 });
    const pillarGeo = new THREE.BoxGeometry(0.6, 4, 0.6);
    for (const [px, pz] of [[mn, mn], [mx, mn], [mx, mx], [mn, mx]] as [number, number][]) {
      const p = new THREE.Mesh(pillarGeo, pillarMat);
      p.position.set(px, 2, pz);
      p.castShadow = true;
      this.scene.add(p);
    }
  }

  // ── State application ─────────────────────────────────────────

  private _applyState(s: number[]): void {
    // Array format: [x, z, rot_y, turr_y, speed_kmh, at_wall]
    this.targetPos.set(s[0], 0.35, s[1]);
    this.targetRotY    = s[2];
    this.targetTurretY = s[3];
    this.lastState.speed_kmh = s[4];
    this.lastState.velocity  = s[4] / 3.6;
    this.lastState.at_wall   = s[5] === 1;
  }

  // ── Render loop ───────────────────────────────────────────────

  private _animate(tank: ProtoTankMesh): void {
    const loop = () => {
      this.animationId = requestAnimationFrame(loop);

      // FPS counter
      this.fpsFrames++;
      const now = performance.now();
      if (now - this.fpsLast >= 1000) {
        this.currentFps = this.fpsFrames;
        this.fpsFrames  = 0;
        this.fpsLast    = now;
      }

      // ── Lerp tank → server target ─────────────────────────────
      tank.mash.position.lerp(this.targetPos, LERP_ALPHA);
      // Use shortest-path lerp to avoid 360° flip artefact
      tank.mash.rotation.y = lerpAngle(tank.mash.rotation.y, this.targetRotY, LERP_ALPHA);
      tank.lerpTurretRotationY(this.targetTurretY, LERP_ALPHA);

      // ── Camera ────────────────────────────────────────────────
      this.CameraService.followTurretPivot(
        tank.getTurretWorldPosition(),
        tank.getTurretWorldYaw(),
      );

      // ── HUD (throttled to 10 Hz to reduce CD overhead) ────────
      if (now - this.lastHudUpdate >= this.HUD_INTERVAL) {
        this.lastHudUpdate = now;
        this.hud$.next({
          fps:       this.currentFps,
          tps:       this.wsStats.tps,
          ping:      this.wsStats.ping,
          speed_kmh: this.lastState.speed_kmh,
          velocity:  this.lastState.velocity,
          at_wall:   this.lastState.at_wall,
          connected: this.wsStats.connected,
          pos: {
            x: Math.round(tank.mash.position.x * 10) / 10,
            z: Math.round(tank.mash.position.z * 10) / 10,
          },
        });
      }

      this._render();
    };
    this.animationId = requestAnimationFrame(loop);
  }

  // ── Teardown ──────────────────────────────────────────────────

  stop(): void {
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this._onResize);
    this.resizeObserver?.disconnect();
    this.inputSub?.unsubscribe();
    this.stateSub?.unsubscribe();
    this.statsSub?.unsubscribe();
    this.InputHandler.stopListening();
    this.WsService.disconnect();
    this.sceneObjects.forEach(o => o.dispose());
    this.sceneObjects = [];
  }

  // ── Helpers ────────────────────────────────────────────────────

  private _render(): void {
    const r = this.RendererService.getRenderer();
    const c = this.CameraService.getCamera();
    if (r && this.scene && c) r.render(this.scene, c);
  }

  private resizeCanvasIfNeeded(): void {
    if (!this.canvas) return;
    if (this.RendererService.resizeToDisplaySize(this.canvas)) {
      this.CameraService.onResize(this.canvas.clientWidth / this.canvas.clientHeight);
    }
  }
}
