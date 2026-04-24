package game

import (
	"math"
)

const (
	TPS = 40
	DT  = 1.0 / float64(TPS)
)

const (
	MAX_V_FWD      = (85.0 / 3.6) * DT
	MAX_V_BWD      = (30.0 / 3.6) * DT
	ACCEL_BASE_FWD = 0.0021
	ACCEL_BASE_BWD = 0.0018
	ACCEL_EXP      = 0.55
	FRICTION       = 0.0027
	BRAKE_FORCE    = 0.00975
	TURRET_SPD     = 0.0175
	TURN_SLOW      = 0.0325
	TURN_FAST      = 0.070
	TURN_EXP       = 0.6
	BULLET_SPEED   = 6.0
	WORLD_MIN      = -110.0
	WORLD_MAX      = 90.0
)

var TankConfigs = map[string][]float64{
	"t34": {3.4, 0.7, 7.0},
	"pz4": {3.0, 0.7, 7.0},
}
var DefaultTankSize = []float64{2.5, 0.7, 5.0}

func normAngle(a float64) float64 {
	a = math.Mod(a, 2*math.Pi)
	if a > math.Pi {
		a -= 2 * math.Pi
	}
	if a < -math.Pi {
		a += 2 * math.Pi
	}
	return a
}

type Vector2 struct {
	X, Z float64
}

type TankState struct {
	Pos       Vector2
	RotY      float64
	RotV      float64
	VelX, VelZ float64
	TurrY     float64
	TankType  string
}

func GetTankCorners(p TankState, cosY, sinY float64) [4]Vector2 {
	size, ok := TankConfigs[p.TankType]
	if !ok {
		size = DefaultTankSize
	}
	hw, hl := size[0]/2, size[2]/2

	corners := [4]Vector2{}
	offsets := [4][2]float64{{-hw, -hl}, {hw, -hl}, {hw, hl}, {-hw, hl}}
	for i, off := range offsets {
		lx, lz := off[0], off[1]
		dx := lx*cosY + lz*sinY
		dz := -lx*sinY + lz*cosY
		corners[i] = Vector2{X: p.Pos.X + dx, Z: p.Pos.Z + dz}
	}
	return corners
}

func CheckTankCollisionSAT(p1, p2 TankState, corners1, corners2 [4]Vector2, cos1, sin1, cos2, sin2 float64) bool {
	axes := [4]Vector2{
		{X: cos1, Z: -sin1},
		{X: sin1, Z: cos1},
		{X: cos2, Z: -sin2},
		{X: sin2, Z: cos2},
	}

	for _, axis := range axes {
		min1, max1 := math.Inf(1), math.Inf(-1)
		for _, c := range corners1 {
			proj := c.X*axis.X + c.Z*axis.Z
			if proj < min1 {
				min1 = proj
			}
			if proj > max1 {
				max1 = proj
			}
		}

		min2, max2 := math.Inf(1), math.Inf(-1)
		for _, c := range corners2 {
			proj := c.X*axis.X + c.Z*axis.Z
			if proj < min2 {
				min2 = proj
			}
			if proj > max2 {
				max2 = proj
			}
		}

		if max1 < min2 || max2 < min1 {
			return false
		}
	}
	return true
}
