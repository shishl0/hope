package api

import (
	"fmt"
	"math"
	"strings"
	"time"

	"hope-backend-go/internal/database"
	"hope-backend-go/internal/models"
)

// ── Tank serialization ─────────────────────────────────────────────

func serializeTankStats(s models.TankStats) map[string]interface{} {
	return map[string]interface{}{
		"id":                  s.ID,
		"moveSpeed":           s.MoveSpeed,
		"maxHP":               s.MaxHP,
		"reloadSpeed":         s.ReloadSpeed,
		"rotationSpeed":       s.RotationSpeed,
		"turretRotationSpeed": s.TurretRotationSpeed,
		"bulletSpeed":         s.BulletSpeed,
		"bulletDamage":        s.BulletDamage,
	}
}

func bulletModelURL(key string) interface{} {
	k := strings.ToLower(key)
	if k == "default_bullet" || k == "default-bullet" || k == "primitive-bullet" {
		return nil
	}
	return "/3d_Models/" + key + ".fbx"
}

func serializeTank(t models.Tank) map[string]interface{} {
	out := map[string]interface{}{
		"id":             t.ID,
		"name":           t.Name,
		"side":           t.Side,
		"bodyModelKey":   t.BodyModelKey,
		"turretModelKey": t.TurretModelKey,
		"bulletModelKey": t.BulletModelKey,
		"description":    t.Description,
		"stats_id":       t.StatsID,
		"stats":          serializeTankStats(t.Stats),
		"bodyModelUrl":   "/3d_Models/" + t.BodyModelKey + ".fbx",
		"turretModelUrl": "/3d_Models/" + t.TurretModelKey + ".fbx",
		"bulletModelUrl": bulletModelURL(t.BulletModelKey),
	}
	return out
}

func serializeTankPtr(t *models.Tank) interface{} {
	if t == nil {
		return nil
	}
	return serializeTank(*t)
}

// ── Obstacle / Arena serialization ────────────────────────────────

func serializeObstacle(o models.Obstacle) map[string]interface{} {
	return map[string]interface{}{
		"id":        o.ID,
		"arena":     o.ArenaID,
		"type":      o.Type,
		"modelKey":  o.ModelKey,
		"x":         o.X,
		"y":         o.Y,
		"z":         o.Z,
		"rotationY": o.RotationY,
		"scaleX":    o.ScaleX,
		"scaleY":    o.ScaleY,
		"scaleZ":    o.ScaleZ,
		"modelUrl":  "/3d_Models/" + o.ModelKey + ".fbx",
	}
}

func serializeArena(a models.Arena) map[string]interface{} {
	obs := make([]interface{}, len(a.Obstacles))
	for i, o := range a.Obstacles {
		obs[i] = serializeObstacle(o)
	}
	return map[string]interface{}{
		"id":          a.ID,
		"name":        a.Name,
		"modelKey":    a.ModelKey,
		"description": a.Description,
		"modelUrl":    "/3d_Models/" + a.ModelKey + ".fbx",
		"obstacles":   obs,
	}
}

// ── Profile serialization ─────────────────────────────────────────

func countMatchesPlayed(profileID uint) int {
	var count int64
	database.DB.Raw(
		"SELECT COUNT(DISTINCT match_id) FROM game_matchplayerstats WHERE player_id = ?",
		profileID,
	).Scan(&count)
	return int(count)
}

func serializeProfile(p models.PlayerProfile) map[string]interface{} {
	return map[string]interface{}{
		"id":           p.ID,
		"userId":       p.UserID,
		"publicId":     fmt.Sprintf("P-%04d", p.UserID),
		"nickname":     p.Nickname,
		"selectedTank": serializeTankPtr(p.SelectedTank),
		"matchesPlayed": countMatchesPlayed(p.ID),
		"totalKills":   p.TotalKills,
		"totalDeaths":  p.TotalDeaths,
		"wins":         p.Wins,
		"losses":       p.Losses,
		"rating":       p.Rating,
	}
}

