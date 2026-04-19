import { Injectable } from '@angular/core';
import * as THREE from 'three';

@Injectable({
  providedIn: 'root',
})
export class RendererService {
  private renderer!: THREE.WebGLRenderer;
  private pixelRatio = 1;

  init(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
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
