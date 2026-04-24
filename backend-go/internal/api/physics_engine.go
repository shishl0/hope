package api

import (
	"math"
	"time"
)

// ─────────────────────────────────────────────────────────────────
// Stateless physics calculation handlers (port of Django's engine.py)
// ─────────────────────────────────────────────────────────────────

const (
	cubeWorldHalfSize      = 50.0
	cubeMoveSpeed          = 0.1
	cubeRotateSpeed        = 0.1
	protoTankWorldHalfSize = 50.0
	protoTankMoveSpeed     = 0.06
	protoTankRotateSpeed   = 0.05
	protoTankTurretSpeed   = 0.02
	protoBulletWorldHalf   = 50.0
	protoBulletSpeed       = 0.9
)

var protoBulletSize = [3]float64{0.18, 0.18, 0.18}

// ── Vector helpers ────────────────────────────────────────────────

func vecFromMap(m map[string]interface{}, fallback [3]float64) [3]float64 {
	if m == nil {
		return fallback
	}
	get := func(key string, fb float64) float64 {
		if v, ok := m[key].(float64); ok {
			return v
		}
		return fb
	}
	return [3]float64{get("x", fallback[0]), get("y", fallback[1]), get("z", fallback[2])}
}

func vecToMap(v [3]float64) map[string]interface{} {
	return map[string]interface{}{"x": v[0], "y": v[1], "z": v[2]}
}

func normalizeEngineAngle(a float64) float64 {
	for a > math.Pi {
		a -= 2 * math.Pi
	}
	for a < -math.Pi {
		a += 2 * math.Pi
	}
	return a
}

func normalizeVector3(v [3]float64) [3]float64 {
	l := math.Sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2])
	if l == 0 {
		return [3]float64{0, 0, 1}
	}
	return [3]float64{v[0] / l, v[1] / l, v[2] / l}
}

// ── AABB collision ────────────────────────────────────────────────

type aabb struct{ minX, maxX, minY, maxY, minZ, maxZ float64 }

func getAABB(pos, size [3]float64) aabb {
	hx, hy, hz := size[0]/2, size[1]/2, size[2]/2
	return aabb{
		pos[0] - hx, pos[0] + hx,
		pos[1] - hy, pos[1] + hy,
		pos[2] - hz, pos[2] + hz,
	}
}

func aabbIntersects(a, b aabb) bool {
	return a.minX <= b.maxX && a.maxX >= b.minX &&
		a.minY <= b.maxY && a.maxY >= b.minY &&
		a.minZ <= b.maxZ && a.maxZ >= b.minZ
}

type gameObject struct {
	id       string
	position [3]float64
	rotation [3]float64
	size     [3]float64
}

func objectFromMap(m map[string]interface{}, fallbackID string) gameObject {
	if m == nil {
		return gameObject{id: fallbackID, position: [3]float64{0, 0.5, 0}, size: [3]float64{1, 1, 1}}
	}
	id, _ := m["id"].(string)
	if id == "" {
		id = fallbackID
	}
	return gameObject{
		id:       id,
		position: vecFromMap(asMap(m["position"]), [3]float64{0, 0.5, 0}),
		rotation: vecFromMap(asMap(m["rotation"]), [3]float64{0, 0, 0}),
		size:     vecFromMap(asMap(m["size"]), [3]float64{1, 1, 1}),
	}
}

func asMap(v interface{}) map[string]interface{} {
	if m, ok := v.(map[string]interface{}); ok {
		return m
	}
	return nil
}

func objectCollides(candidate gameObject, obstacles []gameObject) bool {
	cb := getAABB(candidate.position, candidate.size)
	for _, obs := range obstacles {
		ob := getAABB(obs.position, obs.size)
		if aabbIntersects(cb, ob) {
			return true
		}
	}
	return false
}

func clampToWorld(pos [3]float64, halfSize float64, size [3]float64) [3]float64 {
	hx, hz := size[0]/2, size[2]/2
	pos[0] = math.Max(-halfSize+hx, math.Min(halfSize-hx, pos[0]))
	pos[2] = math.Max(-halfSize+hz, math.Min(halfSize-hz, pos[2]))
	return pos
}

func parseObstacles(raw interface{}) []gameObject {
	arr, _ := raw.([]interface{})
	obstacles := make([]gameObject, 0, len(arr))
	for i, item := range arr {
		m, _ := item.(map[string]interface{})
		obstacles = append(obstacles, objectFromMap(m, "obstacle-"+string(rune('0'+i))))
	}
	return obstacles
}

// ── CalculateCubeMove ─────────────────────────────────────────────

func CalculateCubeMove(data map[string]interface{}) map[string]interface{} {
	player := objectFromMap(asMap(data["player"]), "player")
	obstacles := parseObstacles(data["obstacles"])

	next := player

	if boolVal(data["rotateLeft"]) {
		next.rotation[1] += cubeRotateSpeed
	}
	if boolVal(data["rotateRight"]) {
		next.rotation[1] -= cubeRotateSpeed
	}
	next.rotation[1] = normalizeEngineAngle(next.rotation[1])

	fwd := boolVal(data["forward"])
	bwd := boolVal(data["backward"])
	move := 0
	if fwd {
		move++
	}
	if bwd {
		move--
	}
	if move != 0 {
		dx := math.Sin(next.rotation[1])
		dz := math.Cos(next.rotation[1])
		dist := float64(move) * cubeMoveSpeed
		next.position[0] += dx * dist
		next.position[2] += dz * dist
		next.position = clampToWorld(next.position, cubeWorldHalfSize, next.size)
	}

	collided := objectCollides(next, obstacles)
	if collided {
		next.position = player.position
	}
	return map[string]interface{}{
		"position": vecToMap(next.position),
		"rotation": vecToMap(next.rotation),
		"collided": collided,
	}
}

