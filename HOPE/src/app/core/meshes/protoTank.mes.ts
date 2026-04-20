import * as THREE from 'three';
import { CollisionObjectDto, ProtoTankMoveResponseDto, Vector3Dto } from '../game-network/player-state-dto';

export class ProtoTankMesh {
    readonly id: string;
    readonly mash: THREE.Group;
    readonly size: THREE.Vector3;

    private readonly body: THREE.Mesh;
    private readonly turret: THREE.Mesh;
    private readonly cannon: THREE.Mesh;
    private readonly cannonLength: number;

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

        this.cannonLength = size.z * 0.75;
        const cannonRadius = Math.max(0.06, size.x * 0.05);
        const cannonGeometry = new THREE.CylinderGeometry(cannonRadius, cannonRadius, this.cannonLength, 16);
        const cannonMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
        this.cannon = new THREE.Mesh(cannonGeometry, cannonMaterial);
        this.cannon.rotation.x = Math.PI / 2;
        this.cannon.position.set(0, 0, turretSize / 2 + this.cannonLength / 2);
        this.cannon.castShadow = true;
        this.turret.add(this.cannon);
    }

    addtoScene(scene: THREE.Scene): void {
        scene.add(this.mash);
    }

    removeFromScene(scene: THREE.Scene): void {
        scene.remove(this.mash);
    }

    applyProtoTankMoveResponse(state: ProtoTankMoveResponseDto): void {
        this.mash.position.set(state.position.x, state.position.y, state.position.z);
        this.mash.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
        this.turret.rotation.set(state.turretRotation.x, state.turretRotation.y, state.turretRotation.z);
        this.cannon.rotation.set(state.cannonRotation.x, state.cannonRotation.y, state.cannonRotation.z);
    }

    toCollisionDto(): CollisionObjectDto {
        return {
            id: this.id,
            position: this.vectorToDto(this.mash.position),
            rotation: this.vectorToDto(this.mash.rotation),
            size: this.vectorToDto(this.size),
        };
    }

    getTurretRotationDto(): Vector3Dto {
        return this.vectorToDto(this.turret.rotation);
    }

    getCannonRotationDto(): Vector3Dto {
        return this.vectorToDto(this.cannon.rotation);
    }

    getTurretWorldPosition(): THREE.Vector3 {
        const turretWorldPosition = new THREE.Vector3();
        this.turret.getWorldPosition(turretWorldPosition);
        return turretWorldPosition;
    }

    getTurretWorldYaw(): number {
        return this.mash.rotation.y + this.turret.rotation.y;
    }

    /** Smoothly interpolate turret rotation toward a target Y angle (shortest path). */
    lerpTurretRotationY(targetY: number, alpha: number): void {
        let delta = ((targetY - this.turret.rotation.y) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
        this.turret.rotation.y += delta * alpha;
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
