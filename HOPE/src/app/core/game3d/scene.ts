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
  loadingProgress: number;
}

/** World bounds — MUST match ProtoTankConsumer */
const WORLD_MIN = -110;
const WORLD_MAX = 90;
const WORLD_CENTER_X = (WORLD_MIN + WORLD_MAX) / 2;  // -10
const WORLD_CENTER_Z = (WORLD_MIN + WORLD_MAX) / 2;  // -10
const WORLD_SIZE = WORLD_MAX - WORLD_MIN;             // 200

/** Per-frame Lerp factors */
const LERP_ALPHA_POS = 0.25;
const LERP_ALPHA_ROT = 0.20;

/** Physics Constants (must match backend-go/internal/game/physics.go) */
const TPS = 40;
const DT = 1.0 / TPS;
const MAX_V_FWD = (85.0 / 3.6) * DT;
const MAX_V_BWD = (30.0 / 3.6) * DT;
const ACCEL_BASE_FWD = 0.0021;
const ACCEL_BASE_BWD = 0.0018;
const ACCEL_EXP = 0.55;
const FRICTION = 0.0027;
const BRAKE_FORCE = 0.00975;
const TURRET_SPD = 0.0175;
const TURN_SLOW = 0.0325;
const TURN_FAST = 0.070;
const TURN_EXP = 0.6;
const WORLD_M_MIN = -110.0;
const WORLD_M_MAX = 90.0;

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
  
  private tanks: Map<string, (T34TankMesh | Pz4TankMesh) & { targetPos?: THREE.Vector3, targetRot?: number, targetTurr?: number, sp?: number, atWall?: boolean }> = new Map();
  private bullets: THREE.Mesh[] = [];
  private arena?: ArenaMesh;
  private reticleMesh!: THREE.Group;
  public loadingManager!: THREE.LoadingManager;
  
  // HUD
  private hudSubject = new BehaviorSubject<GameHudStats>({
    fps: 0, tps: 0, ping: 0, speed_kmh: 0, velocity: 0, at_wall: false, reload: 0,
    connected: false, pos: { x: 0, z: 0 }, hp: 100, dead: false,
    timer: 540, redScore: 0, blueScore: 0, leaderboard: [],
    match_state: 'playing', winner: null, restart_timer: 0, loadingProgress: 0
  });
  public hud$ = this.hudSubject.asObservable();
  
  // Networking
  private socket?: WebSocket;
  private reconnectTimeout: any;
  private intentionalDisconnect = false;
  private myId: string = '';
  private lastPingSent = 0;
  private pingValue = 0;
  private frames = 0;
  private lastFpsUpdate = 0;
  private tickCount = 0;

  // Input & Sync
  private keys: Record<string, boolean> = {};
  private inputSeq = 0;
  private pendingInputs: any[] = [];
  private serverPlayers: Map<string, any> = new Map();
  private stateBuffer: { t: number, p: any[] }[] = [];

  // Prediction
  private localState = {
    x: 0, z: 0,
    ry: 0, rv: 0,
    vx: 0, vz: 0,
    ty: 0,
    seq: 0
  };
  private inputHistory: { seq: number, input: any, state: any }[] = [];

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
    this.initLoadingManager();
    
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

    this.arena = new ArenaMesh('/3d_Models/arena-1.fbx', new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1), this.loadingManager);
    this.arena.addtoScene(this.scene);

    this.vfx.init(this.scene);
  }

  private initLoadingManager(): void {
    this.loadingManager = new THREE.LoadingManager();
    this.loadingManager.onStart = (url, itemsLoaded, itemsTotal) => {
        this.hudSubject.next({ ...this.hudSubject.value, loadingProgress: itemsLoaded / itemsTotal * 100 });
    };
    this.loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
        this.hudSubject.next({ ...this.hudSubject.value, loadingProgress: itemsLoaded / itemsTotal * 100 });
    };
    this.loadingManager.onLoad = () => {
        this.hudSubject.next({ ...this.hudSubject.value, loadingProgress: 100 });
    };
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
    try {
      this.sessionId = sessionId;
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window);
      
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: !isMobile,
        powerPreference: 'high-performance'
      });
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(isMobile ? 1 : Math.min(window.devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = !isMobile;

      this.cameraService.init(window.innerWidth / window.innerHeight, canvas);
      
      window.addEventListener('resize', () => this.onResize());
      window.addEventListener('keydown', (e) => this.onKey(e, true));
      window.addEventListener('keyup', (e) => this.onKey(e, false));

      this.start();
      this.animate();
    } catch (e: any) {
      alert("INIT ERROR: " + e.message);
    }
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

  public setKeyState(action: string, isDown: boolean) {
    const code = (this.keybindings as any)[action];
    if (code) {
      this.keys[code] = isDown;
      this.sendInput();
    }
  }

  private sendInput() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.inputSeq++;
      const input = {
        forward: !!this.keys[this.keybindings.forward],
        backward: !!this.keys[this.keybindings.backward],
        hullRotateLeft: !!this.keys[this.keybindings.left],
        hullRotateRight: !!this.keys[this.keybindings.right],
        turretLeft: !!this.keys[this.keybindings.turretLeft],
        turretRight: !!this.keys[this.keybindings.turretRight],
        fire: !!this.keys[this.keybindings.fire]
      };

      // Predict immediately
      this.applyPhysics(input);
      
      const inputData = {
        type: 'input',
        seq: this.inputSeq,
        ...input
      };
      
      this.inputHistory.push({ 
        seq: this.inputSeq, 
        input, 
        state: { ...this.localState } 
      });
      if (this.inputHistory.length > 200) this.inputHistory.shift();

      this.socket.send(JSON.stringify(inputData));
    }
  }

  private applyPhysics(inp: any) {
    // Replicate Go physics logic
    const speed = Math.sqrt(this.localState.vx ** 2 + this.localState.vz ** 2);
    const speedRatio = Math.min(speed / MAX_V_FWD, 1.0);
    const turnRate = TURN_SLOW + (TURN_FAST - TURN_SLOW) * Math.pow(speedRatio, TURN_EXP);
    const rotAccel = turnRate * 0.15;

    if (inp.hullRotateLeft) {
      this.localState.rv += rotAccel;
    } else if (inp.hullRotateRight) {
      this.localState.rv -= rotAccel;
    } else {
      this.localState.rv *= 0.82;
    }
    
    this.localState.rv = Math.max(-turnRate, Math.min(turnRate, this.localState.rv));
    this.localState.ry = this.normAngle(this.localState.ry + this.localState.rv);

    if (inp.turretLeft) this.localState.ty = this.normAngle(this.localState.ty + TURRET_SPD);
    if (inp.turretRight) this.localState.ty = this.normAngle(this.localState.ty - TURRET_SPD);

    const hx = Math.sin(this.localState.ry);
    const hz = Math.cos(this.localState.ry);
    let vf = this.localState.vx * hx + this.localState.vz * hz;
    let vl = this.localState.vx * hz - this.localState.vz * hx;

    if (inp.forward && !inp.backward) {
      if (vf >= 0) {
        vf = Math.min(vf + ACCEL_BASE_FWD * Math.pow(Math.max(0, 1 - (vf / MAX_V_FWD)), ACCEL_EXP), MAX_V_FWD);
      } else {
        vf = Math.min(0, vf + BRAKE_FORCE);
      }
    } else if (inp.backward && !inp.forward) {
      if (vf <= 0) {
        vf = Math.max(vf - ACCEL_BASE_BWD * Math.pow(Math.max(0, 1 - (Math.abs(vf) / MAX_V_BWD)), ACCEL_EXP), -MAX_V_BWD);
      } else {
        vf = Math.max(0, vf - BRAKE_FORCE);
      }
    } else {
      if (vf > 0) vf = Math.max(0, vf - FRICTION);
      else if (vf < 0) vf = Math.min(0, vf + FRICTION);
    }
    
    vl *= (speedRatio <= 0.45) ? 0.82 : 0.96;
    this.localState.vx = vf * hx + vl * hz;
    this.localState.vz = vf * hz - vl * hx;

    this.localState.x += this.localState.vx;
    this.localState.z += this.localState.vz;
    
    // Simple wall clamp
    this.localState.x = Math.max(WORLD_M_MIN + 2, Math.min(WORLD_M_MAX - 2, this.localState.x));
    this.localState.z = Math.max(WORLD_M_MIN + 2, Math.min(WORLD_M_MAX - 2, this.localState.z));
  }

  private normAngle(a: number): number {
    a = a % (2 * Math.PI);
    if (a > Math.PI) a -= 2 * Math.PI;
    if (a < -Math.PI) a += 2 * Math.PI;
    return a;
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
    this.intentionalDisconnect = false;
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const nick = this.auth.profile()?.nickname || 'Guest';
      const token = localStorage.getItem('hope_access') || '';
      
      this.socket = new WebSocket(`${protocol}//${window.location.hostname}:8080/ws/proto-tank/${this.sessionId}/?nick=${encodeURIComponent(nick)}&token=${token}`);
      
      this.socket.onopen = () => {
        this.hudSubject.next({ ...this.hudSubject.value, connected: true });
        this.startPingLoop();
      };
      
      this.socket.onerror = (err: any) => {
        // Silently handle WS errors to prevent alert spam, we'll auto-reconnect via onclose
      };
      
      this.socket.onclose = () => {
        this.hudSubject.next({ ...this.hudSubject.value, connected: false });
        if (!this.intentionalDisconnect) {
          this.reconnectTimeout = setTimeout(() => this.start(), 3000);
        }
      };

      this.socket.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === 'init') {
          this.myId = data.id;
        } else if (data.type === 'pong') {
          this.pingValue = Date.now() - data.client_time;
        } else if (data.p !== undefined) {
          // Delta Updates Processing
          if (data.full) {
            this.serverPlayers.clear();
          }
          for (const p of data.p) {
            this.serverPlayers.set(p.id, { ...(this.serverPlayers.get(p.id) || {}), ...p });
          }
          
          const fullPlayersArray = Array.from(this.serverPlayers.values());
          
          // Entity Interpolation Buffer
          this.stateBuffer.push({ t: performance.now(), p: JSON.parse(JSON.stringify(fullPlayersArray)) });
          if (this.stateBuffer.length > 30) this.stateBuffer.shift();

          // Server Reconciliation for Local Player
          const me = fullPlayersArray.find(p => p.id === this.myId);
          if (me && me.seq !== undefined) {
             // Remove inputs that the server has already processed
             while (this.inputHistory.length > 0 && this.inputHistory[0].seq <= me.seq) {
                 this.inputHistory.shift();
             }

             // Snap to server state as baseline
             this.localState.x = me.x;
             this.localState.z = me.z;
             this.localState.ry = me.ry;
             this.localState.ty = me.ty;
             // Note: Ideally we should also get vx/vz/rv from server to be 100% accurate,
             // but position is the most critical.

             // Re-apply all pending inputs to predict current position
             for (const item of this.inputHistory) {
                 this.applyPhysics(item.input);
                 item.state = { ...this.localState };
             }
          }

          this.updateState(fullPlayersArray, data.b || [], data.st);
          this.tickCount++;
        }
      };
    } catch (e: any) {
      console.error("START ERROR:", e);
    }
  }

  stop() {
    this.intentionalDisconnect = true;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.socket) {
      this.socket.close();
      this.socket = undefined;
    }
  }

  private startPingLoop() {
    setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'ping', client_time: Date.now() }));
      }
    }, 2000);
  }

  public animate() {
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

        // ── Client-Side Prediction & Interpolation ──
        this.tanks.forEach((tank, id) => {
          if (id === this.myId) {
             // Local tank uses predicted localState
             tank.mash.position.set(this.localState.x, 0.35, this.localState.z);
             tank.mash.rotation.y = this.localState.ry;
             tank.lerpTurretRotationY(this.localState.ty, 1.0);
          } else {
             // Interpolation for other tanks
             const renderTime = now - 100; // 100ms interpolation delay
             let s1 = this.stateBuffer[0];
             let s2 = this.stateBuffer[1];
             
             for (let i = 0; i < this.stateBuffer.length - 1; i++) {
               if (this.stateBuffer[i].t <= renderTime && this.stateBuffer[i+1].t >= renderTime) {
                 s1 = this.stateBuffer[i];
                 s2 = this.stateBuffer[i+1];
                 break;
               }
             }

             if (s1 && s2 && s2.t > s1.t) {
                 const p1 = s1.p.find((p: any) => p.id === id);
                 const p2 = s2.p.find((p: any) => p.id === id);
                 if (p1 && p2) {
                     const a = (renderTime - s1.t) / (s2.t - s1.t);
                     tank.mash.position.lerpVectors(new THREE.Vector3(p1.x, 0.35, p1.z), new THREE.Vector3(p2.x, 0.35, p2.z), a);
                     tank.mash.rotation.y = lerpAngle(p1.ry, p2.ry, a);
                     tank.lerpTurretRotationY(lerpAngle(p1.ty, p2.ty, a), 1.0);
                 }
             } else if (tank.targetPos) {
                 // Fallback if no interpolation data available
                 tank.mash.position.lerp(tank.targetPos, LERP_ALPHA_POS);
                 if (tank.targetRot !== undefined) tank.mash.rotation.y = lerpAngle(tank.mash.rotation.y, tank.targetRot, LERP_ALPHA_ROT);
                 if (tank.targetTurr !== undefined) tank.lerpTurretRotationY(tank.targetTurr, LERP_ALPHA_ROT);
             }
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
        
        tank = (p.skin === 'pz4') ? new Pz4TankMesh(p.id, p.c, p.nick, this.loadingManager) : new T34TankMesh(p.id, p.c, p.nick, this.loadingManager);
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

        // Target properties are still updated as fallback / state holding
        tank.targetPos = new THREE.Vector3(p.x, 0.35, p.z);
        tank.targetRot = p.ry;
        tank.targetTurr = p.ty;
        tank.sp = p.sp;
        tank.atWall = p.w === 1;
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


}
