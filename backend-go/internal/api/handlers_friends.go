package api

import (
	"net/http"
	"strconv"

	"hope-backend-go/internal/database"
	"hope-backend-go/internal/models"

	"github.com/gin-gonic/gin"
)

// GET /api/friends/
func HandleFriendsSummary(c *gin.Context) {
	userID := c.GetUint("userID")
	profile, err := getOrCreateProfile(userID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"detail": "Not authenticated."})
		return
	}

	// Accepted friends
	var requests []models.FriendRequest
	database.DB.Where("status = 'accepted' AND (fromPlayer_id = ? OR toPlayer_id = ?)", profile.ID, profile.ID).Find(&requests)
	friends := make([]interface{}, 0, len(requests))
	for _, req := range requests {
		var friendID uint
		if req.FromPlayerID == profile.ID {
			friendID = req.ToPlayerID
		} else {
			friendID = req.FromPlayerID
		}
		fp := preloadFriendPlayer(friendID)
		friends = append(friends, serializeFriendPlayer(fp))
	}

	// Outgoing pending requests
	var outgoing []models.FriendRequest
	database.DB.Where("fromPlayer_id = ? AND status = 'pending'", profile.ID).Find(&outgoing)
	outList := make([]interface{}, len(outgoing))
	for i, fr := range outgoing {
		fr.FromPlayer = preloadFriendPlayer(fr.FromPlayerID)
		fr.ToPlayer = preloadFriendPlayer(fr.ToPlayerID)
		outList[i] = serializeFriendRequest(fr)
	}

	// Incoming pending requests
	var incoming []models.FriendRequest
	database.DB.Where("toPlayer_id = ? AND status = 'pending'", profile.ID).Find(&incoming)
	inList := make([]interface{}, len(incoming))
	for i, fr := range incoming {
		fr.FromPlayer = preloadFriendPlayer(fr.FromPlayerID)
		fr.ToPlayer = preloadFriendPlayer(fr.ToPlayerID)
		inList[i] = serializeFriendRequest(fr)
	}

	// Outgoing lobby invites
	var outInvites []models.LobbyInvite
	database.DB.Where("fromPlayer_id = ? AND status = 'pending'", profile.ID).Find(&outInvites)
	outInvList := make([]interface{}, len(outInvites))
	for i, inv := range outInvites {
		inv.FromPlayer = preloadFriendPlayer(inv.FromPlayerID)
		inv.ToPlayer = preloadFriendPlayer(inv.ToPlayerID)
		database.DB.First(&inv.Lobby, inv.LobbyID)
		outInvList[i] = serializeLobbyInvite(inv)
	}

	// Incoming lobby invites
	var inInvites []models.LobbyInvite
	database.DB.Where("toPlayer_id = ? AND status = 'pending'", profile.ID).Find(&inInvites)
	inInvList := make([]interface{}, len(inInvites))
	for i, inv := range inInvites {
		inv.FromPlayer = preloadFriendPlayer(inv.FromPlayerID)
		inv.ToPlayer = preloadFriendPlayer(inv.ToPlayerID)
		database.DB.First(&inv.Lobby, inv.LobbyID)
		inInvList[i] = serializeLobbyInvite(inv)
	}

	c.JSON(http.StatusOK, gin.H{
		"playerId":       "P-" + pad4(profile.UserID),
		"friends":        friends,
		"outgoing":       outList,
		"incoming":       inList,
		"outgoingInvites": outInvList,
		"incomingInvites": inInvList,
	})
}

// GET /api/friends/search/?public_id=P-0001
func HandleFriendsSearch(c *gin.Context) {
	userID := c.GetUint("userID")
	getOrCreateProfile(userID)
	raw := c.Query("public_id")
	other := parsePlayerIdentifier(raw)
	if other == nil {
		c.JSON(http.StatusNotFound, gin.H{"detail": "Игрок не найден."})
		return
	}
	c.JSON(http.StatusOK, serializeFriendPlayer(*other))
}

// GET /api/friends/:player_id/profile/
func HandleFriendProfile(c *gin.Context) {
	userID := c.GetUint("userID")
	profile, _ := getOrCreateProfile(userID)
	other := parsePlayerIdentifier(c.Param("player_id"))
	if other == nil {
		c.JSON(http.StatusNotFound, gin.H{"detail": "Игрок не найден."})
		return
	}
	if !isFriend(profile.ID, other.ID) {
		c.JSON(http.StatusForbidden, gin.H{"detail": "Это не ваш друг."})
		return
	}
	c.JSON(http.StatusOK, serializeFriendPlayer(*other))
}

// POST /api/friends/request/
func HandleSendFriendRequest(c *gin.Context) {
	userID := c.GetUint("userID")
	profile, _ := getOrCreateProfile(userID)
	var body struct {
		PublicID string `json:"public_id"`
	}
	c.ShouldBindJSON(&body)
	other := parsePlayerIdentifier(body.PublicID)
	if other == nil {
		c.JSON(http.StatusNotFound, gin.H{"detail": "Игрок не найден."})
		return
	}
	if other.ID == profile.ID {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "Нельзя добавить себя."})
		return
	}
	if isFriend(profile.ID, other.ID) {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "Вы уже друзья."})
		return
	}
	if pendingRequestBetween(profile.ID, other.ID) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "Заявка уже существует."})
		return
	}
	fr := models.FriendRequest{FromPlayerID: profile.ID, ToPlayerID: other.ID, Status: "pending"}
	database.DB.Create(&fr)
	fr.FromPlayer = preloadFriendPlayer(fr.FromPlayerID)
	fr.ToPlayer = preloadFriendPlayer(fr.ToPlayerID)
	c.JSON(http.StatusCreated, serializeFriendRequest(fr))
}

