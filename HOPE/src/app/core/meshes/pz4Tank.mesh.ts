import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export class Pz4TankMesh {
    readonly id: string;
    readonly mash: THREE.Group;
    readonly bodyGroup: THREE.Group;
    readonly turretGroup: THREE.Group;

    private readonly fbxLoader: FBXLoader;
    private isLoaded = false;
    private originalColor: number = 0x6a6b63;

    // DEV MODE: Exposing offsets so lil-gui can modify them
    public bodyOffset = new THREE.Vector3(0, 0, 0);
    public bodyRotation = new THREE.Vector3(0, Math.PI, 0);
    public bodyCenter = new THREE.Vector3(8.75, 0.4, 0);

    public turretOffset = new THREE.Vector3(0, 0, 0.57);
    public turretRotation = new THREE.Vector3(0, Math.PI, 0);
    public turretCenter = new THREE.Vector3(8.75, 0.39, -0.299);

    public muzzleOffset = new THREE.Vector3(0, 2.06, 3.13);
    public colliderSize = new THREE.Vector2(3.0, 7.0); // Calibrated size

    // Helpers
    private bodyAxesHelper?: THREE.AxesHelper;
    private turretAxesHelper?: THREE.AxesHelper;
    private muzzleHelper: THREE.Mesh;
    public colliderHelper: THREE.Mesh;
    private nickLabel?: THREE.Sprite;

    constructor(id: string, color?: number, nickname?: string, manager?: THREE.LoadingManager) {
        this.id = id;
        this.fbxLoader = new FBXLoader(manager);
        this.originalColor = color ?? 0x6a6b63;
        this.mash = new THREE.Group();
        this.bodyGroup = new THREE.Group();
        this.turretGroup = new THREE.Group();

        this.mash.add(this.bodyGroup);
        this.mash.add(this.turretGroup);

        if (nickname) {
            this.nickLabel = this.createNickLabel(nickname);
            this.mash.add(this.nickLabel);
        }

        // Muzzle Helper
        const muzzleGeo = new THREE.SphereGeometry(0.12, 16, 16);
        const muzzleMat = new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false, transparent: true, opacity: 0.8 });
        this.muzzleHelper = new THREE.Mesh(muzzleGeo, muzzleMat);
        this.muzzleHelper.renderOrder = 999;
        this.muzzleHelper.visible = false;
        this.turretGroup.add(this.muzzleHelper);

        // Collider Helper
        const colliderGeo = new THREE.BoxGeometry(1, 4, 1);
        const colliderMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.5 });
        this.colliderHelper = new THREE.Mesh(colliderGeo, colliderMat);
        this.colliderHelper.position.set(0, 2, 0); // half height
        this.colliderHelper.visible = false;
        this.mash.add(this.colliderHelper);

        this.loadModels(this.originalColor);
    }

    private loadModels(color: number): void {
        const material = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.2 });

        this.fbxLoader.load('/3d_Models/panzer-4-body.fbx', (fbx) => {
            fbx.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.material = material;
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            this.bodyGroup.add(fbx);
            this.checkLoaded();
            this.updateDevOffsets();
        });

        this.fbxLoader.load('/3d_Models/panzer-4-tower.fbx', (fbx) => {
            fbx.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.material = material;
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            this.turretGroup.add(fbx);
            this.checkLoaded();
            this.updateDevOffsets();
        });
    }

    private checkLoaded(): void {
        if (this.bodyGroup.children.length > 0 && this.turretGroup.children.length > 0) {
            this.isLoaded = true;
        }
    }

    addtoScene(scene: THREE.Scene): void {
        scene.add(this.mash);
    }

    removeFromScene(scene: THREE.Scene): void {
        scene.remove(this.mash);
    }

    updateDevOffsets(): void {
        this.bodyGroup.position.copy(this.bodyOffset);
        this.bodyGroup.children.forEach(child => {
            if (!(child instanceof THREE.AxesHelper)) {
                child.position.copy(this.bodyCenter);
                child.rotation.set(this.bodyRotation.x, this.bodyRotation.y, this.bodyRotation.z);
            }
        });

        this.turretGroup.position.copy(this.turretOffset);
        this.turretGroup.children.forEach(child => {
            if (!(child instanceof THREE.AxesHelper) && child !== this.muzzleHelper) {
                child.position.copy(this.turretCenter);
                child.rotation.set(this.turretRotation.x, this.turretRotation.y, this.turretRotation.z);
            }
        });

        this.muzzleHelper.position.copy(this.muzzleOffset);
        this.colliderHelper.scale.set(this.colliderSize.x, 1, this.colliderSize.y);
    }

    enableDevHelpers(): void {
        if (!this.bodyAxesHelper) {
            this.bodyAxesHelper = new THREE.AxesHelper(3);
            this.bodyGroup.add(this.bodyAxesHelper);
        }
        if (!this.turretAxesHelper) {
            this.turretAxesHelper = new THREE.AxesHelper(3);
            this.turretGroup.add(this.turretAxesHelper);
        }
        this.muzzleHelper.visible = true;
        this.colliderHelper.visible = true;
    }

    disableDevHelpers(): void {
        if (this.bodyAxesHelper) {
            this.bodyGroup.remove(this.bodyAxesHelper);
            this.bodyAxesHelper.dispose();
            this.bodyAxesHelper = undefined;
        }
        if (this.turretAxesHelper) {
            this.turretGroup.remove(this.turretAxesHelper);
            this.turretAxesHelper.dispose();
            this.turretAxesHelper = undefined;
        }
        this.muzzleHelper.visible = false;
        this.colliderHelper.visible = false;
    }

    getMuzzleWorldPosition(): THREE.Vector3 {
        const muzzleWorldPosition = new THREE.Vector3();
        this.muzzleHelper.getWorldPosition(muzzleWorldPosition);
        return muzzleWorldPosition;
    }

    getTurretWorldPosition(): THREE.Vector3 {
        const turretWorldPosition = new THREE.Vector3();
        // Follow the actual FBX model center instead of the group origin
        if (this.turretGroup.children.length > 0) {
            this.turretGroup.children[0].getWorldPosition(turretWorldPosition);
        } else {
            this.turretGroup.getWorldPosition(turretWorldPosition);
        }
        return turretWorldPosition;
    }

    getTurretWorldYaw(): number {
        return this.mash.rotation.y + this.turretGroup.rotation.y;
    }

    lerpTurretRotationY(targetY: number, alpha: number): void {
        let delta = ((targetY - this.turretGroup.rotation.y) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
        this.turretGroup.rotation.y += delta * alpha;
    }

    setDead(dead: boolean): void {
        const color = dead ? 0x1a1a1a : this.originalColor;
        this.applyColor(color);
    }

    setTeamColor(team: string): void {
        if (team === 'red') {
            this.originalColor = 0xffa0a0; // Reddish
        } else if (team === 'blue') {
            this.originalColor = 0xa0a0ff; // Blueish
        } else {
            this.originalColor = 0xffffff; // Default
        }
        this.applyColor(this.originalColor);
    }

    private applyColor(color: number): void {
        this.mash.traverse((child) => {
            if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
                child.material.color.setHex(color);
            }
        });
    }

    private createNickLabel(text: string): THREE.Sprite {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        canvas.width = 512;
        canvas.height = 128;
        context.fillStyle = 'rgba(0, 0, 0, 0.5)';
        context.roundRect(128, 0, 256, 64, 10);
        context.fill();
        context.font = 'bold 36px Arial';
        context.fillStyle = 'white';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, 256, 32);
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.set(0, 4, 0); 
        sprite.scale.set(4, 1, 1);
        return sprite;
    }

    dispose(): void {
        this.mash.traverse((object) => {
            if (object instanceof THREE.Mesh) {
                object.geometry.dispose();
                if (Array.isArray(object.material)) {
                    object.material.forEach((mat) => mat.dispose());
                } else if (object.material) {
                    object.material.dispose();
                }
            }
        });
        if (this.bodyAxesHelper) this.bodyAxesHelper.dispose();
        if (this.turretAxesHelper) this.turretAxesHelper.dispose();
        this.muzzleHelper.geometry.dispose();
        (this.muzzleHelper.material as THREE.MeshBasicMaterial).dispose();
        this.colliderHelper.geometry.dispose();
        (this.colliderHelper.material as THREE.MeshBasicMaterial).dispose();
        if (this.nickLabel) {
            this.nickLabel.geometry.dispose();
            (this.nickLabel.material as THREE.SpriteMaterial).dispose();
        }
    }

    getColliderMesh(): THREE.Mesh {
        return this.colliderHelper;
    }
}
