import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { CollisionObjectDto, Vector3Dto } from '../game-network/player-state-dto';

export class ObstacleMesh {
    readonly id: string;
    readonly mash: THREE.Group;
    readonly size: THREE.Vector3;

    private readonly loader = new FBXLoader();
    private loadedModel?: THREE.Object3D;
    private readonly obstacleMaterial = new THREE.MeshStandardMaterial({
        color: 0x747b66,
        roughness: 0.85,
        metalness: 0.05,
    });

    constructor(
        id: string,
        size = new THREE.Vector3(2, 1, 2),
        private readonly modelPath = '/3d_Models/obstacle.fbx',
    ) {
        this.id = id;
        this.size = size.clone();
        this.mash = new THREE.Group();
        this.loadModel();
    }

    addtoScene(scene: THREE.Scene): void {
        scene.add(this.mash);
    }

    removeFromScene(scene: THREE.Scene): void {
        scene.remove(this.mash);
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
        this.mash.traverse(object => {
            if (object instanceof THREE.Mesh) {
                object.geometry.dispose();
                this.disposeMaterial(object.material);
            }
        });
    }

    private loadModel(): void {
        this.loader.load(
            this.modelPath,
            model => {
                this.loadedModel = model;
                this.prepareModel(model);
                this.fitModelToCollisionSize(model);
                this.mash.add(model);
            },
            undefined,
            error => {
                console.error(`Could not load obstacle model: ${this.modelPath}`, error);
            },
        );
    }

    private prepareModel(model: THREE.Object3D): void {
        model.traverse(object => {
            if (object instanceof THREE.Mesh) {
                object.castShadow = true;
                object.receiveShadow = true;
                object.material = this.obstacleMaterial;
            }
        });
    }

    private fitModelToCollisionSize(model: THREE.Object3D): void {
        const box = new THREE.Box3().setFromObject(model);
        const modelSize = new THREE.Vector3();
        const modelCenter = new THREE.Vector3();

        box.getSize(modelSize);
        box.getCenter(modelCenter);

        if (modelSize.x === 0 || modelSize.y === 0 || modelSize.z === 0) {
            return;
        }

        const scale = Math.min(
            this.size.x / modelSize.x,
            this.size.y / modelSize.y,
            this.size.z / modelSize.z,
        );

        model.scale.multiplyScalar(scale);

        const scaledBox = new THREE.Box3().setFromObject(model);
        const scaledCenter = new THREE.Vector3();
        scaledBox.getCenter(scaledCenter);

        model.position.x -= scaledCenter.x;
        model.position.y -= scaledBox.min.y;
        model.position.z -= scaledCenter.z;
    }

    private vectorToDto(vector: THREE.Vector3 | THREE.Euler): Vector3Dto {
        return {
            x: vector.x,
            y: vector.y,
            z: vector.z,
        };
    }

    private disposeMaterial(material: THREE.Material | THREE.Material[]): void {
        if (Array.isArray(material)) {
            material.forEach(item => item.dispose());
            return;
        }

        material.dispose();
    }
}