// POST /api/friends/requests/:id/accept/
func HandleAcceptFriendRequest(c *gin.Context) {
	userID := c.GetUint("userID")
	profile, _ := getOrCreateProfile(userID)
	reqID, _ := strconv.Atoi(c.Param("request_id"))
	var fr models.FriendRequest
	err := database.DB.Where("id = ? AND toPlayer_id = ? AND status = 'pending'", reqID, profile.ID).First(&fr).Error
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"detail": "Заявка не найдена."})
		return
	}
	database.DB.Model(&fr).Update("status", "accepted")
	fr.FromPlayer = preloadFriendPlayer(fr.FromPlayerID)
	fr.ToPlayer = preloadFriendPlayer(fr.ToPlayerID)
	c.JSON(http.StatusOK, serializeFriendRequest(fr))
}

// POST /api/friends/requests/:id/decline/
func HandleDeclineFriendRequest(c *gin.Context) {
	userID := c.GetUint("userID")
	profile, _ := getOrCreateProfile(userID)
	reqID, _ := strconv.Atoi(c.Param("request_id"))
	var fr models.FriendRequest
	if err := database.DB.Where("id = ? AND status = 'pending'", reqID).First(&fr).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"detail": "Заявка не найдена."})
		return
	}
	if fr.FromPlayerID != profile.ID && fr.ToPlayerID != profile.ID {
		c.JSON(http.StatusForbidden, gin.H{"detail": "Нет доступа к заявке."})
		return
	}
	database.DB.Model(&fr).Update("status", "declined")
	c.Status(http.StatusNoContent)
}

// POST /api/friends/:player_id/invite/
func HandleInviteFriendToLobby(c *gin.Context) {
	userID := c.GetUint("userID")
	profile, _ := getOrCreateProfile(userID)
	other := parsePlayerIdentifier(c.Param("player_id"))
	if other == nil {
		c.JSON(http.StatusNotFound, gin.H{"detail": "Игрок не найден."})
		return
	}
	if !isFriend(profile.ID, other.ID) {
		c.JSON(http.StatusForbidden, gin.H{"detail": "Можно приглашать только друзей."})
		return
	}
	var lp models.LobbyPlayer
	err := database.DB.
		Joins("JOIN game_lobby ON game_lobby.id = game_lobbyplayer.lobby_id").
		Where("game_lobbyplayer.player_id = ? AND game_lobby.is_active = 1", profile.ID).
		First(&lp).Error
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "Сначала войдите в лобби."})
		return
	}
	invite := models.LobbyInvite{FromPlayerID: profile.ID, ToPlayerID: other.ID, LobbyID: lp.LobbyID, Status: "pending"}
	database.DB.Create(&invite)
	invite.FromPlayer = preloadFriendPlayer(invite.FromPlayerID)
	invite.ToPlayer = preloadFriendPlayer(invite.ToPlayerID)
	database.DB.First(&invite.Lobby, invite.LobbyID)
	c.JSON(http.StatusCreated, serializeLobbyInvite(invite))
}

// POST /api/friends/invites/:id/accept/
func HandleAcceptLobbyInvite(c *gin.Context) {
	userID := c.GetUint("userID")
	profile, _ := getOrCreateProfile(userID)
	inviteID, _ := strconv.Atoi(c.Param("invite_id"))
	var invite models.LobbyInvite
	err := database.DB.Where("id = ? AND toPlayer_id = ? AND status = 'pending'", inviteID, profile.ID).First(&invite).Error
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"detail": "Приглашение не найдено."})
		return
	}
	ensureLobbyMember(invite.LobbyID, profile.ID, "allies")
	database.DB.Model(&invite).Update("status", "accepted")
	var lobby models.Lobby
	database.DB.Preload("Players.Player.SelectedTank.Stats").Preload("Players.Player.User").First(&lobby, invite.LobbyID)
	c.JSON(http.StatusOK, serializeLobby(lobby))
}

// POST /api/friends/invites/:id/decline/
func HandleDeclineLobbyInvite(c *gin.Context) {
	userID := c.GetUint("userID")
	profile, _ := getOrCreateProfile(userID)
	inviteID, _ := strconv.Atoi(c.Param("invite_id"))
	var invite models.LobbyInvite
	if err := database.DB.Where("id = ? AND status = 'pending'", inviteID).First(&invite).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"detail": "Приглашение не найдено."})
		return
	}
	if invite.FromPlayerID != profile.ID && invite.ToPlayerID != profile.ID {
		c.JSON(http.StatusForbidden, gin.H{"detail": "Нет доступа к приглашению."})
		return
	}
	database.DB.Model(&invite).Update("status", "declined")
	c.Status(http.StatusNoContent)
}

func pad4(n uint) string {
	s := strconv.Itoa(int(n))
	for len(s) < 4 {
		s = "0" + s
	}
	return s
}
