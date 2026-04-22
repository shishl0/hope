import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  viewChild,
} from '@angular/core';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { Tank } from '../../models/tank';
import { T34TankMesh } from '../../core/meshes/t34Tank.mesh';
import { Pz4TankMesh } from '../../core/meshes/pz4Tank.mesh';

@Component({
  selector: 'app-hangar-preview',
  template: `
    <div class="hangar-container" #container>
      <canvas #canvas class="hangar-canvas"></canvas>
    </div>
  `,
})
export class HangarPreviewComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() tank?: Tank | null;

  canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  containerRef = viewChild<ElementRef<HTMLDivElement>>('container');

  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private animationId = 0;
  private currentTankMesh?: T34TankMesh | Pz4TankMesh;
  private resizeObserver?: ResizeObserver;
  private startedAt = performance.now();
  private lastLoadedTankId?: number;

  ngAfterViewInit(): void {
    const canvas = this.canvasRef()?.nativeElement;
    const container = this.containerRef()?.nativeElement;
    if (!canvas || !container) return;

    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.scene.fog = new THREE.Fog(0x1a1c12, 10, 35); // Slightly warmer/closer fog

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(4.8, 2.8, 6.5);
    this.camera.lookAt(0, 1.2, 0);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.buildHangar();
    this.loadSelectedTank();

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.animate();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['tank'] && this.scene) this.loadSelectedTank();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.animationId);
    this.resizeObserver?.disconnect();
    this.currentTankMesh?.dispose();
    this.renderer?.dispose();
  }

  private buildHangar(): void {
    if (!this.scene) return;

    const ambient = new THREE.HemisphereLight(0xfff5e0, 0x07110b, 1.8); // Golden sky
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffe4b0, 3.5); // Warm golden sun
    key.position.set(6, 12, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0005;
    this.scene.add(key);

    const fill = new THREE.PointLight(0xffaa44, 25, 20); // Warm secondary glow
    fill.position.set(-5, 4, 3);
    this.scene.add(fill);

    const lampMaterial = new THREE.MeshBasicMaterial({ color: 0xcce888 });
    for (const x of [-5, 0, 5]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.22), lampMaterial);
      lamp.position.set(x, 5.4, -3.8);
      this.scene.add(lamp);
    }

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 26),
      new THREE.MeshStandardMaterial({ color: 0x2e3328, roughness: 0.8, metalness: 0.04 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(30, 30, 0x8f8b4d, 0x41452f);
    grid.position.y = 0.012;
    this.scene.add(grid);

    const backWall = new THREE.Mesh(
      new THREE.BoxGeometry(26, 7, 0.35),
      new THREE.MeshStandardMaterial({ color: 0x1b2119, roughness: 0.9 }),
    );
    backWall.position.set(0, 3.2, -8.6);
    this.scene.add(backWall);

    const bayMat = new THREE.MeshStandardMaterial({ color: 0x253a1e, roughness: 0.9 });
    for (const x of [-7, 0, 7]) {
      const bay = new THREE.Mesh(new THREE.BoxGeometry(3.6, 4.8, 0.18), bayMat);
      bay.position.set(x, 2.4, -8.35);
      this.scene.add(bay);
    }

    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(3.8, 4.2, 0.32, 8),
      new THREE.MeshStandardMaterial({ color: 0x343d2b, roughness: 0.78, metalness: 0.12 }),
    );
    platform.position.y = 0.16;
    platform.receiveShadow = true;
    this.scene.add(platform);
  }

  private loadSelectedTank(): void {
    if (!this.scene) return;
    
    const tankId = this.tank?.id;
    if (tankId === this.lastLoadedTankId && this.currentTankMesh) return;
    this.lastLoadedTankId = tankId;

    if (this.currentTankMesh) {
      this.currentTankMesh.removeFromScene(this.scene);
      this.currentTankMesh.dispose();
      this.currentTankMesh = undefined;
    }

    const tankName = this.tank?.name || '';
    const side = this.tank?.side || '';
    const isAxis = side === 'Germany' || tankName.toLowerCase().includes('pz') || tankName.toLowerCase().includes('panzer');
    const color = isAxis ? 0x4444ff : 0xff4444;

    if (isAxis) {
      this.currentTankMesh = new Pz4TankMesh('preview', color, this.tank?.name);
    } else {
      this.currentTankMesh = new T34TankMesh('preview', color, this.tank?.name);
    }

    this.currentTankMesh.addtoScene(this.scene);
    this.currentTankMesh.mash.position.set(0, 0.35, 0);
    this.currentTankMesh.mash.rotation.y = -0.48;
  }

  private prepareModel(model: THREE.Object3D, material: THREE.Material): void {
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.material = material;
      }
    });
  }

  private fitModel(model: THREE.Object3D, targetWidth: number): void {
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    if (!size.x || !size.y || !size.z) return;

    model.position.sub(center);
    model.scale.multiplyScalar(targetWidth / Math.max(size.x, size.z));
  }

  private animate(): void {
    this.animationId = requestAnimationFrame(() => this.animate());
    if (!this.renderer || !this.scene || !this.camera) return;

    const t = (performance.now() - this.startedAt) / 1000;
    if (this.currentTankMesh) {
      this.currentTankMesh.mash.rotation.y = -0.48 + Math.sin(t * 0.8) * 0.04;
      this.currentTankMesh.mash.position.y = 0.35 + Math.sin(t * 1.15) * 0.025;
    }
    
    this.camera.position.x = 4.8 + Math.sin(t * 0.65) * 0.16;
    this.camera.position.y = 2.8 + Math.sin(t * 0.95) * 0.06;
    this.camera.lookAt(0, 1.2, 0);

    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const canvas = this.canvasRef()?.nativeElement;
    const container = this.containerRef()?.nativeElement;
    if (!canvas || !container || !this.renderer || !this.camera) return;

    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    
    // Check if size actually changed to avoid redundant updates
    if (canvas.width === width && canvas.height === height) return;

    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material.dispose();
      }
    });
  }
}
