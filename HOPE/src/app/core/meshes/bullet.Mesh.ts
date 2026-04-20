import * as THREE from 'three';
import { BulletStateDto } from '../game-network/player-state-dto';

export class BulletMesh {
    readonly id: string;
    readonly mash: THREE.Mesh;
    readonly size: THREE.Vector3;

    private readonly material: THREE.MeshStandardMaterial;
    private direction = new THREE.Vector3(0, 0, 1);

    constructor(id: string, size = new THREE.Vector3(0.18, 0.18, 0.18)) {
        this.id = id;
        this.size = size.clone();

        const geometry = new THREE.SphereGeometry(size.x / 2, 16, 12);
        this.material = new THREE.MeshStandardMaterial({
            color: 0xffd36a,
            emissive: 0xff9d2e,
            emissiveIntensity: 0.55,
            roughness: 0.35,
            metalness: 0.1,
        });

        this.mash = new THREE.Mesh(geometry, this.material);
        this.mash.castShadow = true;
    }

    addtoScene(scene: THREE.Scene): void {
        scene.add(this.mash);
    }

    removeFromScene(scene: THREE.Scene): void {
        scene.remove(this.mash);
    }

    applyBulletState(state: BulletStateDto): void {
        this.mash.position.set(state.position.x, state.position.y, state.position.z);
        this.direction.set(state.direction.x, state.direction.y, state.direction.z);
    }

    toBulletStateDto(): BulletStateDto {
        return {
            id: this.id,
            position: {
                x: this.mash.position.x,
                y: this.mash.position.y,
                z: this.mash.position.z,
            },
            direction: {
                x: this.direction.x,
                y: this.direction.y,
                z: this.direction.z,
            },
            size: {
                x: this.size.x,
                y: this.size.y,
                z: this.size.z,
            },
            alive: true,
        };
    }

    dispose(): void {
        this.mash.geometry.dispose();
        this.material.dispose();
    }
}
