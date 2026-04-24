package game

import (
	"log"
	"math"
	"math/rand"
	"sync"
	"time"

	"gorm.io/gorm"
)

type PlayerInput struct {
	Forward         bool `json:"forward"`
	Backward        bool `json:"backward"`
	HullRotateLeft  bool `json:"hullRotateLeft"`
	HullRotateRight bool `json:"hullRotateRight"`
	TurretLeft      bool `json:"turretLeft"`
	TurretRight     bool `json:"turretRight"`
	Fire            bool `json:"fire"`
}

type Player struct {
	ID           string
	Nickname     string
	Pos          Vector2
	RotY         float64
	RotV         float64
	VelX, VelZ   float64
	TurrY        float64
	HP           int
	IsDead       bool
	RespawnTimer float64
	TankType     string
	AtWall       bool
	ReloadTimer  float64
	Input        PlayerInput
	Team         string
	Color        int
	Kills        int
	Deaths       int
	LastSeq      int

	mu sync.Mutex
}

type Bullet struct {
	X, Z   float64
	VX, VZ float64
	Owner  string
}

type Room struct {
	ID           string
	Players      map[string]*Player
	Bullets      []Bullet
	Running      bool
	GameTimer    float64
	TeamScores   map[string]int
	MatchState   string
	Winner       string
	GameMode     string // "team" or "deathmatch"
	RestartTimer float64
	LastActive   time.Time
	LoopStarted  bool

	// Delta state tracking
	TickCounter int
	LastBullets [][]float64

	db *gorm.DB
	mu sync.RWMutex
}

func NewRoom(id string, db *gorm.DB) *Room {
	return &Room{
		ID:         id,
		Players:    make(map[string]*Player),
		Bullets:    []Bullet{},
		GameMode:   "team",
		Running:    true,
		GameTimer:  540.0,
		TeamScores: map[string]int{"red": 0, "blue": 0},
		MatchState: "playing",
		LastActive: time.Now(),
		db:         db,
	}
}

func (r *Room) AddPlayer(id, nickname, tankType, team string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Remove stale player with same nickname
	for oldID, p := range r.Players {
		if p.Nickname == nickname && oldID != id {
			delete(r.Players, oldID)
			break
		}
	}

	p := &Player{
		ID:       id,
		Nickname: nickname,
		TankType: tankType,
		Team:     team,
		HP:       100,
		Color:    0xffffff,
	}
	r.Players[id] = p
	r.spawnPlayer(p)
	r.LastActive = time.Now()
}

// spawnPlayer uses team-based zones matching Django's ProtoTankRoom logic
func (r *Room) spawnPlayer(p *Player) {
	p.IsDead = false
	p.HP = 100
	p.VelX = 0
	p.VelZ = 0

	if r.GameMode == "team" {
		var zMin, zMax, rotY float64
		if p.Team == "red" {
			zMin, zMax, rotY = -90, -70, 0
		} else {
			zMin, zMax, rotY = 70, 90, math.Pi
		}

		for attempt := 0; attempt < 50; attempt++ {
			px := rand.Float64()*80 - 40
			pz := zMin + rand.Float64()*(zMax-zMin)
			if !r.posCollides(p.ID, px, pz) {
				p.Pos = Vector2{X: px, Z: pz}
				p.RotY = rotY
				return
			}
		}
		// Fallback
		p.Pos = Vector2{X: 0, Z: zMin}
		p.RotY = rotY
	} else {
		// FFA
		p.Team = "ffa"
		p.Color = rand.Intn(0xffffff)
		for attempt := 0; attempt < 50; attempt++ {
			px := rand.Float64()*180 - 90
			pz := rand.Float64()*180 - 90
			if !r.posCollides(p.ID, px, pz) {
				p.Pos = Vector2{X: px, Z: pz}
				p.RotY = rand.Float64() * 2 * math.Pi
				return
			}
		}
		p.Pos = Vector2{X: 0, Z: 0}
		p.RotY = 0
	}
}

func (r *Room) posCollides(excludeID string, px, pz float64) bool {
	for id, op := range r.Players {
		if id == excludeID || op.IsDead {
			continue
		}
		dx := px - op.Pos.X
		dz := pz - op.Pos.Z
		if dx*dx+dz*dz < 64.0 {
			return true
		}
	}
	return false
}

func (r *Room) RemovePlayer(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.Players, id)
}

