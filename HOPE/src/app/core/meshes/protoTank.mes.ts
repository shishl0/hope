import * as THREE from 'three';
import { CollisionObjectDto, MoveResponseDto, Vector3Dto } from '../game-network/player-state-dto';

export class ProtoTankMesh {
    readonly id: string;
    readonly mash: THREE.Group;
    readonly size: THREE.Vector3;

    private readonly body: THREE.Mesh;
    private readonly turret: THREE.Mesh;
    private readonly cannon: THREE.Mesh;

    constructor(id: string, color = 0x2f8f46, size = new THREE.Vector3(1.6, 0.7, 2.4)) {
        this.id = id;
        this.size = size.clone();
        this.mash = new THREE.Group();

        const bodyGeometry = new THREE.BoxGeometry(size.x, size.y, size.z);
        const bodyMaterial = new THREE.MeshStandardMaterial({ color });
        this.body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        this.body.castShadow = true;
        this.body.receiveShadow = true;
        this.mash.add(this.body);

        const turretSize = Math.min(size.x, size.z) * 0.45;
        const turretGeometry = new THREE.BoxGeometry(turretSize, turretSize, turretSize);
        const turretMaterial = new THREE.MeshStandardMaterial({ color: 0x314b35 });
        this.turret = new THREE.Mesh(turretGeometry, turretMaterial);
        this.turret.position.y = size.y / 2 + turretSize / 2;
        this.turret.castShadow = true;
        this.turret.receiveShadow = true;
        this.mash.add(this.turret);

        const cannonLength = size.z * 0.75;
        const cannonRadius = Math.max(0.06, size.x * 0.05);
        const cannonGeometry = new THREE.CylinderGeometry(cannonRadius, cannonRadius, cannonLength, 16);
        const cannonMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
        this.cannon = new THREE.Mesh(cannonGeometry, cannonMaterial);
        this.cannon.rotation.x = Math.PI / 2;
        this.cannon.position.set(0, 0, turretSize / 2 + cannonLength / 2);
        this.cannon.castShadow = true;
        this.turret.add(this.cannon);
    }

    addtoScene(scene: THREE.Scene): void {
        scene.add(this.mash);
    }

    removeFromScene(scene: THREE.Scene): void {
        scene.remove(this.mash);
    }

    rotateTurret(direction: number, amount = 0.04): void {
        this.turret.rotation.y += direction * amount;
    }

    applyMoveResponse(state: MoveResponseDto): void {
        this.mash.position.set(state.position.x, state.position.y, state.position.z);
        this.mash.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
    }

    toCollisionDto(): CollisionObjectDto {
        return {
            id: this.id,
            position: this.vectorToDto(this.mash.position),
            rotation: this.vectorToDto(this.mash.rotation),
            size: this.vectorToDto(this.size),
        };
    }

    dispose(): void {
        this.body.geometry.dispose();
        (this.body.material as THREE.MeshStandardMaterial).dispose();
        this.turret.geometry.dispose();
        (this.turret.material as THREE.MeshStandardMaterial).dispose();
        this.cannon.geometry.dispose();
        (this.cannon.material as THREE.MeshStandardMaterial).dispose();
    }

    private vectorToDto(vector: THREE.Vector3 | THREE.Euler): Vector3Dto {
        return {
            x: vector.x,
            y: vector.y,
            z: vector.z,
        };
    }
}
