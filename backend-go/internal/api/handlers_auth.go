package api

import (
	"log"
	"net/http"
	"strings"
	"time"

	"hope-backend-go/internal/database"
	"hope-backend-go/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// generateTokens creates access (24h) and refresh (7d) JWT tokens
func generateTokens(userID uint) (access, refresh string) {
	accessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"token_type": "access",
		"user_id":    userID,
		"exp":        time.Now().Add(24 * time.Hour).Unix(),
	})
	access, _ = accessToken.SignedString(JWTSecret)

	refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"token_type": "refresh",
		"user_id":    userID,
		"exp":        time.Now().Add(7 * 24 * time.Hour).Unix(),
	})
	refresh, _ = refreshToken.SignedString(JWTSecret)
	return
}

// POST /api/auth/login/
func HandleLogin(c *gin.Context) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": err.Error()})
		return
	}

	var user models.User
	if err := database.DB.Where("username = ?", body.Username).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"detail": "No active account found with the given credentials"})
		return
	}
	if !VerifyDjangoPassword(body.Password, user.Password) {
		c.JSON(http.StatusUnauthorized, gin.H{"detail": "No active account found with the given credentials"})
		return
	}

	access, refresh := generateTokens(user.ID)
	c.JSON(http.StatusOK, gin.H{"access": access, "refresh": refresh})
}

// POST /api/auth/refresh/
func HandleRefreshToken(c *gin.Context) {
	var body struct {
		Refresh string `json:"refresh"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": err.Error()})
		return
	}
	userID, err := ParseJWTUserID(body.Refresh)
	if err != nil || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"detail": "Token is invalid or expired"})
		return
	}
	access, _ := generateTokens(userID)
	c.JSON(http.StatusOK, gin.H{"access": access})
}

// POST /api/auth/register/
func HandleRegister(c *gin.Context) {
	var body struct {
		Nickname string `json:"nickname"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": err.Error()})
		return
	}
	body.Nickname = strings.TrimSpace(body.Nickname)
	if body.Nickname == "" {
		c.JSON(http.StatusBadRequest, gin.H{"nickname": []string{"Nickname is required."}})
		return
	}
	if len(body.Password) < 4 {
		c.JSON(http.StatusBadRequest, gin.H{"password": []string{"Password must be at least 4 characters long."}})
		return
	}

	// Check uniqueness
	var count int64
	database.DB.Model(&models.User{}).Where("username = ?", body.Nickname).Count(&count)
	if count > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"nickname": []string{"This nickname is already taken."}})
		return
	}
	database.DB.Model(&models.PlayerProfile{}).Where("nickname = ?", body.Nickname).Count(&count)
	if count > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"nickname": []string{"This nickname is already taken."}})
		return
	}

	now := time.Now()
	user := models.User{
		Username:    body.Nickname,
		Password:    EncodeDjangoPassword(body.Password),
		Email:       "",
		IsActive:    true,
		IsSuperuser: false,
		IsStaff:     false,
		FirstName:   "",
		LastName:    "",
		DateJoined:  now,
	}
	if err := database.DB.Create(&user).Error; err != nil {
		log.Printf("Registration failed for %s: %v", body.Nickname, err)
		c.JSON(http.StatusBadRequest, gin.H{"nickname": []string{"Could not create user account. It might already exist."}})
		return
	}
	profile := models.PlayerProfile{
		UserID:     user.ID,
		Nickname:   body.Nickname,
		Rating:     1000,
		LastSeenAt: &now,
	}
	database.DB.Create(&profile)
	database.DB.Preload("SelectedTank.Stats").Preload("User").First(&profile, profile.ID)

	access, refresh := generateTokens(user.ID)
	c.JSON(http.StatusCreated, gin.H{
		"access":  access,
		"refresh": refresh,
		"profile": serializeProfile(profile),
	})
}

