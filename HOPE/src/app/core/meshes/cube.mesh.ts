import * as THREE from 'three';
import { CollisionObjectDto, MoveResponseDto, Vector3Dto } from '../game-network/player-state-dto';
import { ServerObjectState } from './server-object-state';

export class CubeMesh {

    readonly mash: THREE.Mesh;
    private readonly frontMarker: THREE.Mesh;
    readonly size: THREE.Vector3;
    readonly id: string;

    constructor(id: string, color = 0x00ff00, size = new THREE.Vector3(1, 1, 1)) {
        this.id = id;
        this.size = size.clone();

        const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
        const material = new THREE.MeshStandardMaterial({ color });

        this.mash = new THREE.Mesh(geometry, material);
        this.mash.castShadow = true;
        this.mash.receiveShadow = true;

        const markerGeometry = new THREE.BoxGeometry(size.x * 0.25, size.y * 0.25, size.z * 0.15);
        const markerMaterial = new THREE.MeshStandardMaterial({ color: 0xff3333 });
        this.frontMarker = new THREE.Mesh(markerGeometry, markerMaterial);
        this.frontMarker.position.set(0, size.y * 0.2, size.z / 2 + 0.08);
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

    applyMoveResponse(state: MoveResponseDto): void {
        this.mash.position.set(state.position.x, state.position.y, state.position.z);
        this.mash.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
    }

    applyStateSmoothly(state: ServerObjectState, deltaTime: number): void {
        // Smoothly interpolate position
        this.mash.position.lerp(state.position, deltaTime * 5); // Adjust the factor for speed
    }

    setColor(color: number): void {
        (this.mash.material as THREE.MeshStandardMaterial).color.setHex(color);
    }

    toCollisionDto(): CollisionObjectDto {
        return {
            id: this.id,
            position: this.vectorToDto(this.mash.position),
            rotation: this.vectorToDto(this.mash.rotation),
            size: this.vectorToDto(this.size),
        };
    }

    private vectorToDto(vector: THREE.Vector3 | THREE.Euler): Vector3Dto {
        return {
            x: vector.x,
            y: vector.y,
            z: vector.z,
        };
    }

    dispose(): void {
        this.mash.geometry.dispose();
        (this.mash.material as THREE.MeshStandardMaterial).dispose();
        this.frontMarker.geometry.dispose();
        (this.frontMarker.material as THREE.MeshStandardMaterial).dispose();
    }
}