// ── FriendPlayer serialization ────────────────────────────────────

func getActiveLobby(profileID uint) *models.Lobby {
	var lp models.LobbyPlayer
	err := database.DB.
		Joins("JOIN game_lobby ON game_lobby.id = game_lobbyplayer.lobby_id").
		Where("game_lobbyplayer.player_id = ? AND game_lobby.is_active = 1", profileID).
		Preload("Lobby").First(&lp).Error
	if err != nil {
		return nil
	}
	// re-load lobby separately for clean access
	var lobby models.Lobby
	if err := database.DB.First(&lobby, lp.LobbyID).Error; err != nil {
		return nil
	}
	return &lobby
}

func serializeFriendPlayer(p models.PlayerProfile) map[string]interface{} {
	avatar := "T"
	if len(p.Nickname) > 0 {
		avatar = string([]rune(p.Nickname)[:1])
	}

	isOnline := false
	activeLobbyID := interface{}(nil)
	activeLobbyName := interface{}(nil)

	activeLobby := getActiveLobby(p.ID)
	if activeLobby != nil {
		isOnline = true
		activeLobbyID = activeLobby.ID
		activeLobbyName = activeLobby.Name
	} else if p.LastSeenAt != nil {
		isOnline = time.Since(*p.LastSeenAt).Seconds() <= 300
	}

	daysSinceSeen := interface{}(nil)
	if p.LastSeenAt != nil {
		days := int(math.Max(0, float64(time.Since(*p.LastSeenAt).Hours()/24)))
		daysSinceSeen = days
	}

	return map[string]interface{}{
		"id":              p.ID,
		"publicId":        fmt.Sprintf("P-%04d", p.UserID),
		"nickname":        p.Nickname,
		"avatar":          strings.ToUpper(avatar),
		"rating":          p.Rating,
		"selectedTank":    serializeTankPtr(p.SelectedTank),
		"matchesPlayed":   countMatchesPlayed(p.ID),
		"totalKills":      p.TotalKills,
		"totalDeaths":     p.TotalDeaths,
		"wins":            p.Wins,
		"losses":          p.Losses,
		"lastSeenAt":      p.LastSeenAt,
		"isOnline":        isOnline,
		"daysSinceSeen":   daysSinceSeen,
		"activeLobbyId":   activeLobbyID,
		"activeLobbyName": activeLobbyName,
	}
}

// ── FriendRequest / LobbyInvite serialization ─────────────────────

func serializeFriendRequest(fr models.FriendRequest) map[string]interface{} {
	return map[string]interface{}{
		"id":         fr.ID,
		"fromPlayer": serializeFriendPlayer(fr.FromPlayer),
		"toPlayer":   serializeFriendPlayer(fr.ToPlayer),
		"status":     fr.Status,
		"created_at": fr.CreatedAt,
	}
}

func serializeLobbyInvite(inv models.LobbyInvite) map[string]interface{} {
	return map[string]interface{}{
		"id":         inv.ID,
		"fromPlayer": serializeFriendPlayer(inv.FromPlayer),
		"toPlayer":   serializeFriendPlayer(inv.ToPlayer),
		"lobbyId":    inv.LobbyID,
		"lobbyName":  inv.Lobby.Name,
		"status":     inv.Status,
		"created_at": inv.CreatedAt,
	}
}

// ── Lobby serialization ───────────────────────────────────────────

func serializeLobbyPlayer(lp models.LobbyPlayer) map[string]interface{} {
	avatar := "T"
	if len(lp.Player.Nickname) > 0 {
		avatar = strings.ToUpper(string([]rune(lp.Player.Nickname)[:1]))
	}
	return map[string]interface{}{
		"id":           lp.Player.ID,
		"nickname":     lp.Player.Nickname,
		"avatar":       avatar,
		"rating":       lp.Player.Rating,
		"selectedTank": serializeTankPtr(lp.Player.SelectedTank),
		"side":         lp.Side,
		"is_ready":     lp.IsReady,
		"joined_at":    lp.JoinedAt,
	}
}

