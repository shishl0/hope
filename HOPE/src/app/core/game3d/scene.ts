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
import { BulletMesh } from '../meshes/bullet.Mesh';
import { ObstacleMesh } from '../meshes/ObstacleMesh';
import { ProtoTankMesh } from '../meshes/protoTank.mes';

type SceneMesh = ArenaMesh | ObstacleMesh | ProtoTankMesh | BulletMesh;

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
  reload:    number;
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
    at_wall: false, reload: 0, connected: false,
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
  private players = new Map<string, ProtoTankMesh>();
  private targetPlayers = new Map<string, any>();
  private localPlayerId = '';

  // Server-authoritative targets (updated on every server tick)
  private targetPos     = new THREE.Vector3(0, 0.35, 0);
  private lastState = { speed_kmh: 0, velocity: 0, at_wall: false, reload: 0 };
  private wsStats: WsStats = { ping: 0, tps: 0, connected: false };
  private bulletMeshes: BulletMesh[] = [];

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

    const obs1 = new ObstacleMesh('obstacle-1', new THREE.Vector3(2, 1, 2));
    obs1.mash.position.set(0, 0.5, 5);
    obs1.addtoScene(this.scene);

    const obs2 = new ObstacleMesh('obstacle-2', new THREE.Vector3(2, 1, 2));
    obs2.mash.position.set(4, 0.5, 2);
    obs2.addtoScene(this.scene);

    this.sceneObjects = [arena, obs1, obs2];

    // ── Network ───────────────────────────────────────────────────
    this.WsService.myId$.subscribe(id => this.localPlayerId = id);
    this.WsService.connect();
    this._ensureLocalTankPreview();

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
      this._animate();
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

  private _applyState(s: any[]): void {
    if (!s || s.length < 2) return;
    const playersData = s[0] as any[];
    const bulletData = s[1] as [number, number, number, number][];

    const activeIds = new Set<string>();

    for (const p of playersData) {
        activeIds.add(p.id);
        
        if (!this.players.has(p.id)) {
            const color = p.id === this.localPlayerId ? 0x2f8f46 : Math.random() * 0xffffff;
            const tank = new ProtoTankMesh(p.id, color, new THREE.Vector3(1.6, 0.7, 2.4));
            tank.addtoScene(this.scene);
            this.players.set(p.id, tank);
        }
        
        this.targetPlayers.set(p.id, {
            pos: new THREE.Vector3(p.x, 0.35, p.z),
            rotY: p.ry,
            turrY: p.ty
        });

        if (p.id === this.localPlayerId) {
            this.lastState.speed_kmh = p.sp;
            this.lastState.velocity  = p.sp / 3.6;
            this.lastState.at_wall   = p.w === 1;
            this.lastState.reload    = p.rld;
        }
    }
    
    // Remove disconnected players
    for (const id of Array.from(this.players.keys())) {
        if (!activeIds.has(id)) {
            const tank = this.players.get(id)!;
            tank.removeFromScene(this.scene);
            tank.dispose();
            this.players.delete(id);
            this.targetPlayers.delete(id);
        }
    }

    this._syncBullets(bulletData);
  }

  private _ensureLocalTankPreview(): void {
    const previewId = 'local-preview';
    if (this.players.has(previewId)) return;

    this.localPlayerId = previewId;
    const tank = new ProtoTankMesh(previewId, 0x2f8f46, new THREE.Vector3(1.6, 0.7, 2.4));
    tank.mash.position.set(0, 0.35, 0);
    tank.addtoScene(this.scene);
    this.players.set(previewId, tank);
    this.targetPlayers.set(previewId, {
      pos: new THREE.Vector3(0, 0.35, 0),
      rotY: 0,
      turrY: 0,
    });
  }

  private _syncBullets(data: [number, number, number, number][]): void {
    if (!data) return;
    
    while (this.bulletMeshes.length < data.length) {
      const bm = new BulletMesh(`b_${this.bulletMeshes.length}`);
      bm.addtoScene(this.scene);
      this.bulletMeshes.push(bm);
    }
    
    for (let i = data.length; i < this.bulletMeshes.length; i++) {
      this.bulletMeshes[i].mash.visible = false;
    }

    for (let i = 0; i < data.length; i++) {
        const bm = this.bulletMeshes[i];
        // Snap bullet to server pos every packet, then extrapolate
        bm.mash.position.set(data[i][0], 0.65, data[i][1]);
        (bm as any).vel = { x: data[i][2], z: data[i][3] };
        bm.mash.visible = true;
    }
  }

  // ── Render loop ───────────────────────────────────────────────

  private _animate(): void {
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

      // ── Lerp all players → server target ───────────────────────────
      for (const [id, tank] of this.players.entries()) {
          const target = this.targetPlayers.get(id);
          if (target) {
              tank.mash.position.lerp(target.pos, LERP_ALPHA);
              tank.mash.rotation.y = lerpAngle(tank.mash.rotation.y, target.rotY, LERP_ALPHA);
              tank.lerpTurretRotationY(target.turrY, LERP_ALPHA);
          }
      }

      // ── Bullet Extrapolation (Butter Smooth 60FPS) ────────────────
      // Bullets natively travel at `vel.x` per server tick (50ms). We run 60FPS (~16.6ms).
      // So we apply 1/3 of the velocity per frame.
      for (const bm of this.bulletMeshes) {
          if (bm.mash.visible && (bm as any).vel) {
              bm.mash.position.x += (bm as any).vel.x / 3;
              bm.mash.position.z += (bm as any).vel.z / 3;
          }
      }

      // ── Camera & Local HUD ───────────────────────────────────────
      const localTank = this.players.get(this.localPlayerId);
      if (localTank) {
          this.CameraService.followTurretPivot(
            localTank.getTurretWorldPosition(),
            localTank.getTurretWorldYaw(),
          );
      }

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
          reload:    this.lastState.reload,
          connected: this.wsStats.connected,
          pos: {
            x: localTank ? Math.round(localTank.mash.position.x * 10) / 10 : 0,
            z: localTank ? Math.round(localTank.mash.position.z * 10) / 10 : 0,
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
    this.bulletMeshes.forEach(b => b.dispose());
    this.players.forEach(p => p.dispose());
    this.sceneObjects = [];
    this.bulletMeshes = [];
    this.players.clear();
    this.targetPlayers.clear();
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
