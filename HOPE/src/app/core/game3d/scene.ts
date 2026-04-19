import { inject, Injectable } from '@angular/core';
import * as THREE from 'three';

import { CameraService } from './camera';
import { RendererService } from './renderer';
import { LightService } from './light';


@Injectable({
  providedIn: 'root',
})
export class SceneService {

  private scene!: THREE.Scene;
  private animationId!: number;
  private canvas?: HTMLCanvasElement;
  private resizeObserver?: ResizeObserver;

  private CameraService = inject(CameraService);
  private RendererService = inject(RendererService);
  private LightService = inject(LightService);

  private is_greed_helpor_work: boolean = true;
  private readonly handleWindowResize = () => this.onWindowResize();

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
    const geometry = new THREE.BoxGeometry();
    const materilal = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
    const cube = new THREE.Mesh(geometry, materilal);

    this.scene.add(cube);

    //this.animate(cube);

    this.render();

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

  private animate(mesh: THREE.Mesh): void {

    const loop = () => {
      // Update your scene, camera, etc. here
      mesh.rotateX(0.01);
      mesh.rotateY(0.01);
      this.resizeCanvasIfNeeded();

      // Render the scene
      this.render();


      // This method would contain your animation loop logic
      this.animationId = requestAnimationFrame(loop);
    }

    loop();

  }

  stop(): void {
    // Clean up resources, stop animations, etc.
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.handleWindowResize);
    this.resizeObserver?.disconnect();
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
  
}