func serializeLobby(lobby models.Lobby) map[string]interface{} {
	players := make([]interface{}, len(lobby.Players))
	for i, lp := range lobby.Players {
		players[i] = serializeLobbyPlayer(lp)
	}

	var arena interface{}
	if lobby.Arena != nil {
		arena = serializeArena(*lobby.Arena)
	}

	return map[string]interface{}{
		"id":           lobby.ID,
		"name":         lobby.Name,
		"is_active":    lobby.IsActive,
		"max_players":  10,
		"player_count": len(lobby.Players),
		"players":      players,
		"game_mode":    lobby.GameMode,
		"arena":        arena,
		"created_at":   lobby.CreatedAt,
	}
}

// ── Utility helpers ───────────────────────────────────────────────

func parsePlayerIdentifier(raw string) *models.PlayerProfile {
	v := strings.TrimSpace(raw)
	if v == "" {
		return nil
	}
	if strings.HasPrefix(strings.ToUpper(v), "P-") {
		v = v[2:]
	}
	// Must be all digits (user_id)
	for _, c := range v {
		if c < '0' || c > '9' {
			return nil
		}
	}
	var profile models.PlayerProfile
	err := database.DB.
		Preload("SelectedTank.Stats").
		Preload("User").
		Where("user_id = ?", v).
		First(&profile).Error
	if err != nil {
		return nil
	}
	return &profile
}

func isFriend(profileID, otherID uint) bool {
	var count int64
	database.DB.Model(&models.FriendRequest{}).
		Where("status = 'accepted' AND ((fromPlayer_id = ? AND toPlayer_id = ?) OR (fromPlayer_id = ? AND toPlayer_id = ?))",
			profileID, otherID, otherID, profileID).
		Count(&count)
	return count > 0
}

func pendingRequestBetween(profileID, otherID uint) *models.FriendRequest {
	var fr models.FriendRequest
	err := database.DB.
		Where("status = 'pending' AND ((fromPlayer_id = ? AND toPlayer_id = ?) OR (fromPlayer_id = ? AND toPlayer_id = ?))",
			profileID, otherID, otherID, profileID).
		First(&fr).Error
	if err != nil {
		return nil
	}
	return &fr
}

func CleanupInactiveLobbyPlayers() {
	threshold := time.Now().Add(-1 * time.Minute)
	database.DB.Exec("DELETE FROM game_lobbyplayer WHERE player_id IN (SELECT id FROM game_playerprofile WHERE lastSeenAt < ?)", threshold)
	database.DB.Exec("UPDATE game_lobby SET is_active = 0 WHERE is_active = 1 AND id NOT IN (SELECT DISTINCT lobby_id FROM game_lobbyplayer)")
}

func touchProfile(p *models.PlayerProfile) {
	now := time.Now()
	p.LastSeenAt = &now
	database.DB.Model(p).Update("lastSeenAt", now)
}

func getOrCreateProfile(userID uint) (*models.PlayerProfile, error) {
	var profile models.PlayerProfile
	var user models.User
	if err := database.DB.First(&user, userID).Error; err != nil {
		return nil, err
	}
	err := database.DB.
		Preload("SelectedTank.Stats").
		Preload("User").
		Where("user_id = ?", userID).
		First(&profile).Error
	if err != nil {
		// Create it
		now := time.Now()
		profile = models.PlayerProfile{
			UserID:     userID,
			Nickname:   user.Username,
			Rating:     1000,
			LastSeenAt: &now,
		}
		if err2 := database.DB.Create(&profile).Error; err2 != nil {
			return nil, err2
		}
		database.DB.Preload("SelectedTank.Stats").Preload("User").First(&profile, profile.ID)
	}
	touchProfile(&profile)
	return &profile, nil
}

func preloadFriendPlayer(profileID uint) models.PlayerProfile {
	var p models.PlayerProfile
	database.DB.Preload("SelectedTank.Stats").Preload("User").First(&p, profileID)
	return p
}
