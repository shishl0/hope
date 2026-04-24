package models

import (
	"time"
)

// User maps to Django's auth_user
type User struct {
	ID          uint       `gorm:"primaryKey"`
	Username    string     `gorm:"unique;not null"`
	Password    string     `gorm:"not null"`
	Email       string     `gorm:"not null"`
	IsActive    bool       `gorm:"column:is_active;default:true"`
	IsSuperuser bool       `gorm:"column:is_superuser;default:false"`
	IsStaff     bool       `gorm:"column:is_staff;default:false"`
	FirstName   string     `gorm:"column:first_name;default:''"`
	LastName    string     `gorm:"column:last_name;default:''"`
	DateJoined  time.Time  `gorm:"column:date_joined"`
	LastLogin   *time.Time `gorm:"column:last_login"`
}

func (User) TableName() string { return "auth_user" }

type TankStats struct {
	ID                  uint    `gorm:"primaryKey"`
	MoveSpeed           float64 `gorm:"column:moveSpeed;default:10.0"`
	MaxHP               int     `gorm:"column:maxHP;default:100"`
	ReloadSpeed         float64 `gorm:"column:reloadSpeed;default:1.0"`
	RotationSpeed       float64 `gorm:"column:rotationSpeed;default:2.0"`
	TurretRotationSpeed float64 `gorm:"column:turretRotationSpeed;default:3.0"`
	BulletSpeed         float64 `gorm:"column:bulletSpeed;default:20.0"`
	BulletDamage        int     `gorm:"column:bulletDamage;default:20"`
}

func (TankStats) TableName() string { return "game_tankstats" }

type Tank struct {
	ID             uint      `gorm:"primaryKey"`
	Name           string    `gorm:"not null"`
	Side           string    `gorm:"column:side"`
	BodyModelKey   string    `gorm:"column:bodyModelKey;default:'default_body'"`
	TurretModelKey string    `gorm:"column:turretModelKey;default:'default_turret'"`
	BulletModelKey string    `gorm:"column:bulletModelKey;default:'default_bullet'"`
	Description    string    `gorm:"column:description"`
	StatsID        uint      `gorm:"column:stats_id"`
	Stats          TankStats `gorm:"foreignKey:StatsID"`
}

func (Tank) TableName() string { return "game_tank" }

type PlayerProfile struct {
	ID             uint       `gorm:"primaryKey"`
	UserID         uint       `gorm:"column:user_id;unique;not null"`
	User           User       `gorm:"foreignKey:UserID"`
	Nickname       string     `gorm:"unique;not null"`
	SelectedTankID *uint      `gorm:"column:selectedTank_id"`
	SelectedTank   *Tank      `gorm:"foreignKey:SelectedTankID"`
	TotalKills     int        `gorm:"column:totalKills;default:0"`
	TotalDeaths    int        `gorm:"column:totalDeaths;default:0"`
	Wins           int        `gorm:"default:0"`
	Losses         int        `gorm:"default:0"`
	Rating         int        `gorm:"default:1000"`
	LastSeenAt     *time.Time `gorm:"column:lastSeenAt"`
}

func (PlayerProfile) TableName() string { return "game_playerprofile" }

type Obstacle struct {
	ID        uint    `gorm:"primaryKey"`
	ArenaID   uint    `gorm:"column:arena_id;not null"`
	Type      string  `gorm:"not null"`
	ModelKey  string  `gorm:"column:modelKey;default:'default_obstacle'"`
	X         float64 `gorm:"not null"`
	Y         float64 `gorm:"not null"`
	Z         float64 `gorm:"not null"`
	RotationY float64 `gorm:"column:rotationY;default:0"`
	ScaleX    float64 `gorm:"column:scaleX;default:1"`
	ScaleY    float64 `gorm:"column:scaleY;default:1"`
	ScaleZ    float64 `gorm:"column:scaleZ;default:1"`
}

func (Obstacle) TableName() string { return "game_obstacle" }

type Arena struct {
	ID          uint       `gorm:"primaryKey"`
	Name        string     `gorm:"not null"`
	ModelKey    string     `gorm:"column:modelKey;default:'default_arena'"`
	Description string     `gorm:"column:description"`
	Obstacles   []Obstacle `gorm:"foreignKey:ArenaID"`
}

func (Arena) TableName() string { return "game_arena" }

type Lobby struct {
	ID        uint          `gorm:"primaryKey"`
	Name      string        `gorm:"not null"`
	ArenaID   *uint         `gorm:"column:arena_id"`
	Arena     *Arena        `gorm:"foreignKey:ArenaID"`
	IsActive  bool          `gorm:"column:is_active;default:true"`
	CreatedAt time.Time     `gorm:"column:created_at"`
	GameMode  string        `gorm:"column:game_mode;default:'team'"`
	Players   []LobbyPlayer `gorm:"foreignKey:LobbyID"`
}

func (Lobby) TableName() string { return "game_lobby" }

type LobbyPlayer struct {
	ID       uint          `gorm:"primaryKey"`
	LobbyID  uint          `gorm:"column:lobby_id;not null"`
	PlayerID uint          `gorm:"column:player_id;not null"`
	Player   PlayerProfile `gorm:"foreignKey:PlayerID"`
	Side     string        `gorm:"default:'allies'"`
	IsReady  bool          `gorm:"column:is_ready;default:false"`
	JoinedAt time.Time     `gorm:"column:joined_at"`
}

func (LobbyPlayer) TableName() string { return "game_lobbyplayer" }

type Match struct {
	ID         uint       `gorm:"primaryKey"`
	LobbyID    *uint      `gorm:"column:lobby_id"`
	WinnerTeam string     `gorm:"column:winner_team"`
	StartedAt  time.Time  `gorm:"column:started_at"`
	FinishedAt *time.Time `gorm:"column:finished_at"`
}

func (Match) TableName() string { return "game_match" }

type MatchPlayerStats struct {
	ID       uint `gorm:"primaryKey"`
	MatchID  uint `gorm:"column:match_id;not null"`
	PlayerID uint `gorm:"column:player_id;not null"`
	Kills    int  `gorm:"default:0"`
	Deaths   int  `gorm:"default:0"`
}

func (MatchPlayerStats) TableName() string { return "game_matchplayerstats" }

type FriendRequest struct {
	ID           uint          `gorm:"primaryKey"`
	FromPlayerID uint          `gorm:"column:fromPlayer_id;not null"`
	ToPlayerID   uint          `gorm:"column:toPlayer_id;not null"`
	FromPlayer   PlayerProfile `gorm:"foreignKey:FromPlayerID"`
	ToPlayer     PlayerProfile `gorm:"foreignKey:ToPlayerID"`
	Status       string        `gorm:"default:'pending'"`
	CreatedAt    time.Time     `gorm:"column:created_at"`
}

func (FriendRequest) TableName() string { return "game_friendrequest" }

type LobbyInvite struct {
	ID           uint          `gorm:"primaryKey"`
	FromPlayerID uint          `gorm:"column:fromPlayer_id;not null"`
	ToPlayerID   uint          `gorm:"column:toPlayer_id;not null"`
	LobbyID      uint          `gorm:"column:lobby_id;not null"`
	FromPlayer   PlayerProfile `gorm:"foreignKey:FromPlayerID"`
	ToPlayer     PlayerProfile `gorm:"foreignKey:ToPlayerID"`
	Lobby        Lobby         `gorm:"foreignKey:LobbyID"`
	Status       string        `gorm:"default:'pending'"`
	CreatedAt    time.Time     `gorm:"column:created_at"`
}

func (LobbyInvite) TableName() string { return "game_lobbyinvite" }
