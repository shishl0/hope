package game

import (
	"encoding/json"
	"log"
	"math"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"gorm.io/gorm"
)

type Client struct {
	ID   string
	Conn *websocket.Conn
	Send chan []byte
	Room *Room
}

type Hub struct {
	Rooms      map[string]*Room
	Clients    map[string]*Client
	Register   chan *Client
	Unregister chan *Client
	db         *gorm.DB
	mu         sync.RWMutex
}

func NewHub(db *gorm.DB) *Hub {
	h := &Hub{
		Rooms:      make(map[string]*Room),
		Clients:    make(map[string]*Client),
		Register:   make(chan *Client, 1024),
		Unregister: make(chan *Client, 1024),
		db:         db,
	}
	go h.run()
	return h
}

func (h *Hub) GetOrCreateRoom(id string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()
	if r, ok := h.Rooms[id]; ok {
		return r
	}
	log.Printf("[ROOM] Creating new room %s", id)
	r := NewRoom(id, h.db)
	h.Rooms[id] = r
	return r
}

func (h *Hub) EnsureRoomLoop(r *Room) {
	r.mu.Lock()
	if r.Running && r.LoopStarted {
		r.mu.Unlock()
		return
	}
	r.Running = true
	r.LoopStarted = true
	r.mu.Unlock()
	go h.runRoom(r)
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.Register:
			h.mu.Lock()
			h.Clients[client.ID] = client
			h.mu.Unlock()
		case client := <-h.Unregister:
			h.mu.Lock()
			if _, ok := h.Clients[client.ID]; ok {
				delete(h.Clients, client.ID)
				close(client.Send)
			}
			h.mu.Unlock()
		}
	}
}

func (h *Hub) runRoom(r *Room) {
	ticker := time.NewTicker(time.Second / time.Duration(TPS))
	defer ticker.Stop()

	log.Printf("[ROOM %s] Starting game loop", r.ID)
	defer func() {
		log.Printf("[ROOM %s] Stopping game loop", r.ID)
		r.mu.Lock()
		r.LoopStarted = false
		r.mu.Unlock()
	}()

	for range ticker.C {
		// Recovery to prevent one crash from killing the room
		func() {
			defer func() {
				if err := recover(); err != nil {
					log.Printf("[ROOM %s] CRITICAL PANIC: %v", r.ID, err)
				}
			}()

			if !r.Running {
				h.mu.Lock()
				delete(h.Rooms, r.ID)
				h.mu.Unlock()
				return
			}
			if r.ShouldCleanup() {
				r.Running = false
				h.mu.Lock()
				delete(h.Rooms, r.ID)
				h.mu.Unlock()
				return
			}
			r.Tick()
			h.broadcastRoomState(r)

			if r.TickCounter%100 == 0 {
				log.Printf("[ROOM %s] Tick %d, Players: %d", r.ID, r.TickCounter, len(r.Players))
			}
		}()
		// If we set Running to false inside the func, the range ticker.C will exit on next iteration
		if !r.Running {
			return
		}
	}
}

// broadcastRoomState sends a delta or full state update to all clients in the room.
func (h *Hub) broadcastRoomState(r *Room) {
	r.mu.RLock()

	isFull := r.TickCounter%40 == 0

	// Serialize players
	players := make([]interface{}, 0, len(r.Players))
	for id, p := range r.Players {
		speed := math.Hypot(p.VelX, p.VelZ)
		speedKMH := (speed / DT) * 3.6
		dead := 0
		if p.IsDead {
			dead = 1
		}
		atWall := 0
		if p.AtWall {
			atWall = 1
		}
		players = append(players, map[string]interface{}{
			"id":   id,
			"nick": p.Nickname,
			"x":    math.Round(p.Pos.X*1000) / 1000,
			"z":    math.Round(p.Pos.Z*1000) / 1000,
			"ry":   math.Round(p.RotY*10000) / 10000,
			"ty":   math.Round(p.TurrY*10000) / 10000,
			"skin": p.TankType,
			"hp":   p.HP,
			"dead": dead,
			"sp":   math.Round(speedKMH*10) / 10,
			"w":    atWall,
			"rld":  math.Round(p.ReloadTimer*10) / 10,
			"c":    p.Color,
			"k":    p.Kills,
			"d":    p.Deaths,
			"tm":   p.Team,
			"seq":  p.LastSeq,
		})
	}

	// Serialize bullets
	bullets := make([][]float64, 0, len(r.Bullets))
	for _, b := range r.Bullets {
		bullets = append(bullets, []float64{
			math.Round(b.X*100) / 100,
			math.Round(b.Z*100) / 100,
			math.Round(b.VX*100) / 100,
			math.Round(b.VZ*100) / 100,
		})
	}

	st := map[string]interface{}{
		"timer":         int(r.GameTimer),
		"score":         r.TeamScores,
		"match_state":   r.MatchState,
		"winner":        r.Winner,
		"restart_timer": int(r.RestartTimer),
	}

	r.mu.RUnlock()

	payload := map[string]interface{}{
		"full": isFull,
		"p":    players,
		"b":    bullets,
		"st":   st,
		"t":    time.Now().UnixMilli(),
	}
	data, _ := json.Marshal(payload)

	// Snapshot clients to broadcast to, avoiding holding h.mu for the whole send process
	var targets []*Client
	h.mu.RLock()
	for _, client := range h.Clients {
		if client.Room == r {
			targets = append(targets, client)
		}
	}
	h.mu.RUnlock()

	for _, client := range targets {
		select {
		case client.Send <- data:
		default:
			// If buffer full, skip this tick for this client
		}
	}
}

// ReadPump reads WS messages from the client.
func (c *Client) ReadPump(h *Hub, db *gorm.DB) {
	defer func() {
		h.Unregister <- c
		c.Conn.Close()
		if c.Room != nil {
			c.Room.RemovePlayer(c.ID)
		}
	}()

	c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			break
		}

		var data map[string]interface{}
		if err := json.Unmarshal(message, &data); err != nil {
			continue
		}

		msgType, _ := data["type"].(string)
		if msgType == "" {
			continue
		}

		switch msgType {
		case "input":
			if c.Room != nil {
				// log.Printf("[DEBUG] Input from %s: %v", c.ID, data)
				c.Room.UpdateInput(c.ID, data)
			}

		case "change_tank":
			if c.Room != nil {
				tankType, _ := data["tank_type"].(string)
				if tankType == "" {
					tankType, _ = data["tank"].(string)
				}
				if tankType != "" {
					c.Room.UpdateTankType(c.ID, tankType)
				}
			}

		case "change_mode":
			if c.Room != nil {
				mode, _ := data["mode"].(string)
				if mode != "" {
					c.Room.ChangeMode(mode)
				}
			}

		case "ping":
			resp, _ := json.Marshal(map[string]interface{}{
				"type":        "pong",
				"client_time": data["client_time"],
			})
			c.Send <- resp
			// Update lastSeenAt in DB if we have a userID
			if userIDVal := data["_userID"]; userIDVal != nil {
				if uid, ok := userIDVal.(float64); ok && uid > 0 {
					go updateLastSeen(db, uint(uid))
				}
			}
		}
	}
}

func updateLastSeen(db *gorm.DB, userID uint) {
	if db == nil {
		return
	}
	now := time.Now()
	db.Exec("UPDATE game_playerprofile SET lastSeenAt = ? WHERE user_id = ?", now, userID)
}

func safeBool(v interface{}) bool {
	b, _ := v.(bool)
	return b
}

// WritePump writes outgoing messages to the WS connection.
func (c *Client) WritePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