// POST /api/auth/change-password/
func HandleChangePassword(c *gin.Context) {
	userID := c.GetUint("userID")
	var body struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": err.Error()})
		return
	}
	var user models.User
	database.DB.First(&user, userID)
	if !VerifyDjangoPassword(body.CurrentPassword, user.Password) {
		c.JSON(http.StatusBadRequest, gin.H{"currentPassword": []string{"Current password is incorrect."}})
		return
	}
	if len(body.NewPassword) < 4 {
		c.JSON(http.StatusBadRequest, gin.H{"newPassword": []string{"Password must be at least 4 characters long."}})
		return
	}
	database.DB.Model(&user).Update("password", EncodeDjangoPassword(body.NewPassword))
	c.JSON(http.StatusOK, gin.H{"detail": "Password updated successfully."})
}

// GET /api/profile/ or PUT /api/profile/
func HandleProfile(c *gin.Context) {
	userID := c.GetUint("userID")
	profile, err := getOrCreateProfile(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"detail": "Profile not found."})
		return
	}

	if c.Request.Method == http.MethodGet {
		c.JSON(http.StatusOK, serializeProfile(*profile))
		return
	}

	// PUT — update nickname
	var body struct {
		Nickname string `json:"nickname"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": err.Error()})
		return
	}
	body.Nickname = strings.TrimSpace(body.Nickname)
	if body.Nickname == "" {
		c.JSON(http.StatusBadRequest, gin.H{"nickname": []string{"Nickname is required."}})
		return
	}
	// Uniqueness check excluding self
	var count int64
	database.DB.Model(&models.PlayerProfile{}).
		Where("nickname = ? AND id != ?", body.Nickname, profile.ID).Count(&count)
	if count > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"nickname": []string{"This nickname is already taken."}})
		return
	}
	database.DB.Model(profile).Update("nickname", body.Nickname)
	database.DB.Model(&models.User{}).Where("id = ?", userID).Update("username", body.Nickname)
	database.DB.Preload("SelectedTank.Stats").Preload("User").First(profile, profile.ID)
	c.JSON(http.StatusOK, serializeProfile(*profile))
}

// POST /api/profile/select-tank/
func HandleSelectTank(c *gin.Context) {
	userID := c.GetUint("userID")
	var body struct {
		TankID uint `json:"tank_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": err.Error()})
		return
	}
	var tank models.Tank
	if err := database.DB.First(&tank, body.TankID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"tank_id": []string{"Tank not found."}})
		return
	}
	database.DB.Model(&models.PlayerProfile{}).Where("user_id = ?", userID).Update("selectedTank_id", body.TankID)
	profile, _ := getOrCreateProfile(userID)
	c.JSON(http.StatusOK, serializeProfile(*profile))
}

// GET /api/catalog/
func HandleCatalog(c *gin.Context) {
	var tanks []models.Tank
	database.DB.Preload("Stats").Find(&tanks)
	var arenas []models.Arena
	database.DB.Preload("Obstacles").Find(&arenas)

	tankList := make([]interface{}, len(tanks))
	for i, t := range tanks {
		tankList[i] = serializeTank(t)
	}
	arenaList := make([]interface{}, len(arenas))
	for i, a := range arenas {
		arenaList[i] = serializeArena(a)
	}
	c.JSON(http.StatusOK, gin.H{"tanks": tankList, "arenas": arenaList})
}

// GET /api/tanks/
func HandleListTanks(c *gin.Context) {
	var tanks []models.Tank
	database.DB.Preload("Stats").Find(&tanks)
	list := make([]interface{}, len(tanks))
	for i, t := range tanks {
		list[i] = serializeTank(t)
	}
	c.JSON(http.StatusOK, list)
}

// GET /api/arenas/
func HandleListArenas(c *gin.Context) {
	var arenas []models.Arena
	database.DB.Preload("Obstacles").Find(&arenas)
	list := make([]interface{}, len(arenas))
	for i, a := range arenas {
		list[i] = serializeArena(a)
	}
	c.JSON(http.StatusOK, list)
}
