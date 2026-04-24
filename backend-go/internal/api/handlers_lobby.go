package api

import (
	"net/http"
	"strconv"
	"time"

	"hope-backend-go/internal/database"
	"hope-backend-go/internal/models"

	"github.com/gin-gonic/gin"
)

// GET /api/lobbies/active/
func HandleActiveLobbies(c *gin.Context) {
	var lobbies []models.Lobby
	database.DB.Where("is_active = ?", true).Find(&lobbies)
	list := make([]interface{}, len(lobbies))
	for i, l := range lobbies {
		var count int64
		database.DB.Model(&models.LobbyPlayer{}).Where("lobby_id = ?", l.ID).Count(&count)
		list[i] = gin.H{
			"lobby_id":     l.ID,
			"name":         l.Name,
			"is_active":    l.IsActive,
			"player_count": count,
		}
	}
	c.JSON(http.StatusOK, list)
}

// GET /api/lobbies/ or POST /api/lobbies/
func HandleLobbies(c *gin.Context) {
	userID := c.GetUint("userID")
	profile, err := getOrCreateProfile(userID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"detail": "Not authenticated."})
		return
	}
	CleanupInactiveLobbyPlayers()

	if c.Request.Method == http.MethodGet {
		var lobbies []models.Lobby
		database.DB.Where("is_active = ?", true).
			Preload("Players.Player.SelectedTank.Stats").
			Preload("Players.Player.User").
			Find(&lobbies)
		list := make([]interface{}, len(lobbies))
		for i, l := range lobbies {
			list[i] = serializeLobby(l)
		}
		c.JSON(http.StatusOK, list)
		return
	}

	// POST — create lobby
	var body struct {
		Name     string `json:"name"`
		Side     string `json:"side"`
		ArenaID  uint   `json:"arena_id"`
		GameMode string `json:"game_mode"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": err.Error()})
		return
	}
	if body.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"name": []string{"Lobby name is required."}})
		return
	}
	if body.Side == "" {
		body.Side = "allies"
	}

	lobby := models.Lobby{
		Name:      body.Name,
		IsActive:  true,
		GameMode:  body.GameMode,
		CreatedAt: time.Now(),
	}
	if lobby.GameMode == "" {
		lobby.GameMode = "team"
	}

	// Set arena
	if body.ArenaID != 0 {
		lobby.ArenaID = &body.ArenaID
	} else {
		// Try to find first arena
		var arena models.Arena
		if err := database.DB.First(&arena).Error; err == nil {
			lobby.ArenaID = &arena.ID
		}
	}

	if err := database.DB.Create(&lobby).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Failed to create lobby: " + err.Error()})
		return
	}

	ensureLobbyMember(lobby.ID, profile.ID, body.Side)

	// Reload with all data
	database.DB.Preload("Arena").
		Preload("Players.Player.SelectedTank.Stats").
		Preload("Players.Player.User").
		First(&lobby, lobby.ID)

	c.JSON(http.StatusCreated, serializeLobby(lobby))
}

// GET /api/lobbies/:id/ or DELETE /api/lobbies/:id/
func HandleLobbyDetail(c *gin.Context) {
	userID := c.GetUint("userID")
	getOrCreateProfile(userID)
	CleanupInactiveLobbyPlayers()

	lobbyID, _ := strconv.Atoi(c.Param("id"))
	var lobby models.Lobby
	err := database.DB.
		Preload("Players.Player.SelectedTank.Stats").
		Preload("Players.Player.User").
		Where("id = ? AND is_active = ?", lobbyID, true).
		First(&lobby).Error
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"detail": "Lobby not found."})
		return
	}

	if c.Request.Method == http.MethodGet {
		c.JSON(http.StatusOK, serializeLobby(lobby))
		return
	}
	// DELETE
	database.DB.Model(&lobby).Update("is_active", false)
	c.Status(http.StatusNoContent)
}

// POST /api/lobbies/:id/join/
func HandleLobbyJoin(c *gin.Context) {
	userID := c.GetUint("userID")
	profile, _ := getOrCreateProfile(userID)
	var body struct {
		Side string `json:"side"`
	}
	c.ShouldBindJSON(&body)
	if body.Side == "" {
		body.Side = "allies"
	}

	lobbyID, _ := strconv.Atoi(c.Param("id"))
	var lobby models.Lobby
	if err := database.DB.Where("id = ? AND is_active = ?", lobbyID, true).First(&lobby).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"detail": "Lobby not found."})
		return
	}

	var memberCount int64
	database.DB.Model(&models.LobbyPlayer{}).
		Where("lobby_id = ? AND player_id != ?", lobbyID, profile.ID).Count(&memberCount)
	if memberCount >= 10 {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "Lobby is full."})
		return
	}

	ensureLobbyMember(uint(lobbyID), profile.ID, body.Side)
	database.DB.Preload("Players.Player.SelectedTank.Stats").Preload("Players.Player.User").First(&lobby, lobbyID)
	c.JSON(http.StatusOK, serializeLobby(lobby))
}

// POST /api/lobbies/:id/leave/
func HandleLobbyLeave(c *gin.Context) {
	userID := c.GetUint("userID")
	profile, _ := getOrCreateProfile(userID)
	lobbyID, _ := strconv.Atoi(c.Param("id"))

	database.DB.Where("lobby_id = ? AND player_id = ?", lobbyID, profile.ID).Delete(&models.LobbyPlayer{})

	var memberCount int64
	database.DB.Model(&models.LobbyPlayer{}).Where("lobby_id = ?", lobbyID).Count(&memberCount)
	if memberCount == 0 {
		database.DB.Model(&models.Lobby{}).Where("id = ?", lobbyID).Update("is_active", false)
	}
	c.Status(http.StatusNoContent)
}

// POST /api/lobbies/:id/side/
func HandleLobbySetSide(c *gin.Context) {
	userID := c.GetUint("userID")
	profile, _ := getOrCreateProfile(userID)
	lobbyID, _ := strconv.Atoi(c.Param("id"))

	var body struct {
		Side string `json:"side"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || (body.Side != "allies" && body.Side != "axis") {
		c.JSON(http.StatusBadRequest, gin.H{"side": []string{"Must be 'allies' or 'axis'."}})
		return
	}

	var lp models.LobbyPlayer
	if err := database.DB.Where("lobby_id = ? AND player_id = ?", lobbyID, profile.ID).First(&lp).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "Join the lobby first."})
		return
	}
	database.DB.Model(&lp).Update("side", body.Side)

	var lobby models.Lobby
	database.DB.Preload("Players.Player.SelectedTank.Stats").Preload("Players.Player.User").First(&lobby, lobbyID)
	c.JSON(http.StatusOK, serializeLobby(lobby))
}