// ── CalculateProtoTankMove ────────────────────────────────────────

func CalculateProtoTankMove(data map[string]interface{}) map[string]interface{} {
	tank := objectFromMap(asMap(data["tank"]), "proto-tank")
	turretRot := vecFromMap(asMap(data["turretRotation"]), [3]float64{0, 0, 0})
	cannonRot := vecFromMap(asMap(data["cannonRotation"]), [3]float64{math.Pi / 2, 0, 0})
	obstacles := parseObstacles(data["obstacles"])

	next := tank

	if boolVal(data["hullRotateLeft"]) {
		next.rotation[1] += protoTankRotateSpeed
	}
	if boolVal(data["hullRotateRight"]) {
		next.rotation[1] -= protoTankRotateSpeed
	}
	next.rotation[1] = normalizeEngineAngle(next.rotation[1])

	fwd := boolVal(data["forward"])
	bwd := boolVal(data["backward"])
	move := 0
	if fwd {
		move++
	}
	if bwd {
		move--
	}
	if move != 0 {
		dx := math.Sin(next.rotation[1])
		dz := math.Cos(next.rotation[1])
		dist := float64(move) * protoTankMoveSpeed
		next.position[0] += dx * dist
		next.position[2] += dz * dist
		next.position = clampToWorld(next.position, protoTankWorldHalfSize, next.size)
	}

	if boolVal(data["turretLeft"]) {
		turretRot[1] += protoTankTurretSpeed
	}
	if boolVal(data["turretRight"]) {
		turretRot[1] -= protoTankTurretSpeed
	}
	turretRot[1] = normalizeEngineAngle(turretRot[1])

	collided := objectCollides(next, obstacles)
	if collided {
		next.position = tank.position
	}
	return map[string]interface{}{
		"position":       vecToMap(next.position),
		"rotation":       vecToMap(next.rotation),
		"turretRotation": vecToMap(turretRot),
		"cannonRotation": vecToMap(cannonRot),
		"collided":       collided,
	}
}

// ── CalculateProtoTankBullets ─────────────────────────────────────

type bullet struct {
	id        string
	position  [3]float64
	direction [3]float64
	size      [3]float64
	alive     bool
}

func CalculateProtoTankBullets(data map[string]interface{}) map[string]interface{} {
	obstacles := parseObstacles(data["obstacles"])

	rawBullets, _ := data["bullets"].([]interface{})
	bullets := make([]bullet, 0, len(rawBullets))
	for i, rb := range rawBullets {
		m, _ := rb.(map[string]interface{})
		if m == nil {
			continue
		}
		alive, _ := m["alive"].(bool)
		if !alive {
			continue
		}
		id, _ := m["id"].(string)
		if id == "" {
			id = "bullet-" + string(rune('0'+i))
		}
		dir := normalizeVector3(vecFromMap(asMap(m["direction"]), [3]float64{0, 0, 1}))
		bullets = append(bullets, bullet{
			id:        id,
			position:  vecFromMap(asMap(m["position"]), [3]float64{0, 1, 0}),
			direction: dir,
			size:      vecFromMap(asMap(m["size"]), protoBulletSize),
			alive:     true,
		})
	}

	// Spawn new bullet if firing
	if boolVal(data["fire"]) {
		muzzlePos := vecFromMap(asMap(data["muzzlePosition"]), [3]float64{0, 1, 0})
		muzzleDir := normalizeVector3(vecFromMap(asMap(data["muzzleDirection"]), [3]float64{0, 0, 1}))
		newID, _ := data["newBulletId"].(string)
		if newID == "" {
			newID = "bullet-" + string(rune(time.Now().UnixNano()))
		}
		bullets = append(bullets, bullet{
			id:        newID,
			position:  muzzlePos,
			direction: muzzleDir,
			size:      protoBulletSize,
			alive:     true,
		})
	}

	activeBullets := make([]map[string]interface{}, 0)
	hits := make([]map[string]interface{}, 0)

	for _, b := range bullets {
		next := b
		next.position[0] += next.direction[0] * protoBulletSpeed
		next.position[1] += next.direction[1] * protoBulletSpeed
		next.position[2] += next.direction[2] * protoBulletSpeed

		outOfWorld := math.Abs(next.position[0]) > protoBulletWorldHalf ||
			math.Abs(next.position[2]) > protoBulletWorldHalf ||
			next.position[1] < 0 || next.position[1] > protoBulletWorldHalf

		hitObs := objectCollides(gameObject{position: next.position, size: next.size}, obstacles)

		if outOfWorld || hitObs {
			hitType := "obstacle"
			if outOfWorld {
				hitType = "world"
			}
			hits = append(hits, map[string]interface{}{"bulletId": next.id, "type": hitType})
			continue
		}
		activeBullets = append(activeBullets, map[string]interface{}{
			"id":        next.id,
			"position":  vecToMap(next.position),
			"direction": vecToMap(next.direction),
			"size":      vecToMap(next.size),
			"alive":     true,
		})
	}

	return map[string]interface{}{
		"bullets": activeBullets,
		"hits":    hits,
	}
}

func boolVal(v interface{}) bool {
	b, _ := v.(bool)
	return b
}
