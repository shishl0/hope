import * as THREE from 'three';
import { ServerObjectState } from './server-object-state';

export class CubeMesh {

    readonly mash: THREE.Mesh;
    private readonly frontMarker: THREE.Mesh;

    constructor() {
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshStandardMaterial({ color: 0x00ff00 });

        this.mash = new THREE.Mesh(geometry, material);
        this.mash.castShadow = true;
        this.mash.receiveShadow = true;

        const markerGeometry = new THREE.BoxGeometry(0.25, 0.25, 0.15);
        const markerMaterial = new THREE.MeshStandardMaterial({ color: 0xff3333 });
        this.frontMarker = new THREE.Mesh(markerGeometry, markerMaterial);
        this.frontMarker.position.set(0, 0.2, 0.58);
        this.mash.add(this.frontMarker);
    }

    addtoScene(scene: THREE.Scene): void {
        scene.add(this.mash);
    }

    removeFromScene(scene: THREE.Scene): void {
        scene.remove(this.mash);
    }

    applyState(state: ServerObjectState): void {
        this.mash.position.copy(state.position);
        this.mash.rotation.copy(state.rotation);
    }

    applyStateSmoothly(state: ServerObjectState, deltaTime: number): void {
        // Smoothly interpolate position
        this.mash.position.lerp(state.position, deltaTime * 5); // Adjust the factor for speed
    }

    setColor(color: number): void {
        (this.mash.material as THREE.MeshStandardMaterial).color.setHex(color);
    }

    dispose(): void {
        this.mash.geometry.dispose();
        (this.mash.material as THREE.MeshStandardMaterial).dispose();
        this.frontMarker.geometry.dispose();
        (this.frontMarker.material as THREE.MeshStandardMaterial).dispose();
    }
}
