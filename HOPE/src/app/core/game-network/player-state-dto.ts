export interface Vector3Dto {
    x: number;
    y: number;
    z: number;
}

export interface CollisionObjectDto {
    id: string;
    position: Vector3Dto;
    rotation: Vector3Dto;
    size: Vector3Dto;
}

export interface MoveRequestDto {
    forward: boolean;
    backward: boolean;
    rotateLeft: boolean;
    rotateRight: boolean;
    player: CollisionObjectDto;
    obstacles: CollisionObjectDto[];
}

export interface MoveResponseDto {
    position: Vector3Dto;
    rotation: Vector3Dto;
    collided: boolean;
}

export interface ProtoTankMoveRequestDto {
    forward: boolean;
    backward: boolean;
    hullRotateLeft: boolean;
    hullRotateRight: boolean;
    turretLeft: boolean;
    turretRight: boolean;
    tank: CollisionObjectDto;
    turretRotation: Vector3Dto;
    cannonRotation: Vector3Dto;
    obstacles: CollisionObjectDto[];
}

export interface ProtoTankMoveResponseDto {
    type?: string;
    position: Vector3Dto;
    rotation: Vector3Dto;
    turretRotation: Vector3Dto;
    cannonRotation: Vector3Dto;
    velocity: number;
    speed_kmh: number;
    at_wall: boolean;
    collided: boolean;
}
