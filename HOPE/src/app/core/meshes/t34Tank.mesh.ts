import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export class T34TankMesh {
    readonly id: string;
    readonly mash: THREE.Group;
    readonly bodyGroup: THREE.Group;
    readonly turretGroup: THREE.Group;

    private readonly fbxLoader = new FBXLoader();
    private isLoaded = false;

    // DEV MODE: Exposing offsets so lil-gui can modify them
    // Calibration values provided by USER (from latest screenshot)
    public bodyOffset = new THREE.Vector3(0, 0, 0);
    public bodyRotation = new THREE.Vector3(0, Math.PI, 0);
    public bodyCenter = new THREE.Vector3(-9.35, 0.8, 0);

    public turretOffset = new THREE.Vector3(0, 0, 0.69);
    public turretRotation = new THREE.Vector3(0, Math.PI, 0);
    public turretCenter = new THREE.Vector3(-9.35, 0.66, -0.45);

    public muzzleOffset = new THREE.Vector3(0, 2.15, 3.4); // User calibrated muzzle pos
    public colliderSize = new THREE.Vector2(3.4, 7.0); // Calibrated size

    // Helpers
    private bodyAxesHelper?: THREE.AxesHelper;
    private turretAxesHelper?: THREE.AxesHelper;
    private muzzleHelper: THREE.Mesh;
    private colliderHelper: THREE.Mesh;

    constructor(id: string, color = 0x556b2f) {
        this.id = id;
        this.mash = new THREE.Group();
        this.bodyGroup = new THREE.Group();
        this.turretGroup = new THREE.Group();

        this.mash.add(this.bodyGroup);
        this.mash.add(this.turretGroup);

        // Muzzle Helper (Visual sphere for dev mode)
        const muzzleGeo = new THREE.SphereGeometry(0.12, 16, 16);
        const muzzleMat = new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false, transparent: true, opacity: 0.8 });
        this.muzzleHelper = new THREE.Mesh(muzzleGeo, muzzleMat);
        this.muzzleHelper.renderOrder = 999; // Top of everything
        this.muzzleHelper.visible = false;
        this.turretGroup.add(this.muzzleHelper);

        // Collider Helper
        const colliderGeo = new THREE.BoxGeometry(1, 4, 1);
        const colliderMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.5 });
        this.colliderHelper = new THREE.Mesh(colliderGeo, colliderMat);
        this.colliderHelper.position.set(0, 2, 0); // half height
        this.colliderHelper.visible = false;
        this.mash.add(this.colliderHelper);

        this.loadModels(color);

    }

    private loadModels(color: number): void {
        const material = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.2 });

        this.fbxLoader.load('/3d_Models/t-34-body.fbx', (fbx) => {
            fbx.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.material = material;
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            this.bodyGroup.add(fbx);
            this.checkLoaded();
            this.updateDevOffsets(); // Apply initial calibration
        });

        this.fbxLoader.load('/3d_Models/t-34-tower.fbx', (fbx) => {
            fbx.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.material = material;
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            this.turretGroup.add(fbx);
            this.checkLoaded();
            this.updateDevOffsets(); // Apply initial calibration
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

    /**
     * Applies calibration offsets.
     * Static Rotation and Center shift are applied to children (FBX) 
     * to avoid conflict with Dynamic Server-driven rotation (Group).
     */
    updateDevOffsets(): void {
        // Body
        this.bodyGroup.position.copy(this.bodyOffset);
        this.bodyGroup.children.forEach(child => {
            if (!(child instanceof THREE.AxesHelper)) {
                child.position.copy(this.bodyCenter);
                child.rotation.set(this.bodyRotation.x, this.bodyRotation.y, this.bodyRotation.z);
            }
        });

        // Turret
        this.turretGroup.position.copy(this.turretOffset);
        // Note: turretGroup.rotation.y is driven by server/lerp logic.
        // Calibration rotation is applied to children.
        this.turretGroup.children.forEach(child => {
            // If it's a FBX model child (not a helper)
            if (!(child instanceof THREE.AxesHelper) && child !== this.muzzleHelper) {
                child.position.copy(this.turretCenter);
                child.rotation.set(this.turretRotation.x, this.turretRotation.y, this.turretRotation.z);
            }
        });

        // Muzzle
        this.muzzleHelper.position.copy(this.muzzleOffset);

        // Collider
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
        this.turretGroup.getWorldPosition(turretWorldPosition);
        return turretWorldPosition;
    }

    getTurretWorldYaw(): number {
        return this.mash.rotation.y + this.turretGroup.rotation.y;
    }

    /** Smoothly interpolate turret rotation toward a target Y angle (shortest path). */
    lerpTurretRotationY(targetY: number, alpha: number): void {
        let delta = ((targetY - this.turretGroup.rotation.y) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
        this.turretGroup.rotation.y += delta * alpha;
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
    }
}
