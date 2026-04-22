import { Injectable } from '@angular/core';
import * as THREE from 'three';

const MAX_TRACKS = 1000;
const MAX_DUST = 200;

@Injectable({ providedIn: 'root' })
export class VfxService {
  private trackMesh!: THREE.InstancedMesh;
  private trackDummy = new THREE.Object3D();
  private trackData: { life: number; maxLife: number }[] = [];
  private trackIndex = 0;
  private currentTracks = 0;

  private dustMesh!: THREE.InstancedMesh;
  private dustDummy = new THREE.Object3D();
  private dustData: { life: number; maxLife: number; speed: number; type: number }[] = [];
  private dustIndex = 0;
  private currentDust = 0;

  private fireMesh!: THREE.InstancedMesh;
  private fireData: { life: number; maxLife: number; speed: number }[] = [];
  private fireIndex = 0;
  private currentFire = 0;

  constructor() {}

  init(scene: THREE.Scene): void {
    // ── Tracks (Skid marks) ────────────────────────────────────────────────
    const trackGeo = new THREE.PlaneGeometry(0.3, 0.4);
    // Rotate so it lays flat on the ground
    trackGeo.rotateX(-Math.PI / 2);
    
    const trackMat = new THREE.MeshBasicMaterial({
      color: 0x3d3024, // Generic dark dirt color
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    
    this.trackMesh = new THREE.InstancedMesh(trackGeo, trackMat, MAX_TRACKS);
    this.trackMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trackMesh.frustumCulled = false;
    
    // Hide all instances initially
    this.trackDummy.position.set(0, -999, 0);
    this.trackDummy.updateMatrix();
    for (let i = 0; i < MAX_TRACKS; i++) {
      this.trackData.push({ life: 0, maxLife: 0 });
      this.trackMesh.setMatrixAt(i, this.trackDummy.matrix);
    }
    this.trackMesh.instanceMatrix.needsUpdate = true;
    
    scene.add(this.trackMesh);

    // ── Dust Particles ──────────────────────────────────────────────────
    const dustGeo = new THREE.SphereGeometry(0.4, 6, 6);
    const dustMat = new THREE.MeshBasicMaterial({
      color: 0x6e5c47, // Lighter generic dirt color
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    
    this.dustMesh = new THREE.InstancedMesh(dustGeo, dustMat, MAX_DUST);
    this.dustMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dustMesh.frustumCulled = false;
    
    for (let i = 0; i < MAX_DUST; i++) {
        this.dustData.push({ life: 0, maxLife: 0, speed: 0, type: 0 });
        this.dustMesh.setMatrixAt(i, this.trackDummy.matrix); // hide initially
    }
    this.dustMesh.instanceMatrix.needsUpdate = true;
    
    scene.add(this.dustMesh);

    // ── Fire Particles ──────────────────────────────────────────────────
    const fireMat = new THREE.MeshBasicMaterial({
      color: 0xff6600, // Orange fire
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending // Makes it glow!
    });
    this.fireMesh = new THREE.InstancedMesh(dustGeo, fireMat, 200);
    this.fireMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fireMesh.frustumCulled = false;
    for (let i = 0; i < 200; i++) {
        this.fireData.push({ life: 0, maxLife: 0, speed: 0 });
        this.fireMesh.setMatrixAt(i, this.trackDummy.matrix);
    }
    this.fireMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.fireMesh);
  }

  /**
   * Called to emit dust and tracks for a tank.
   */
  emitForTank(pos: THREE.Vector3, rotY: number, speedKmh: number, isLocalPlayer: boolean, width: number = 3.0, length: number = 7.0): void {
    const minSpeedForMarks = 2.0;
    const minSpeedForDust = 8.0;

    if (speedKmh > minSpeedForMarks) {
      // Spawn tracks behind the tank. 
      const trackOffsetZ = length / 2 * -0.9;
      const trackOffsetX = width / 2 * 0.9;
      
      const vLeft = new THREE.Vector3(-trackOffsetX, 0.02, trackOffsetZ);
      const vRight = new THREE.Vector3(trackOffsetX, 0.02, trackOffsetZ);
      const yAxis = new THREE.Vector3(0, 1, 0);

      vLeft.applyAxisAngle(yAxis, rotY).add(pos);
      vRight.applyAxisAngle(yAxis, rotY).add(pos);
      
      this.spawnTrack(vLeft.x, vLeft.y, vLeft.z, rotY);
      this.spawnTrack(vRight.x, vRight.y, vRight.z, rotY);
      
      if (speedKmh > minSpeedForDust && Math.random() > 0.85) { // Further reduced dust freq
          this.spawnDust(vLeft.x + (Math.random() - 0.5) * 0.2, 0.1, vLeft.z + (Math.random() - 0.5) * 0.2);
          this.spawnDust(vRight.x + (Math.random() - 0.5) * 0.2, 0.1, vRight.z + (Math.random() - 0.5) * 0.2);
      }
    }
  }

  private spawnTrack(x: number, y: number, z: number, rotY: number): void {
    const idx = this.trackIndex;
    this.trackDummy.position.set(x, y, z);
    this.trackDummy.rotation.y = rotY;
    this.trackDummy.scale.set(1, 1, 1);
    this.trackDummy.updateMatrix();

    this.trackMesh.setMatrixAt(idx, this.trackDummy.matrix);
    this.trackMesh.instanceMatrix.needsUpdate = true;
    
    this.trackData[idx] = { life: 0, maxLife: 5.0 }; // Last 5 seconds

    this.trackIndex = (this.trackIndex + 1) % MAX_TRACKS;
    if (this.currentTracks < MAX_TRACKS) this.currentTracks++;
  }

  private spawnDust(x: number, y: number, z: number, burst: boolean = false, isHit: boolean = false): void {
    const idx = this.dustIndex;
    
    this.dustDummy.position.set(x, y, z);
    this.dustDummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    this.dustDummy.scale.set(1, 1, 1);
    // Darker color for hits
    if (isHit) {
      this.dustMesh.setColorAt(idx, new THREE.Color(0x222222));
    } else {
      this.dustMesh.setColorAt(idx, new THREE.Color(0x6e5c47));
    }
    this.dustMesh.instanceColor!.needsUpdate = true;

    this.dustDummy.updateMatrix();
    
    this.dustMesh.setMatrixAt(idx, this.dustDummy.matrix);
    this.dustMesh.instanceMatrix.needsUpdate = true;
    
    this.dustData[idx] = {
        life: 0,
        maxLife: burst ? 2.0 + Math.random() : 1.0 + Math.random() * 0.5,
        speed: burst ? 2.0 + Math.random() * 3.0 : 0.5 + Math.random() * 1.0,
        type: isHit ? 1 : 0
    };

    this.dustIndex = (this.dustIndex + 1) % MAX_DUST;
    if (this.currentDust < MAX_DUST) this.currentDust++;
  }

  private spawnFire(x: number, y: number, z: number): void {
    const idx = this.fireIndex;
    this.dustDummy.position.set(x, y, z);
    this.dustDummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    this.dustDummy.scale.set(1, 1, 1);
    this.dustDummy.updateMatrix();
    this.fireMesh.setMatrixAt(idx, this.dustDummy.matrix);
    this.fireMesh.instanceMatrix.needsUpdate = true;
    this.fireData[idx] = {
      life: 0,
      maxLife: 0.5 + Math.random() * 1.0,
      speed: 1.0 + Math.random() * 3.0
    };
    this.fireIndex = (this.fireIndex + 1) % 200;
    if (this.currentFire < 200) this.currentFire++;
  }

  emitExplosion(pos: THREE.Vector3): void {
    const BOOM_PARTICLES = 30;
    for (let i = 0; i < BOOM_PARTICLES; i++) {
        const x = pos.x + (Math.random() - 0.5) * 4;
        const y = 0.5 + Math.random() * 3;
        const z = pos.z + (Math.random() - 0.5) * 4;
        this.spawnDust(x, y, z, true);
        this.spawnFire(x, y, z);
    }
  }

  emitHit(pos: THREE.Vector3): void {
    for (let i = 0; i < 15; i++) {
        const x = pos.x + (Math.random() - 0.5) * 2;
        const y = 1.0 + Math.random() * 2;
        const z = pos.z + (Math.random() - 0.5) * 2;
        this.spawnDust(x, y, z, true, true);
        this.spawnFire(x, y, z); // Sparks
    }
  }

  emitLightSmoke(pos: THREE.Vector3): void {
     this.spawnDust(pos.x + (Math.random() - 0.5), pos.y + 0.5 + Math.random(), pos.z + (Math.random() - 0.5), false, true); // Dark smoke
  }

  emitMuzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3): void {
    // A quick burst of intense smoke propelled forward relative to the barrel
    for (let i = 0; i < 15; i++) {
        const x = pos.x + (Math.random() - 0.5) * 0.8 + dir.x * Math.random() * 2.0;
        const y = pos.y + (Math.random() - 0.5) * 0.8;
        const z = pos.z + (Math.random() - 0.5) * 0.8 + dir.z * Math.random() * 2.0;
        // Removed spawnFire here as per user request
        if (Math.random() > 0.1) {
            this.spawnDust(x, y, z, true, true); // Use dark smoke for gun powder
        }
    }
  }

  emitContinuousFire(pos: THREE.Vector3): void {
     // Spawn 1-2 fire particles per frame for burning effect
     for(let i = 0; i < 2; i++) {
        this.spawnFire(pos.x + (Math.random() - 0.5)*2, pos.y + 0.5 + Math.random(), pos.z + (Math.random() - 0.5)*2);
        if (Math.random() > 0.5) {
            this.spawnDust(pos.x + (Math.random() - 0.5), pos.y + 1 + Math.random(), pos.z + (Math.random() - 0.5), false, true); // Dark smoke
        }
     }
  }

  update(dt: number): void {
    if (!this.dustMesh || !this.trackMesh || !this.fireMesh) return;

    let dustUpdated = false;
    let trackUpdated = false;
    let fireUpdated = false;

    // Update tracks (shrink at end of life)
    for (let i = 0; i < this.currentTracks; i++) {
        const data = this.trackData[i];
        if (data.life < data.maxLife) {
            data.life += dt;
            const remaining = data.maxLife - data.life;
            if (remaining < 1.0) { // Slowly fade (scale down) in last 1 sec
                const s = Math.max(0, remaining);
                this.trackMesh.getMatrixAt(i, this.trackDummy.matrix);
                this.trackDummy.matrix.decompose(this.trackDummy.position, this.trackDummy.quaternion, this.trackDummy.scale);
                this.trackDummy.scale.set(s, s, s);
                if (s === 0) this.trackDummy.position.y = -999;
                
                this.trackDummy.updateMatrix();
                this.trackMesh.setMatrixAt(i, this.trackDummy.matrix);
                trackUpdated = true;
            }
        }
    }

    // Update dust
    for (let i = 0; i < this.currentDust; i++) {
        const data = this.dustData[i];
        if (data.life < data.maxLife) {
            data.life += dt;
            
            this.dustMesh.getMatrixAt(i, this.dustDummy.matrix);
            this.dustDummy.matrix.decompose(this.dustDummy.position, this.dustDummy.quaternion, this.dustDummy.scale);
            
            this.dustDummy.position.y += data.speed * dt;
            
            const normalizedLife = data.life / data.maxLife;
            const s = Math.max(0, 1.0 + Math.sin(normalizedLife * Math.PI) * 1.5 - normalizedLife);
            
            if (s > 0) {
                this.dustDummy.scale.set(s, s, s);
            } else {
                this.dustDummy.position.y = -999;
            }
            
            this.dustDummy.updateMatrix();
            this.dustMesh.setMatrixAt(i, this.dustDummy.matrix);
            dustUpdated = true;
        }
    }

    // Update fire
    for (let i = 0; i < this.currentFire; i++) {
        const data = this.fireData[i];
        if (data.life < data.maxLife) {
            data.life += dt;
            this.fireMesh.getMatrixAt(i, this.dustDummy.matrix);
            this.dustDummy.matrix.decompose(this.dustDummy.position, this.dustDummy.quaternion, this.dustDummy.scale);
            
            this.dustDummy.position.y += data.speed * dt;
            // Fire shrinks and disappears fast
            let s = 1.0 - (data.life / data.maxLife);
            if (s > 0) {
               this.dustDummy.scale.set(s*1.5, s*1.5, s*1.5);
            } else {
               this.dustDummy.position.y = -999;
            }
            this.dustDummy.updateMatrix();
            this.fireMesh.setMatrixAt(i, this.dustDummy.matrix);
            fireUpdated = true;
        }
    }

    if (dustUpdated) this.dustMesh.instanceMatrix.needsUpdate = true;
    if (trackUpdated) this.trackMesh.instanceMatrix.needsUpdate = true;
    if (fireUpdated) this.fireMesh.instanceMatrix.needsUpdate = true;
  }


  dispose(): void {
    if (this.trackMesh) {
      this.trackMesh.geometry.dispose();
      (this.trackMesh.material as THREE.Material).dispose();
    }
    if (this.dustMesh) {
      this.dustMesh.geometry.dispose();
      (this.dustMesh.material as THREE.Material).dispose();
    }
    if (this.fireMesh) {
      this.fireMesh.geometry.dispose();
      (this.fireMesh.material as THREE.Material).dispose();
    }
  }
}
