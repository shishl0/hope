package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// JWTSecret is the signing secret. Must match what Django uses for SimpleJWT.
// Django's SimpleJWT default is to use settings.SECRET_KEY.
var JWTSecret = []byte("django-insecure-hope-secret-key")

// AuthMiddleware validates Bearer JWT tokens on protected REST routes.
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"detail": "Authentication credentials were not provided."})
			c.Abort()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"detail": "Invalid token header format."})
			c.Abort()
			return
		}

		userID, err := ParseJWTUserID(parts[1])
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"detail": "Given token not valid for any token type."})
			c.Abort()
			return
		}

		c.Set("userID", userID)
		c.Next()
	}
}

// ParseJWTUserID extracts user_id from a signed JWT token string.
func ParseJWTUserID(tokenString string) (uint, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return JWTSecret, nil
	})
	if err != nil || !token.Valid {
		return 0, err
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return 0, jwt.ErrTokenMalformed
	}

	// Django SimpleJWT uses "user_id" claim
	userIDFloat, ok := claims["user_id"].(float64)
	if !ok {
		// Fallback to "sub"
		userIDFloat, _ = claims["sub"].(float64)
	}
	return uint(userIDFloat), nil
}
