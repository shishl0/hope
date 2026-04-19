import { Injectable } from '@angular/core';
import * as THREE from 'three';

@Injectable({
  providedIn: 'root',
})
export class SceneService {

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private animationId!: number;

  init(canvas: HTMLCanvasElement): void {

    // Initialize the 3D scene using the provided canvas element

    console.log('Initializing scene with canvas:', canvas);

    // Here you would set up your WebGL context, load assets, etc.
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ canvas });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    // Ligth
    const light = new THREE.PointLight(0x404040); // soft white light
    light.position.set(10, 10, 10);
    this.scene.add(light);

    // Example: Add a simple cube to the scene
    const geometry = new THREE.BoxGeometry();
    const materilal = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const cube = new THREE.Mesh(geometry, materilal);

    this.scene.add(cube);
    this.camera.position.z = 5;

    //animate the cube
    this.animate(cube);

    // Start the render loop
    this.render();
  }

  private render(): void {
    // This method can be called to trigger a render, if needed
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private animate(mesh: THREE.Mesh): void {

    const loop = () => {
      // Update your scene, camera, etc. here
      mesh.rotateX(0.01);
      mesh.rotateY(0.01);

      // Render the scene
      this.render();


      // This method would contain your animation loop logic
      this.animationId = requestAnimationFrame(() => this.animate(mesh));
    }

    loop();

  }

  stop(): void {
    // Clean up resources, stop animations, etc.
    cancelAnimationFrame(this.animationId);
    console.log('Stopping scene and cleaning up resources.');
  }
}
