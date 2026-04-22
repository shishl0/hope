import { Injectable, NgZone } from '@angular/core';
import * as THREE from 'three';
import { BehaviorSubject } from 'rxjs';
import GUI from 'lil-gui';
import { VfxService } from './vfx.service';
import { T34TankMesh } from '../meshes/t34Tank.mesh';
import { Pz4TankMesh } from '../meshes/pz4Tank.mesh';
import { CameraService } from './camera';
import { AuthService } from '../services/auth.service';
import { ArenaMesh } from '../meshes/ArenaMesh';
import { LightService } from './light';

export interface PlayerStat {
  id: string;
  nick: string;
  kills: number;
  deaths: number;
  team: string;
}

export interface GameHudStats {
  fps: number;
  tps: number;
  ping: number;
  speed_kmh: number;
  velocity: number;
  at_wall: boolean;
  reload: number;
  connected: boolean;
  pos: { x: number, z: number };
  hp: number;
  dead: boolean;
  timer: number;
  redScore: number;
  blueScore: number;
  match_state: 'playing' | 'finished';
  winner: 'red' | 'blue' | 'draw' | null;
  restart_timer: number;
  leaderboard: PlayerStat[];
}

/** World bounds — MUST match ProtoTankConsumer */
const WORLD_MIN = -110;
const WORLD_MAX = 90;
const WORLD_CENTER_X = (WORLD_MIN + WORLD_MAX) / 2;  // -10
const WORLD_CENTER_Z = (WORLD_MIN + WORLD_MAX) / 2;  // -10
const WORLD_SIZE = WORLD_MAX - WORLD_MIN;             // 200

/** Per-frame Lerp factors */
const LERP_ALPHA_POS = 0.15;
const LERP_ALPHA_ROT = 0.12;

