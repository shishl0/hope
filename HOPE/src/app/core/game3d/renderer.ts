import { Injectable } from '@angular/core';
import * as THREE from 'three';

@Injectable({
  providedIn: 'root',
})
export class RendererService {
  private renderer!: THREE.WebGLRenderer;
  private pixelRatio = 1;

  init(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
    // Disable antialias for major performance gain and prefer high-performance GPU
    this.renderer = new THREE.WebGLRenderer({ 
      canvas, 
      antialias: false,
      powerPreference: 'high-performance'
    });

    this.renderer.shadowMap.enabled = true;
    // Use standard PCF for faster rendering (Soft map is too heavy for 60fps full screen)
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.resizeToDisplaySize(canvas);

    return this.renderer;
  }

  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  onResize(canvas: HTMLCanvasElement): void {
    if (this.renderer) {
      this.resizeToDisplaySize(canvas);
    } else {
      console.warn('Renderer not initialized yet. Call init() before resizing.');
    }
  }

  resizeToDisplaySize(canvas: HTMLCanvasElement): boolean {
    const width = Math.max(1, canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, canvas.clientHeight || window.innerHeight);
    // Lock pixel ratio to 1. Retina displays rendering at 2x severely degrades FPS.
    const pixelRatio = 1;
    const bufferWidth = Math.floor(width * pixelRatio);
    const bufferHeight = Math.floor(height * pixelRatio);
    const needsResize =
      canvas.width !== bufferWidth ||
      canvas.height !== bufferHeight ||
      this.pixelRatio !== pixelRatio;

    if (needsResize) {
      this.pixelRatio = pixelRatio;
      this.renderer.setPixelRatio(pixelRatio);
      this.renderer.setSize(width, height, false);
    }

    return needsResize;
  }

}
