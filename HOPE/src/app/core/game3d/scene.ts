import { inject, Injectable, NgZone } from '@angular/core';
import * as THREE from 'three';
import { BehaviorSubject, Subscription } from 'rxjs';
import GUI from 'lil-gui';

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
import { T34TankMesh } from '../meshes/t34Tank.mesh';
import { Pz4TankMesh } from '../meshes/pz4Tank.mesh';
import { VfxService } from './vfx.service';

type SceneMesh = ArenaMesh | ObstacleMesh | ProtoTankMesh | BulletMesh | T34TankMesh | Pz4TankMesh;

/** Per-frame Lerp factor. */
const LERP_ALPHA = 0.15;

/** World bounds — MUST match ProtoTankConsumer */
const WORLD_MIN = -110;
const WORLD_MAX = 90;
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
  fps: number;
  tps: number;
  ping: number;
  speed_kmh: number;
  velocity: number;
  at_wall: boolean;
  reload: number;
  connected: boolean;
  pos: { x: number; z: number };
  hp: number;
  dead: boolean;
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
    hp: 100, dead: false
  });

  private scene!: THREE.Scene;
  private animationId!: number;
  private canvas?: HTMLCanvasElement;
  private resizeObserver?: ResizeObserver;

  private inputSub?: Subscription;
  private stateSub?: Subscription;
  private statsSub?: Subscription;

  private sceneObjects: SceneMesh[] = [];
  private players = new Map<string, any>();
  private targetPlayers = new Map<string, any>();
  private localPlayerId = '';

  // Server-authoritative targets (updated on every server tick)
  private targetPos = new THREE.Vector3(0, 0.35, 0);
  private lastState = { speed_kmh: 0, velocity: 0, at_wall: false, reload: 0, hp: 100, dead: false };
  private wsStats: WsStats = { ping: 0, tps: 0, connected: false };
  private bulletMeshes: BulletMesh[] = [];

  // FPS counter
  private fpsFrames = 0;
  private fpsLast = performance.now();
  private currentFps = 0;

  private readonly CameraService = inject(CameraService);
  private readonly RendererService = inject(RendererService);
  private readonly LightService = inject(LightService);
  private readonly InputHandler = inject(InputHandler);
  private readonly WsService = inject(ProtoTankWsService);
  private readonly VfxService = inject(VfxService);
  private readonly ngZone = inject(NgZone);

  private lastHudUpdate = 0;
  private readonly HUD_INTERVAL = 100; // ms

  private gui?: GUI;
  private reticleMesh?: THREE.Group;

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
      (canvas.clientHeight || window.innerHeight),
      canvas
    );

    this.LightService.createSunLight(this.scene);
    this._buildWorldGeometry();

    // ── Game objects ──────────────────────────────────────────────
    const arena = new ArenaMesh('/3d_Models/arena-1.fbx');
    arena.addtoScene(this.scene);

    this.sceneObjects = [arena];
    this.sceneObjects.forEach(o => o.addtoScene(this.scene));

    this.VfxService.init(this.scene);
    
    // ── Reticle ───────────────────────────────────────────────────
    this.reticleMesh = new THREE.Group();
    const crossGeoH = new THREE.PlaneGeometry(0.8, 0.15);
    const crossGeoV = new THREE.PlaneGeometry(0.15, 0.8);
    const crossMat = new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const crossH = new THREE.Mesh(crossGeoH, crossMat);
    const crossV = new THREE.Mesh(crossGeoV, crossMat);
    crossH.renderOrder = 999;
    crossV.renderOrder = 999;
    this.reticleMesh.add(crossH);
    this.reticleMesh.add(crossV);
    this.scene.add(this.reticleMesh);
    this.reticleMesh.visible = false;

    // ── Network ───────────────────────────────────────────────────
    this.WsService.myId$.subscribe(id => this.localPlayerId = id);
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

  private initDevGui(tank: T34TankMesh | Pz4TankMesh): void {
    if (this.gui) {
      this.gui.destroy();
    }
    this.gui = new GUI();

    const name = tank instanceof T34TankMesh ? 'T-34' : 'Panzer IV';
    const devSettings = {
      freeCam: false,
      showHelpers: false,
    };

    this.gui.add(devSettings, 'freeCam').name('Free Camera (Orbit)').onChange((v: boolean) => {
      this.CameraService.setDevMode(v);
      if (v) {
        this.InputHandler.stopListening();
      } else {
        this.InputHandler.startListening();
      }
    });

    const modelObj = { model: tank instanceof T34TankMesh ? 't34' : 'pz4', mode: 'ffa' };
    this.gui.add(modelObj, 'model', { 'T-34': 't34', 'Panzer IV': 'pz4' }).name('Change Tank Model').onChange((v: string) => {
      this.WsService.send({ type: 'change_tank', tank_type: v });
    });

    this.gui.add(modelObj, 'mode', { 'Deathmatch (FFA)': 'ffa', 'Team Deathmatch': 'team' }).name('Game Mode').onChange((v: string) => {
      this.WsService.send({ type: 'change_mode', mode: v });
    });

    this.gui.add(devSettings, 'showHelpers').name('Show Axes Centers').onChange((v: boolean) => {
      if (v) tank.enableDevHelpers();
      else tank.disableDevHelpers();
    });

    const updateOffsets = () => tank.updateDevOffsets();

    const bodyFolder = this.gui.addFolder(`${name} Body Settings`);
    const bodyPosFolder = bodyFolder.addFolder('Position Offset');
    bodyPosFolder.add(tank.bodyOffset, 'x', -100, 100, 0.01).onChange(updateOffsets);
    bodyPosFolder.add(tank.bodyOffset, 'y', -100, 100, 0.01).onChange(updateOffsets);
    bodyPosFolder.add(tank.bodyOffset, 'z', -100, 100, 0.01).onChange(updateOffsets);

    const bodyRotFolder = bodyFolder.addFolder('Rotation');
    bodyRotFolder.add(tank.bodyRotation, 'x', -Math.PI, Math.PI, 0.01).name('Rotate X').onChange(updateOffsets);
    bodyRotFolder.add(tank.bodyRotation, 'y', -Math.PI, Math.PI, 0.01).name('Rotate Y').onChange(updateOffsets);
    bodyRotFolder.add(tank.bodyRotation, 'z', -Math.PI, Math.PI, 0.01).name('Rotate Z').onChange(updateOffsets);

    const bodyCenterFolder = bodyFolder.addFolder('Center (Pivot) Shift');
    bodyCenterFolder.add(tank.bodyCenter, 'x', -100, 100, 0.01).onChange(updateOffsets);
    bodyCenterFolder.add(tank.bodyCenter, 'y', -100, 100, 0.01).onChange(updateOffsets);
    bodyCenterFolder.add(tank.bodyCenter, 'z', -100, 100, 0.01).onChange(updateOffsets);

    const turretFolder = this.gui.addFolder(`${name} Turret Settings`);
    const turretPosFolder = turretFolder.addFolder('Position Offset');
    turretPosFolder.add(tank.turretOffset, 'x', -100, 100, 0.01).onChange(updateOffsets);
    turretPosFolder.add(tank.turretOffset, 'y', -100, 100, 0.01).onChange(updateOffsets);
    turretPosFolder.add(tank.turretOffset, 'z', -100, 100, 0.01).onChange(updateOffsets);

    const turretRotFolder = turretFolder.addFolder('Rotation');
    turretRotFolder.add(tank.turretRotation, 'x', -Math.PI, Math.PI, 0.01).name('Rotate X').onChange(updateOffsets);
    turretRotFolder.add(tank.turretRotation, 'y', -Math.PI, Math.PI, 0.01).name('Rotate Y').onChange(updateOffsets);
    turretRotFolder.add(tank.turretRotation, 'z', -Math.PI, Math.PI, 0.01).name('Rotate Z').onChange(updateOffsets);

    const turretCenterFolder = turretFolder.addFolder('Center (Pivot) Shift');
    turretCenterFolder.add(tank.turretCenter, 'x', -100, 100, 0.01).onChange(updateOffsets);
    turretCenterFolder.add(tank.turretCenter, 'y', -100, 100, 0.01).onChange(updateOffsets);
    turretCenterFolder.add(tank.turretCenter, 'z', -100, 100, 0.01).onChange(updateOffsets);

    const muzzleFolder = this.gui.addFolder('Muzzle Calibration');
    muzzleFolder.add(tank.muzzleOffset, 'x', -50, 50, 0.01).onChange(updateOffsets);
    muzzleFolder.add(tank.muzzleOffset, 'y', -50, 50, 0.01).onChange(updateOffsets);
    muzzleFolder.add(tank.muzzleOffset, 'z', -50, 50, 0.01).onChange(updateOffsets);

    const colliderFolder = this.gui.addFolder('Collider (Hitbox) Dimensions');
    colliderFolder.add(tank.colliderSize, 'x', 0.1, 10, 0.1).name('Width (X)').onChange(updateOffsets);
    colliderFolder.add(tank.colliderSize, 'y', 0.1, 10, 0.1).name('Length (Z)').onChange(updateOffsets);
  }

  private _applyState(s: any[]): void {
    if (!s || s.length < 2) return;
    const playersData = s[0] as any[];
    const bulletData = s[1] as [number, number, number, number][];

    const activeIds = new Set<string>();

    for (const p of playersData) {
      activeIds.add(p.id);

      let tank = this.players.get(p.id) as any;
      const skin = p.skin || 't34';

      // Check if tank model type changed
      if (tank) {
        const currentType = tank instanceof T34TankMesh ? 't34' : (tank instanceof Pz4TankMesh ? 'pz4' : 'proto');
        if (currentType !== skin) {
          tank.removeFromScene(this.scene);
          tank.dispose();
          this.players.delete(p.id);
          tank = undefined;
        }
      }

      if (!tank) {
        const color = p.c !== undefined ? p.c : (Math.random() * 0xffffff);
        if (skin === 'pz4') {
          tank = new Pz4TankMesh(p.id, color);
        } else if (skin === 't34') {
          tank = new T34TankMesh(p.id, color);
        } else {
          tank = new ProtoTankMesh(p.id, color, new THREE.Vector3(1.6, 0.7, 2.4));
        }

        tank.addtoScene(this.scene);
        
        if (p.id !== this.localPlayerId) {
          const hpGroup = new THREE.Group();

          const hpGeo = new THREE.PlaneGeometry(3.0, 0.3);
          hpGeo.translate(1.5, 0, 0); // Origin at left edge so it shrinks from right
          const borderGeo = new THREE.PlaneGeometry(3.1, 0.4); // Outline background

          const hpMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, depthTest: false, side: THREE.DoubleSide });
          const borderMat = new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false, side: THREE.DoubleSide, opacity: 0.8, transparent: true });

          const hpMesh = new THREE.Mesh(hpGeo, hpMat);
          const borderMesh = new THREE.Mesh(borderGeo, borderMat);

          hpMesh.position.x = -1.5;
          borderMesh.position.z = -0.01;

          hpGroup.add(borderMesh);
          hpGroup.add(hpMesh);
          
          hpMesh.renderOrder = 998;
          borderMesh.renderOrder = 996;
          
          (tank as any).hpGroup = hpGroup;
          tank.hpMesh = hpMesh;
          
          this.scene.add(hpGroup);
        }

        this.players.set(p.id, tank);
        if (p.id === this.localPlayerId) this.initDevGui(tank);
      }

      this.targetPlayers.set(p.id, {
        pos: new THREE.Vector3(p.x, 0.35, p.z),
        rotY: p.ry,
        turrY: p.ty,
        sp: p.sp / 3.6, // velocity in m/s
        hp: p.hp,
        dead: p.dead === 1
      });

      if (p.id === this.localPlayerId) {
        this.lastState.hp = p.hp;
        this.lastState.dead = p.dead === 1;

        this.lastState.speed_kmh = p.sp;
        this.lastState.velocity = p.sp / 3.6;
        this.lastState.at_wall = p.w === 1;
        this.lastState.reload = p.rld;
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
        if (id === this.localPlayerId && this.gui) {
          this.gui.destroy();
          this.gui = undefined;
        }
      }
    }

    this._syncBullets(bulletData);
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
      bm.mash.position.set(data[i][0], 2.15, data[i][1]);
      (bm as any).vel = { x: data[i][2], z: data[i][3] };
      bm.mash.visible = true;
    }
  }

  // ── Render loop ───────────────────────────────────────────────

  private _animate(): void {
    let lastTime = performance.now();

    const loop = () => {
      this.animationId = requestAnimationFrame(loop);

      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1); // clamp dt to max 0.1s to prevent huge jumps
      lastTime = now;

      // FPS counter
      this.fpsFrames++;
      if (now - this.fpsLast >= 1000) {
        this.currentFps = this.fpsFrames;
        this.fpsFrames = 0;
        this.fpsLast = now;
      }

      // ── Orbit Controls (Dev Mode)
      this.CameraService.updateControls();

      // Frame-rate independent lerp alpha
      // Stiffnes parameter determines how fast it corrects (lower = buttery smooth, higher = faster snap)
      const STIFFNESS = 4.0;
      const alpha = 1 - Math.exp(-STIFFNESS * dt);

      // ── Lerp all players → server target ───────────────────────────
      for (const [id, tank] of this.players.entries()) {
        const target = this.targetPlayers.get(id);
        if (target) {
          if (target.dead) {
            if (!tank.wasDead) {
              this.VfxService.emitExplosion(tank.mash.position);
              tank.wasDead = true;
              if ((tank as any).hpGroup) (tank as any).hpGroup.visible = false;
              
              // Darken tank material to look burnt
              tank.mash.traverse((child: THREE.Object3D) => {
                 if ((child as THREE.Mesh).isMesh) {
                     const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
                     if (!mat.userData['origColor']) mat.userData['origColor'] = mat.color.getHex();
                     mat.color.setHex(0x111111);
                 }
              });
            }
            this.VfxService.emitContinuousFire(tank.mash.position);
          } else {
            if (tank.wasDead) {
               tank.wasDead = false;
               tank.lastHp = 100;
               if ((tank as any).hpGroup) (tank as any).hpGroup.visible = true;
               // Restore color
               tank.mash.traverse((child: THREE.Object3D) => {
                 if ((child as THREE.Mesh).isMesh) {
                     const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
                     if (mat.userData['origColor'] !== undefined) mat.color.setHex(mat.userData['origColor']);
                 }
              });
            }

            // Hit detection
            if (tank.lastHp !== undefined && target.hp < tank.lastHp && target.hp > 0) {
               this.VfxService.emitHit(tank.mash.position);
            }
            tank.lastHp = target.hp;

            // Low HP Smoke
            if (target.hp <= 30 && target.hp > 0) {
              if (Math.random() > 0.8) {
                this.VfxService.emitLightSmoke(tank.mash.position);
              }
            }

            // Firing VFX check
            if ((tank as any).lastRld !== undefined && target.rld > 6.5 && (tank as any).lastRld < 1.0) {
               const worldTurr = tank.getTurretWorldYaw();
               const muzzlePos = new THREE.Vector3(
                   tank.mash.position.x + Math.sin(worldTurr) * 3.5,
                   tank.mash.position.y + 1.2,
                   tank.mash.position.z + Math.cos(worldTurr) * 3.5
               );
               const dir = new THREE.Vector3(Math.sin(worldTurr), 0, Math.cos(worldTurr));
               this.VfxService.emitMuzzleFlash(muzzlePos, dir);
            }
            (tank as any).lastRld = target.rld;

            // Extrapolate target position using its velocity + rotation to hide server tick delay
            const speedMs = target.sp / 3.6; // convert from km/h to m/s
            target.pos.x += Math.sin(target.rotY) * speedMs * dt;
            target.pos.z += Math.cos(target.rotY) * speedMs * dt;

            tank.mash.position.lerp(target.pos, alpha);
            tank.mash.rotation.y = lerpAngle(tank.mash.rotation.y, target.rotY, alpha);
            tank.lerpTurretRotationY(target.turrY, alpha);
            
            this.VfxService.emitForTank(tank.mash.position, tank.mash.rotation.y, target.sp * 3.6, id === this.localPlayerId, tank.colliderSize.x, tank.colliderSize.y);
            
            // Adjust HP Bar for opponent
            if ((tank as any).hpGroup && tank.hpMesh) {
                const hpPercent = Math.max(0, target.hp) / 100.0;
                tank.hpMesh.scale.x = Math.max(0.01, hpPercent);
                // Position hpGroup directly above tank
                (tank as any).hpGroup.position.copy(tank.mash.position).setY(tank.mash.position.y + 4.5);
                // Force it to face camera
                const c = this.CameraService.getCamera();
                if (c) (tank as any).hpGroup.lookAt(c.position);
            }
          }
        }
      }

      // ── Local Player Reticle (Laser pointer) ──────────────────────
      if (this.localPlayerId && this.players.has(this.localPlayerId) && this.reticleMesh) {
          const myTank = this.players.get(this.localPlayerId)!;
          const targetNode = this.targetPlayers.get(this.localPlayerId);
          if (targetNode && !targetNode.dead) {
              const worldTurr = myTank.getTurretWorldYaw();
              const barrelPos = new THREE.Vector3(
                  myTank.mash.position.x + Math.sin(worldTurr) * 3.5,
                  myTank.mash.position.y + 1.2,
                  myTank.mash.position.z + Math.cos(worldTurr) * 3.5
              );
              const dir = new THREE.Vector3(Math.sin(worldTurr), 0, Math.cos(worldTurr)).normalize();
              
              const raycaster = new THREE.Raycaster(barrelPos, dir, 0, 100);
              
              const colliders: THREE.Object3D[] = [];
              // Add arena geometry (mesh inside arena)
              if (this.sceneObjects && this.sceneObjects.length > 0) {
                 colliders.push(this.sceneObjects[0].mash); 
              }
              // Add other tanks
              this.players.forEach((t, tid) => {
                  if (tid !== this.localPlayerId) colliders.push(t.mash);
              });
              
              const intersects = raycaster.intersectObjects(colliders, true); // recursive
              if (intersects.length > 0) {
                  this.reticleMesh.position.copy(intersects[0].point);
                  this.reticleMesh.visible = true;
              } else {
                  this.reticleMesh.position.copy(barrelPos).add(dir.multiplyScalar(40));
                  this.reticleMesh.visible = true;
              }
              // Make crosshair billboard to camera
              const cam = this.CameraService.getCamera();
              if (cam) this.reticleMesh.lookAt(cam.position);
          } else {
              this.reticleMesh.visible = false;
          }
      }

      this.VfxService.update(dt);

      // ── Bullet Extrapolation (Butter Smooth) ────────────────
      // Bullets natively travel at `vel.x` per server tick (50ms = 20 TPS). 
      // Speed in units/sec = vel / 0.05 = vel * 20
      for (const bm of this.bulletMeshes) {
        if (bm.mash.visible && (bm as any).vel) {
          bm.mash.position.x += (bm as any).vel.x * 20 * dt;
          bm.mash.position.z += (bm as any).vel.z * 20 * dt;
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
          fps: this.currentFps,
          tps: this.wsStats.tps,
          ping: this.wsStats.ping,
          speed_kmh: this.lastState.speed_kmh,
          velocity: this.lastState.velocity,
          at_wall: this.lastState.at_wall,
          reload: this.lastState.reload,
          connected: this.wsStats.connected,
          hp: this.lastState.hp,
          dead: this.lastState.dead,
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
    this.VfxService.dispose();
    this.sceneObjects.forEach(o => o.dispose());
    this.bulletMeshes.forEach(b => b.dispose());
    this.players.forEach(p => p.dispose());
    this.sceneObjects = [];
    this.bulletMeshes = [];
    this.players.clear();
    this.targetPlayers.clear();
    if (this.gui) {
      this.gui.destroy();
      this.gui = undefined;
    }
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