function lerpAngle(current: number, target: number, alpha: number): number {
  let delta = ((target - current) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  return current + delta * alpha;
}

@Injectable({
  providedIn: 'root'
})
export class SceneService {
  public scene: THREE.Scene;
  public renderer!: THREE.WebGLRenderer;
  public clock = new THREE.Clock();
  
  private tanks: Map<string, (T34TankMesh | Pz4TankMesh) & { targetPos?: THREE.Vector3, targetRot?: number, targetTurr?: number }> = new Map();
  private bullets: THREE.Mesh[] = [];
  private arena?: ArenaMesh;
  private reticleMesh!: THREE.Group;
  
  // HUD
  private hudSubject = new BehaviorSubject<GameHudStats>({
    fps: 0, tps: 0, ping: 0, speed_kmh: 0, velocity: 0, at_wall: false, reload: 0,
    connected: false, pos: { x: 0, z: 0 }, hp: 100, dead: false,
    timer: 540, redScore: 0, blueScore: 0, leaderboard: [],
    match_state: 'playing', winner: null, restart_timer: 0
  });
  public hud$ = this.hudSubject.asObservable();
  
  // Networking
  private socket?: WebSocket;
  private myId: string = '';
  private lastPingSent = 0;
  private pingValue = 0;
  private frames = 0;
  private lastFpsUpdate = 0;
  private tickCount = 0;

  // Input
  private keys: Record<string, boolean> = {};
  public keybindings = {
    forward: 'KeyW',
    backward: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    turretLeft: 'KeyU',
    turretRight: 'KeyI',
    fire: 'Space'
  };

  // Dev Mode
  private isDevMode = false;
  private gui?: GUI;

  constructor(
    private ngZone: NgZone, 
    private vfx: VfxService,
    private cameraService: CameraService,
    private auth: AuthService,
    private lightService: LightService
  ) {
    this.loadKeybindings();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9dc8e8); // Cinematic sky blue
    this.scene.fog = new THREE.FogExp2(0x9dc8e8, 0.005); // Fog matching sky
    
    this.lightService.createSunLight(this.scene);

    const floorGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x1a2e10, roughness: 0.9 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(WORLD_CENTER_X, 0, WORLD_CENTER_Z);
    floor.receiveShadow = true;
    this.scene.add(floor);

    const worldGrid = new THREE.GridHelper(WORLD_SIZE, 40, 0x2a4020, 0x1e3010);
    worldGrid.position.set(WORLD_CENTER_X, 0.01, WORLD_CENTER_Z);
    this.scene.add(worldGrid);

    this._buildBoundary();
    this._buildReticle();

    this.arena = new ArenaMesh('/3d_Models/arena-1.fbx');
    this.arena.addtoScene(this.scene);

    this.vfx.init(this.scene);
  }

  private _buildReticle(): void {
    this.reticleMesh = new THREE.Group();
    const crossGeoH = new THREE.PlaneGeometry(0.8, 0.15);
    const crossGeoV = new THREE.PlaneGeometry(0.15, 0.8);
    const crossMat = new THREE.MeshBasicMaterial({ 
      color: 0xff0000, 
      depthTest: false, 
      transparent: true, 
      opacity: 0.8, 
      side: THREE.DoubleSide 
    });
    const crossH = new THREE.Mesh(crossGeoH, crossMat);
    const crossV = new THREE.Mesh(crossGeoV, crossMat);
    crossH.renderOrder = 999;
    crossV.renderOrder = 999;
    this.reticleMesh.add(crossH);
    this.reticleMesh.add(crossV);
    this.scene.add(this.reticleMesh);
    this.reticleMesh.visible = false;
  }

  private _buildBoundary(): void {
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

    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xdd0000, emissive: 0x660000 });
    const pillarGeo = new THREE.BoxGeometry(0.6, 4, 0.6);
    for (const [px, pz] of [[mn, mn], [mx, mn], [mx, mx], [mn, mx]] as [number, number][]) {
      const p = new THREE.Mesh(pillarGeo, pillarMat);
      p.position.set(px, 2, pz);
      p.castShadow = true;
      this.scene.add(p);
    }
  }

  private sessionId: string = 'global';

  init(canvas: HTMLCanvasElement, sessionId: string = 'global') {
    this.sessionId = sessionId;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;

    this.cameraService.init(window.innerWidth / window.innerHeight, canvas);
    
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));

    this.start();
    this.animate();
  }

  private onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.cameraService.onResize(w / h);
  }

  private onKey(e: KeyboardEvent, isDown: boolean) {
    if (e.repeat) return;
    this.keys[e.code] = isDown;
    this.sendInput();
    
    if (isDown && e.code === 'F2') {
      this.toggleDevMode();
    }
  }

  private sendInput() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: 'input',
        forward: !!this.keys[this.keybindings.forward],
        backward: !!this.keys[this.keybindings.backward],
        hullRotateLeft: !!this.keys[this.keybindings.left],
        hullRotateRight: !!this.keys[this.keybindings.right],
        turretLeft: !!this.keys[this.keybindings.turretLeft],
        turretRight: !!this.keys[this.keybindings.turretRight],
        fire: !!this.keys[this.keybindings.fire]
      }));
    }
  }

  public setKey(action: keyof typeof this.keybindings, code: string) {
    (this.keybindings as any)[action] = code;
    localStorage.setItem('hope_keys', JSON.stringify(this.keybindings));
  }

  private loadKeybindings() {
    const saved = localStorage.getItem('hope_keys');
    if (saved) {
      try {
        this.keybindings = { ...this.keybindings, ...JSON.parse(saved) };
      } catch (e) {}
    }
  }

  start() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const nick = this.auth.profile()?.nickname || 'Guest';
    const token = localStorage.getItem('hope_access') || '';
    this.socket = new WebSocket(`${protocol}//${window.location.hostname}:8001/ws/proto-tank/${this.sessionId}/?nick=${encodeURIComponent(nick)}&token=${token}`);
    
    this.socket.onopen = () => {
      this.hudSubject.next({ ...this.hudSubject.value, connected: true });
      this.startPingLoop();
    };

    this.socket.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'init') {
        this.myId = data.id;
      } else if (data.type === 'pong') {
        this.pingValue = Date.now() - data.client_time;
      } else if (Array.isArray(data)) {
        if (this.tickCount % 100 === 0) console.log(`[Game] Received ${data[0].length} players. MyID: ${this.myId}`);
        this.updateState(data[0], data[1], data[2]);
        this.tickCount++;
      }
    };

    this.socket.onclose = () => {
      this.hudSubject.next({ ...this.hudSubject.value, connected: false });
    };
  }

  private startPingLoop() {
    setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'ping', client_time: Date.now() }));
      }
    }, 2000);
  }

  private animate() {
    this.ngZone.runOutsideAngular(() => {
      const loop = () => {
        const delta = this.clock.getDelta();
        this.frames++;
        
        const now = performance.now();
        if (now - this.lastFpsUpdate > 1000) {
          const fps = Math.round((this.frames * 1000) / (now - this.lastFpsUpdate));
          const tps = Math.round((this.tickCount * 1000) / (now - this.lastFpsUpdate));
          this.hudSubject.next({ ...this.hudSubject.value, fps, tps, ping: this.pingValue });
          this.frames = 0;
          this.tickCount = 0;
          this.lastFpsUpdate = now;
        }

        this.tanks.forEach((tank, id) => {
          if (tank.targetPos) {
            if (tank.mash.position.distanceTo(tank.targetPos) < 0.01) {
              tank.mash.position.copy(tank.targetPos);
            } else {
              tank.mash.position.lerp(tank.targetPos, LERP_ALPHA_POS);
            }
          }
          if (tank.targetRot !== undefined) {
            tank.mash.rotation.y = lerpAngle(tank.mash.rotation.y, tank.targetRot, LERP_ALPHA_ROT);
          }
          if (tank.targetTurr !== undefined) {
            tank.lerpTurretRotationY(tank.targetTurr, LERP_ALPHA_ROT);
          }

          if ((tank as any).isDead) {
            this.vfx.emitContinuousFire(tank.mash.position);
          }

          // Emit VFX (tracks/dust)
          const sp = (tank as any).currentSpeed || 0;
          this.vfx.emitForTank(tank.mash.position, tank.mash.rotation.y, sp, id === this.myId, tank.colliderSize.x, tank.colliderSize.y);
        });

        // ── Reticle / Crosshair logic ──
        const localTank = this.tanks.get(this.myId);
        if (localTank && !(localTank as any).isDead) {
          const muzzlePos = localTank.getMuzzleWorldPosition();
          const worldTurr = localTank.getTurretWorldYaw();
          const dir = new THREE.Vector3(Math.sin(worldTurr), 0, Math.cos(worldTurr));
          
          const raycaster = new THREE.Raycaster(muzzlePos, dir, 0, 100);
          const colliders: THREE.Object3D[] = [];
          if (this.arena) colliders.push(this.arena.mash);
          this.tanks.forEach((t, tid) => {
            if (tid !== this.myId && !(t as any).isDead) {
              colliders.push(t.getColliderMesh());
            }
          });
          
          const intersects = raycaster.intersectObjects(colliders, true);
          if (intersects.length > 0) {
            this.reticleMesh.position.copy(intersects[0].point);
          } else {
            this.reticleMesh.position.copy(muzzlePos).add(dir.multiplyScalar(40));
          }
          this.reticleMesh.visible = true;
          const cam = this.cameraService.getCamera();
          if (cam) this.reticleMesh.lookAt(cam.position);
        } else {
          this.reticleMesh.visible = false;
        }

        this.vfx.update(delta);

        // ── Bullet Extrapolation ──
        // Server runs at 20 TPS (50ms). vel is per-tick.
        // Units/sec = vel * 20
        for (const b of this.bullets) {
          if ((b as any).vel) {
            b.position.x += (b as any).vel.x * 20 * delta;
            b.position.z += (b as any).vel.z * 20 * delta;
          }
        }

        this.cameraService.updateControls();
        
        const myTank = this.tanks.get(this.myId);
        if (myTank) {
          this.cameraService.followTurretPivot(
            myTank.getTurretWorldPosition(),
            myTank.getTurretWorldYaw()
          );
        }

        this.renderer.render(this.scene, this.cameraService.getCamera());
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
  }

  updateState(players: any[], bullets: any[][], status?: any) {
    const currentIds = new Set(players.map(p => p.id));
    
    const leaderboard: PlayerStat[] = players.map(p => ({
        id: p.id,
        nick: p.nick,
        kills: p.k || 0,
        deaths: p.d || 0,
        team: p.tm
    })).sort((a, b) => b.kills - a.kills);

    const hudUpdate: any = { leaderboard };
    if (status) {
        hudUpdate.timer = status.timer;
        hudUpdate.redScore = status.score.red;
        hudUpdate.blueScore = status.score.blue;
        if (status.match_state) hudUpdate.match_state = status.match_state;
        if (status.winner !== undefined) hudUpdate.winner = status.winner;
        if (status.restart_timer !== undefined) hudUpdate.restart_timer = status.restart_timer;
    }

    for (const [id, tank] of this.tanks) {
      if (!currentIds.has(id)) {
        tank.removeFromScene(this.scene);
        tank.dispose();
        this.tanks.delete(id);
      }
    }
    
    for (const p of players) {
      let tank = this.tanks.get(p.id);
      
      if (!tank || (tank instanceof T34TankMesh && p.skin === 'pz4') || (tank instanceof Pz4TankMesh && p.skin === 't34')) {
        if (tank) {
            tank.removeFromScene(this.scene);
            tank.dispose();
        }
        
        tank = (p.skin === 'pz4') ? new Pz4TankMesh(p.id, p.c, p.nick) : new T34TankMesh(p.id, p.c, p.nick);
        tank.addtoScene(this.scene);
        this.tanks.set(p.id, tank);
        
        tank.mash.position.set(p.x, 0.35, p.z);
        tank.mash.rotation.y = p.ry;
        tank.targetPos = new THREE.Vector3(p.x, 0.35, p.z);
        tank.targetRot = p.ry;

        if (this.isDevMode) tank.enableDevHelpers();
      }
      
      if (tank) {
        if ((tank as any).lastHp !== undefined && p.hp < (tank as any).lastHp && p.hp > 0) {
          this.vfx.emitHit(tank.mash.position);
        }
        (tank as any).lastHp = p.hp;

        if (p.hp <= 30 && p.hp > 0) {
          if (Math.random() > 0.8) this.vfx.emitLightSmoke(tank.mash.position);
        }

        if ((tank as any).lastRld !== undefined && p.rld > 6.5 && (tank as any).lastRld < 1.0) {
            const worldTurr = tank.getTurretWorldYaw();
            const muzzlePos = new THREE.Vector3(
                tank.mash.position.x + Math.sin(worldTurr) * 3.5,
                tank.mash.position.y + 1.2,
                tank.mash.position.z + Math.cos(worldTurr) * 3.5
            );
            const dir = new THREE.Vector3(Math.sin(worldTurr), 0, Math.cos(worldTurr));
            this.vfx.emitMuzzleFlash(muzzlePos, dir);
        }
        (tank as any).lastRld = p.rld;

        tank.targetPos = new THREE.Vector3(p.x, 0.35, p.z);
        tank.targetRot = p.ry;
        tank.targetTurr = p.ty;
        (tank as any).setTeamColor(p.tm);
        (tank as any).setDead(p.dead === 1);
        (tank as any).isDead = (p.dead === 1);
        (tank as any).currentSpeed = p.sp;
        tank.mash.visible = true; 

        if (p.id === this.myId) {
          hudUpdate.speed_kmh = p.sp;
          hudUpdate.at_wall = !!p.w;
          hudUpdate.reload = p.rld;
          hudUpdate.pos = { x: p.x, z: p.z };
          hudUpdate.hp = p.hp;
          hudUpdate.dead = !!p.dead;
        }
      }
    }
    
    this.hudSubject.next({ ...this.hudSubject.value, ...hudUpdate });
    
    // ── Bullet Management ────────────────────────────────────
    const currentBulletCount = bullets.length;
    
    // Cleanup old bullets
    while (this.bullets.length > currentBulletCount) {
      const b = this.bullets.pop();
      if (b) this.scene.remove(b);
    }

    const bulletGeo = new THREE.SphereGeometry(0.2, 8, 8);
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });

    for (let i = 0; i < currentBulletCount; i++) {
      const bData = bullets[i]; // [x, z, vx, vz]
      let mesh = this.bullets[i];
      if (!mesh) {
        mesh = new THREE.Mesh(bulletGeo, bulletMat);
        this.scene.add(mesh);
        this.bullets[i] = mesh;
      }
      mesh.position.set(bData[0], 0.8, bData[1]);
      (mesh as any).vel = { x: bData[2], z: bData[3] };
    }
  }

  toggleDevMode() {
    this.isDevMode = !this.isDevMode;
    this.cameraService.setDevMode(this.isDevMode);
    
    if (this.isDevMode) {
      this.gui = new GUI();
      this.gui.title('Tank Calibration');
      this.tanks.forEach(tank => {
        tank.enableDevHelpers();
        const folder = this.gui!.addFolder(`Tank: ${tank instanceof T34TankMesh ? 'T34' : 'Pz4'}`);
        const body = folder.addFolder('Body');
        body.add(tank.bodyOffset, 'x', -5, 5).name('Off X').onChange(() => tank.updateDevOffsets());
        body.add(tank.bodyOffset, 'y', -5, 5).name('Off Y').onChange(() => tank.updateDevOffsets());
        body.add(tank.bodyOffset, 'z', -5, 5).name('Off Z').onChange(() => tank.updateDevOffsets());
        body.add(tank.bodyCenter, 'x', -15, 15).name('Cen X').onChange(() => tank.updateDevOffsets());
        body.add(tank.bodyCenter, 'y', -15, 15).name('Cen Y').onChange(() => tank.updateDevOffsets());
        body.add(tank.bodyCenter, 'z', -15, 15).name('Cen Z').onChange(() => tank.updateDevOffsets());
        body.add(tank.bodyRotation, 'y', -Math.PI, Math.PI).name('Rot Y').onChange(() => tank.updateDevOffsets());
        const turret = folder.addFolder('Turret');
        turret.add(tank.turretOffset, 'x', -5, 5).name('Off X').onChange(() => tank.updateDevOffsets());
        turret.add(tank.turretOffset, 'y', -5, 5).name('Off Y').onChange(() => tank.updateDevOffsets());
        turret.add(tank.turretOffset, 'z', -5, 5).name('Off Z').onChange(() => tank.updateDevOffsets());
        turret.add(tank.turretCenter, 'x', -15, 15).name('Cen X').onChange(() => tank.updateDevOffsets());
        turret.add(tank.turretCenter, 'y', -15, 15).name('Cen Y').onChange(() => tank.updateDevOffsets());
        turret.add(tank.turretCenter, 'z', -15, 15).name('Cen Z').onChange(() => tank.updateDevOffsets());
        turret.add(tank.turretRotation, 'y', -Math.PI, Math.PI).name('Rot Y').onChange(() => tank.updateDevOffsets());
        const muzzle = folder.addFolder('Muzzle');
        muzzle.add(tank.muzzleOffset, 'x', -5, 5).onChange(() => tank.updateDevOffsets());
        muzzle.add(tank.muzzleOffset, 'y', -5, 5).onChange(() => tank.updateDevOffsets());
        muzzle.add(tank.muzzleOffset, 'z', -5, 5).onChange(() => tank.updateDevOffsets());
        folder.open();
      });
    } else {
      this.tanks.forEach(tank => tank.disableDevHelpers());
      if (this.gui) {
        this.gui.destroy();
        this.gui = undefined;
      }
    }
  }

  stop() {
    this.socket?.close();
  }
}
