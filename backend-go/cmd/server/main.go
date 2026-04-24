package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"strings"
	"time"

	"hope-backend-go/internal/api"
	"hope-backend-go/internal/database"
	"hope-backend-go/internal/game"
	"hope-backend-go/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func main() {
	database.InitDB("../backend/db.sqlite3")
	db := database.DB

	h := game.NewHub(db)

	r := gin.Default()

	// CORS
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers",
			"Content-Type, Authorization, Accept, Origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// ─── Public routes ────────────────────────────────────────────
	pub := r.Group("/api")
	{
		pub.POST("/auth/login/", api.HandleLogin)
		pub.POST("/auth/refresh/", api.HandleRefreshToken)
		pub.POST("/auth/register/", api.HandleRegister)
		pub.GET("/catalog/", api.HandleCatalog)
		pub.GET("/lobbies/active/", api.HandleActiveLobbies)

		// Legacy stateless physics endpoints (no auth required in Django either)
		pub.POST("/object/move/", api.HandleObjectMove)
		pub.POST("/object/move/state", api.HandleObjectMove)
		pub.POST("/proto-tank/move/", api.HandleProtoTankMove)
		pub.POST("/proto-tank/bullets/", api.HandleProtoTankBullets)
	}

	// ─── Protected routes ─────────────────────────────────────────
	auth := r.Group("/api")
	auth.Use(api.AuthMiddleware())
	{
		// Auth
		auth.POST("/auth/change-password/", api.HandleChangePassword)

		// Profile
		auth.GET("/profile/", api.HandleProfile)
		auth.PUT("/profile/", api.HandleProfile)
		auth.POST("/profile/select-tank/", api.HandleSelectTank)

		// Tanks & Arenas
		auth.GET("/tanks/", api.HandleListTanks)
		auth.GET("/arenas/", api.HandleListArenas)

		// Lobbies
		auth.GET("/lobbies/", api.HandleLobbies)
		auth.POST("/lobbies/", api.HandleLobbies)
		auth.GET("/lobbies/:id/", api.HandleLobbyDetail)
		auth.DELETE("/lobbies/:id/", api.HandleLobbyDetail)
		auth.POST("/lobbies/:id/join/", api.HandleLobbyJoin)
		auth.POST("/lobbies/:id/leave/", api.HandleLobbyLeave)
		auth.POST("/lobbies/:id/side/", api.HandleLobbySetSide)
		auth.POST("/lobbies/:id/mode/", api.HandleLobbySetMode)

		// Friends
		auth.GET("/friends/", api.HandleFriendsSummary)
		auth.GET("/friends/search/", api.HandleFriendsSearch)
		auth.POST("/friends/request/", api.HandleSendFriendRequest)
		auth.POST("/friends/requests/:request_id/accept/", api.HandleAcceptFriendRequest)
		auth.POST("/friends/requests/:request_id/decline/", api.HandleDeclineFriendRequest)
		auth.GET("/friends/:player_id/profile/", api.HandleFriendProfile)
		auth.POST("/friends/:player_id/invite/", api.HandleInviteFriendToLobby)
		auth.POST("/friends/invites/:invite_id/accept/", api.HandleAcceptLobbyInvite)
		auth.POST("/friends/invites/:invite_id/decline/", api.HandleDeclineLobbyInvite)
	}

	// ─── WebSocket ────────────────────────────────────────────────
	r.GET("/ws/proto-tank/:roomID/", func(c *gin.Context) {
		roomID := c.Param("roomID")

		// Authenticate via ?token=... query param
		token := c.Query("token")
		var userID uint
		var nickname string
		var tankType string
		var team string = "red"

		if token != "" {
			uid, err := api.ParseJWTUserID(token)
			if err == nil && uid > 0 {
				userID = uid
				// Load profile + lobby membership
				var profile models.PlayerProfile
				if err2 := db.Preload("SelectedTank").Where("user_id = ?", uid).First(&profile).Error; err2 == nil {
					nickname = profile.Nickname

					// Determine tank type from selected tank name
					tankType = "t34"
					if profile.SelectedTank != nil {
						name := strings.ToLower(profile.SelectedTank.Name)
						if strings.Contains(name, "pz") || strings.Contains(name, "panzer") {
							tankType = "pz4"
						}
					}

					// Get side from LobbyPlayer if in a room with numeric ID
					var lp models.LobbyPlayer
					var lID uint
					// Try to parse roomID as uint
					if _, errP := fmt.Sscanf(roomID, "%d", &lID); errP == nil {
						if err3 := db.Where("lobby_id = ? AND player_id = ?", lID, profile.ID).First(&lp).Error; err3 == nil {
							if lp.Side == "axis" {
								team = "blue"
							} else {
								team = "red"
							}
						}
					}
				}
			}
		}

		// Fallback nickname from query param
		if nickname == "" {
			nickname = c.Query("nick")
			if nickname == "" {
				nickname = fmt.Sprintf("Guest_%d", userID)
			}
		}
		if tankType == "" {
			tankType = "t34"
		}

		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			log.Printf("WS upgrade error: %v", err)
			return
		}

		room := h.GetOrCreateRoom(roomID)
		h.EnsureRoomLoop(room)
		clientID := fmt.Sprintf("player_%d", rand.Intn(1000000))

		client := &game.Client{
			ID:   clientID,
			Conn: conn,
			Send: make(chan []byte, 256),
			Room: room,
		}

		h.Register <- client
		room.AddPlayer(clientID, nickname, tankType, team)

		log.Printf("WS: %s (%s/%s) joined room %s", nickname, tankType, team, roomID)

		// Send init message with player ID
		initMsg := map[string]interface{}{"type": "init", "id": clientID}
		initData, _ := json.Marshal(initMsg)
		conn.WriteMessage(websocket.TextMessage, initData)

		go client.WritePump()
		client.ReadPump(h, db)

		// Update lastSeenAt on clean disconnect
		if userID > 0 {
			go func() {
				db.Exec("UPDATE game_playerprofile SET lastSeenAt = CURRENT_TIMESTAMP WHERE user_id = ?", userID)
			}()
		}
	})

	// Background Garbage Collector
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		for range ticker.C {
			// 1. Cleanup inactive lobbies and lobby players in DB
			api.CleanupInactiveLobbyPlayers()
			log.Println("[GC] Cleaned up inactive lobbies in DB")
		}
	}()

	log.Println("Server starting on :8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