func (r *Room) UpdateInput(id string, data map[string]interface{}) {
	r.mu.RLock()
	p, ok := r.Players[id]
	r.mu.RUnlock()
	if !ok {
		return
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	// Helper to extract bool from interface{} (handles bool and float64)
	asBool := func(v interface{}) (bool, bool) {
		if b, ok := v.(bool); ok {
			return b, true
		}
		if f, ok := v.(float64); ok {
			return f != 0, true
		}
		return false, false
	}

	if b, ok := asBool(data["forward"]); ok {
		p.Input.Forward = b
	}
	if b, ok := asBool(data["backward"]); ok {
		p.Input.Backward = b
	}
	if b, ok := asBool(data["hullRotateLeft"]); ok {
		p.Input.HullRotateLeft = b
	}
	if b, ok := asBool(data["hullRotateRight"]); ok {
		p.Input.HullRotateRight = b
	}
	if b, ok := asBool(data["turretLeft"]); ok {
		p.Input.TurretLeft = b
	}
	if b, ok := asBool(data["turretRight"]); ok {
		p.Input.TurretRight = b
	}
	if b, ok := asBool(data["fire"]); ok {
		p.Input.Fire = b
	}

	if seq, ok := data["seq"].(float64); ok {
		if int(seq) > p.LastSeq {
			p.LastSeq = int(seq)
		}
	}
}

func (r *Room) UpdateTankType(id, tankType string) {
	r.mu.RLock()
	p, ok := r.Players[id]
	r.mu.RUnlock()
	if ok && isTankValid(tankType) {
		p.mu.Lock()
		p.TankType = tankType
		p.mu.Unlock()
	}
}

func (r *Room) ChangeMode(mode string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if mode != "team" && mode != "deathmatch" {
		return
	}
	r.GameMode = mode
	log.Printf("[ROOM %s] Mode changed to %s", r.ID, mode)

	for _, p := range r.Players {
		p.HP = 100
		p.IsDead = false
		r.spawnPlayer(p)
	}
}

func isTankValid(t string) bool {
	_, ok := TankConfigs[t]
	return ok
}

func (r *Room) IsEmpty() bool {
	return len(r.Players) == 0
}

func (r *Room) ShouldCleanup() bool {
	if r.IsEmpty() && time.Since(r.LastActive) > 30*time.Second {
		return true
	}
	if !r.IsEmpty() {
		r.LastActive = time.Now()
	}
	return false
}

// SaveMatchStats persists match results to DB (async-safe, called with lock held)
func (r *Room) SaveMatchStats(winnerTeam string) {
	if r.db == nil {
		return
	}
	go func() {
		// Snapshot players to avoid holding the room lock during DB ops
		type snap struct {
			Nickname string
			Kills    int
			Deaths   int
			Team     string
		}
		r.mu.RLock()
		snapshots := make([]snap, 0, len(r.Players))
		for _, p := range r.Players {
			snapshots = append(snapshots, snap{p.Nickname, p.Kills, p.Deaths, p.Team})
		}
		var lobbyID *uint
		if r.ID != "global" {
			// Try to parse room ID as lobby ID
			var id uint
			if _, err := parseUint(r.ID, &id); err == nil {
				lobbyID = &id
			}
		}
		r.mu.RUnlock()

		now := time.Now()
		match := struct {
			ID         uint
			LobbyID    *uint
			WinnerTeam string
			StartedAt  time.Time
			FinishedAt *time.Time
		}{LobbyID: lobbyID, WinnerTeam: winnerTeam, StartedAt: now, FinishedAt: &now}

		if err := r.db.Table("game_match").Create(&match).Error; err != nil {
			log.Printf("[Room %s] Failed to create match record: %v", r.ID, err)
			return
		}

		for _, s := range snapshots {
			// Find profile by nickname
			var profileID uint
			row := r.db.Raw("SELECT id FROM game_playerprofile WHERE nickname = ? LIMIT 1", s.Nickname).Row()
			if err := row.Scan(&profileID); err != nil || profileID == 0 {
				continue
			}

			// Update totals
			isWinner := s.Team == winnerTeam
			isLoser := winnerTeam != "" && winnerTeam != "draw" && (s.Team == "red" || s.Team == "blue") && !isWinner

			r.db.Exec(
				"UPDATE game_playerprofile SET totalKills = totalKills + ?, totalDeaths = totalDeaths + ?, wins = wins + ?, losses = losses + ? WHERE id = ?",
				s.Kills, s.Deaths, boolInt(isWinner), boolInt(isLoser), profileID,
			)

			r.db.Exec(
				"INSERT INTO game_matchplayerstats (match_id, player_id, kills, deaths) VALUES (?, ?, ?, ?)",
				match.ID, profileID, s.Kills, s.Deaths,
			)
		}
	}()
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func parseUint(s string, out *uint) (string, error) {
	for _, c := range s {
		if c < '0' || c > '9' {
			return s, &parseError{}
		}
	}
	var n uint
	for _, c := range s {
		n = n*10 + uint(c-'0')
	}
	*out = n
	return s, nil
}

type parseError struct{}

func (e *parseError) Error() string { return "not a uint" }

func (r *Room) Tick() {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.MatchState == "playing" {
		r.GameTimer -= DT
		if r.GameTimer <= 0 {
			r.GameTimer = 0
			r.MatchState = "finished"
			r.RestartTimer = 10.0
			if r.TeamScores["red"] > r.TeamScores["blue"] {
				r.Winner = "red"
			} else if r.TeamScores["blue"] > r.TeamScores["red"] {
				r.Winner = "blue"
			} else {
				r.Winner = "draw"
			}
			r.SaveMatchStats(r.Winner)
		}
		r.simulatePhysics()
	} else if r.MatchState == "finished" {
		r.RestartTimer -= DT
		if r.RestartTimer <= 0 {
			r.resetMatch()
		}
	}
	r.TickCounter++
}

func (r *Room) resetMatch() {
	r.GameTimer = 540.0
	r.MatchState = "playing"
	r.Winner = ""
	r.TeamScores = map[string]int{"red": 0, "blue": 0}
	r.Bullets = []Bullet{}
	for _, p := range r.Players {
		p.Kills = 0
		p.Deaths = 0
		p.Input = PlayerInput{}
		r.spawnPlayer(p)
	}
}

func (r *Room) simulatePhysics() {
	type pmath struct {
		Cos, Sin float64
		Corners  [4]Vector2
	}
	pm := make(map[string]pmath)
	for id, p := range r.Players {
		if p.IsDead {
			continue
		}
		c, s := math.Cos(p.RotY), math.Sin(p.RotY)
		pm[id] = pmath{c, s, GetTankCorners(TankState{Pos: p.Pos, RotY: p.RotY, TankType: p.TankType}, c, s)}
	}

	// Bullets
	var alive []Bullet
	for _, b := range r.Bullets {
		hit := false
		bx, bz := b.X, b.Z
		for step := 0; step < 6; step++ {
			bx += b.VX / 6.0
			bz += b.VZ / 6.0
			if bx < WORLD_MIN || bx > WORLD_MAX || bz < WORLD_MIN || bz > WORLD_MAX {
				hit = true
				break
			}
			for pid, p := range r.Players {
				if pid == b.Owner || p.IsDead {
					continue
				}
				if r.GameMode == "team" {
					if owner, ok := r.Players[b.Owner]; ok && owner.Team == p.Team {
						continue
					}
				}
				dx, dz := bx-p.Pos.X, bz-p.Pos.Z
				if dx*dx+dz*dz > 25.0 {
					continue
				}
				m, ok := pm[pid]
				if !ok {
					continue
				}
				lx := dx*m.Cos - dz*m.Sin
				lz := dx*m.Sin + dz*m.Cos
				sz, ok2 := TankConfigs[p.TankType]
				if !ok2 {
					sz = DefaultTankSize
				}
				hw, hl := sz[0]/2, sz[2]/2
				if lx >= -hw && lx <= hw && lz >= -hl && lz <= hl {
					p.HP -= 25
					hit = true
					if p.HP <= 0 {
						p.IsDead = true
						p.HP = 0
						p.Deaths++
						p.RespawnTimer = 5.0
						if owner, ok3 := r.Players[b.Owner]; ok3 {
							owner.Kills++
							if r.GameMode == "team" {
								r.TeamScores[owner.Team]++
							}
						}
					}
					break
				}
			}
			if hit {
				break
			}
		}
		if !hit {
			alive = append(alive, Bullet{bx, bz, b.VX, b.VZ, b.Owner})
		}
	}
	r.Bullets = alive

	// Players
	for id, p := range r.Players {
		if p.IsDead {
			p.RespawnTimer -= DT
			if p.RespawnTimer <= 0 {
				r.spawnPlayer(p)
			}
			continue
		}

		p.mu.Lock()
		inp := p.Input
		p.mu.Unlock()

		speed := math.Hypot(p.VelX, p.VelZ)
		speedRatio := math.Min(speed/MAX_V_FWD, 1.0)
		turnRate := TURN_SLOW + (TURN_FAST-TURN_SLOW)*math.Pow(speedRatio, TURN_EXP)
		rotAccel := turnRate * 0.15

		if inp.HullRotateLeft {
			p.RotV += rotAccel
		} else if inp.HullRotateRight {
			p.RotV -= rotAccel
		} else {
			p.RotV *= 0.82
		}
		p.RotV = math.Max(-turnRate, math.Min(turnRate, p.RotV))
		p.RotY = normAngle(p.RotY + p.RotV)

		if inp.TurretLeft {
			p.TurrY += TURRET_SPD
		}
		if inp.TurretRight {
			p.TurrY -= TURRET_SPD
		}
		p.TurrY = normAngle(p.TurrY)

		hx, hz := math.Sin(p.RotY), math.Cos(p.RotY)
		vf := p.VelX*hx + p.VelZ*hz
		vl := p.VelX*hz - p.VelZ*hx

		if inp.Forward && !inp.Backward {
			if vf >= 0 {
				vf = math.Min(vf+ACCEL_BASE_FWD*math.Pow(math.Max(0, 1-(vf/MAX_V_FWD)), ACCEL_EXP), MAX_V_FWD)
			} else {
				vf = math.Min(0, vf+BRAKE_FORCE)
			}
		} else if inp.Backward && !inp.Forward {
			if vf <= 0 {
				vf = math.Max(vf-ACCEL_BASE_BWD*math.Pow(math.Max(0, 1-(math.Abs(vf)/MAX_V_BWD)), ACCEL_EXP), -MAX_V_BWD)
			} else {
				vf = math.Max(0, vf-BRAKE_FORCE)
			}
		} else {
			if vf > 0 {
				vf = math.Max(0, vf-FRICTION)
			} else if vf < 0 {
				vf = math.Min(0, vf+FRICTION)
			}
		}
		if speedRatio <= 0.45 {
			vl *= 0.82
		} else {
			vl *= 0.96
		}
		p.VelX, p.VelZ = vf*hx+vl*hz, vf*hz-vl*hx

		if speed > 1e-7 {
			oldX, oldZ := p.Pos.X, p.Pos.Z
			p.Pos.X += p.VelX
			p.Pos.Z += p.VelZ

			sz, ok := TankConfigs[p.TankType]
			if !ok {
				sz = DefaultTankSize
			}
			hw, hl := sz[0]/2, sz[2]/2
			cx := math.Max(WORLD_MIN+hw, math.Min(WORLD_MAX-hw, p.Pos.X))
			cz := math.Max(WORLD_MIN+hl, math.Min(WORLD_MAX-hl, p.Pos.Z))
			p.AtWall = cx != p.Pos.X || cz != p.Pos.Z
			if p.AtWall {
				p.Pos.X, p.Pos.Z = cx, cz
			}

			pc, ps := math.Cos(p.RotY), math.Sin(p.RotY)
			pCorners := GetTankCorners(TankState{Pos: p.Pos, RotY: p.RotY, TankType: p.TankType}, pc, ps)
			collided := false
			for oid, op := range r.Players {
				if oid == id || op.IsDead {
					continue
				}
				dx, dz := p.Pos.X-op.Pos.X, p.Pos.Z-op.Pos.Z
				if dx*dx+dz*dz < 81.0 {
					if om, ok := pm[oid]; ok {
						if CheckTankCollisionSAT(
							TankState{Pos: p.Pos, RotY: p.RotY, TankType: p.TankType},
							TankState{Pos: op.Pos, RotY: op.RotY, TankType: op.TankType},
							pCorners, om.Corners, pc, ps, om.Cos, om.Sin,
						) {
							collided = true
							break
						}
					}
				}
			}
			if collided {
				p.Pos.X, p.Pos.Z = oldX, oldZ
				p.VelX, p.VelZ = 0, 0
			}
		}

		if p.ReloadTimer > 0 {
			p.ReloadTimer = math.Max(0, p.ReloadTimer-DT)
		}
		if inp.Fire && p.ReloadTimer == 0 {
			p.ReloadTimer = 7.0
			wt := p.RotY + p.TurrY
			bx := p.Pos.X + math.Sin(wt)*1.5
			bz := p.Pos.Z + math.Cos(wt)*1.5
			r.Bullets = append(r.Bullets, Bullet{bx, bz, math.Sin(wt) * BULLET_SPEED, math.Cos(wt) * BULLET_SPEED, id})
		}
	}
}
