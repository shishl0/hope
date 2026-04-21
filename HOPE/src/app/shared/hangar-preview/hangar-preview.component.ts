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

@Component({
  selector: 'app-hangar-preview',
  template: `<canvas #canvas class="hangar-canvas"></canvas>`,
})
export class HangarPreviewComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() tank?: Tank | null;

  canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private animationId = 0;
  private tankGroup = new THREE.Group();
  private loader = new FBXLoader();
  private resizeObserver?: ResizeObserver;
  private startedAt = performance.now();

  ngAfterViewInit(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;

    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.scene.fog = new THREE.Fog(0x081109, 14, 42);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
    this.camera.position.set(4.2, 2.45, 6.1);
    this.camera.lookAt(0, 1.05, 0);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.buildHangar();
    this.scene.add(this.tankGroup);
    this.loadSelectedTank();

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.animate();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['tank'] && this.scene) this.loadSelectedTank();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.animationId);
    this.resizeObserver?.disconnect();
    this.disposeGroup(this.tankGroup);
    this.renderer?.dispose();
  }

  private buildHangar(): void {
    if (!this.scene) return;

    const ambient = new THREE.HemisphereLight(0xbfd979, 0x07110b, 1.5);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xf2ffd9, 2.2);
    key.position.set(4, 8, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);

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
    this.disposeGroup(this.tankGroup);
    this.tankGroup.clear();

    const bodyKey = this.tank?.bodyModelKey || 't-34-body';
    const turretKey = this.tank?.turretModelKey || 't-34-tower';
    const tankMaterial = new THREE.MeshStandardMaterial({
      color: this.tank?.side === 'Germany' ? 0x596049 : 0x556f3a,
      roughness: 0.82,
      metalness: 0.12,
    });

    this.loader.load(`/3d_Models/${bodyKey}.fbx`, (body) => {
      this.prepareModel(body, tankMaterial);
      this.fitModel(body, 5.8);
      body.position.y = 0.38;
      this.tankGroup.add(body);
    });

    this.loader.load(`/3d_Models/${turretKey}.fbx`, (turret) => {
      this.prepareModel(turret, tankMaterial.clone());
      this.fitModel(turret, 2.45);
      turret.position.set(0, 1.68, 0.08);
      this.tankGroup.add(turret);
    });

    this.tankGroup.position.set(-0.25, 0.08, 0.7);
    this.tankGroup.rotation.y = -0.48;
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
    this.tankGroup.rotation.y = -0.48 + Math.sin(t * 0.8) * 0.04;
    this.tankGroup.position.y = 0.08 + Math.sin(t * 1.15) * 0.025;
    this.camera.position.x = 4.2 + Math.sin(t * 0.65) * 0.16;
    this.camera.position.y = 2.45 + Math.sin(t * 0.95) * 0.06;
    this.camera.lookAt(0, 1.05, 0);

    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas || !this.renderer || !this.camera) return;
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
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
