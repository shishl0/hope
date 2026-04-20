export interface PlayerInput {
    forward: boolean;
    backward: boolean;
    rotateLeft: boolean;
    rotateRight: boolean;
    turretLeft: boolean;
    turretRight: boolean;
    timestamp: number;
}

export interface ProtoTankInput {
    forward: boolean;
    backward: boolean;
    hullRotateLeft: boolean;
    hullRotateRight: boolean;
    turretLeft: boolean;
    turretRight: boolean;
    timestamp: number;
}
