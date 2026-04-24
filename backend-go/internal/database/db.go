package database

import (
	"log"
	"hope-backend-go/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

func InitDB(dbPath string) {
	var err error
	DB, err = gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		log.Fatalf("failed to connect database: %v", err)
	}

	// Auto-migrate to ensure new columns (like game_mode) are created
	DB.AutoMigrate(
		&models.Lobby{},
		&models.LobbyPlayer{},
		&models.Match{},
		&models.MatchPlayerStats{},
	)
}