// POST /api/lobbies/:id/mode/
func HandleLobbySetMode(c *gin.Context) {
	userID := c.GetUint("userID")
	getOrCreateProfile(userID)
	lobbyID, _ := strconv.Atoi(c.Param("id"))

	var body struct {
		Mode string `json:"mode"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || (body.Mode != "team" && body.Mode != "deathmatch") {
		c.JSON(http.StatusBadRequest, gin.H{"mode": []string{"Must be 'team' or 'deathmatch'."}})
		return
	}

	var lobby models.Lobby
	if err := database.DB.First(&lobby, lobbyID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"detail": "Lobby not found."})
		return
	}

	database.DB.Model(&lobby).Update("game_mode", body.Mode)

	database.DB.Preload("Players.Player.SelectedTank.Stats").Preload("Players.Player.User").First(&lobby, lobbyID)
	c.JSON(http.StatusOK, serializeLobby(lobby))
}

func ensureLobbyMember(lobbyID, playerID uint, side string) {
	var lp models.LobbyPlayer
	err := database.DB.Where("lobby_id = ? AND player_id = ?", lobbyID, playerID).First(&lp).Error
	if err != nil {
		database.DB.Create(&models.LobbyPlayer{
			LobbyID:  lobbyID,
			PlayerID: playerID,
			Side:     side,
			JoinedAt: time.Now(),
		})
	} else if lp.Side != side {
		database.DB.Model(&lp).Update("side", side)
	}
}

// POST /api/object/move/
func HandleObjectMove(c *gin.Context) {
	var data map[string]interface{}
	if err := c.ShouldBindJSON(&data); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": err.Error()})
		return
	}
	c.JSON(http.StatusOK, CalculateCubeMove(data))
}

// POST /api/proto-tank/move/
func HandleProtoTankMove(c *gin.Context) {
	var data map[string]interface{}
	if err := c.ShouldBindJSON(&data); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": err.Error()})
		return
	}
	c.JSON(http.StatusOK, CalculateProtoTankMove(data))
}

// POST /api/proto-tank/bullets/
func HandleProtoTankBullets(c *gin.Context) {
	var data map[string]interface{}
	if err := c.ShouldBindJSON(&data); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": err.Error()})
		return
	}
	c.JSON(http.StatusOK, CalculateProtoTankBullets(data))
}
