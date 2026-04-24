package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/pbkdf2"
)

const djangoIterations = 600000

// VerifyDjangoPassword verifies a Django PBKDF2-SHA256 hashed password.
// Format: pbkdf2_sha256$iterations$salt$hash
func VerifyDjangoPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 4 {
		return false
	}
	if parts[0] != "pbkdf2_sha256" {
		return false
	}
	iterations, err := strconv.Atoi(parts[1])
	if err != nil {
		return false
	}
	salt := parts[2]
	expectedHash := parts[3]

	hash := pbkdf2.Key([]byte(password), []byte(salt), iterations, 32, sha256.New)
	encodedHash := base64.StdEncoding.EncodeToString(hash)
	return encodedHash == expectedHash
}

// EncodeDjangoPassword hashes a password using Django-compatible PBKDF2-SHA256
// with a cryptographically random 22-character salt.
func EncodeDjangoPassword(password string) string {
	saltBytes := make([]byte, 16)
	if _, err := rand.Read(saltBytes); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	// Django uses base64url without padding for the salt
	salt := base64.RawURLEncoding.EncodeToString(saltBytes)

	hash := pbkdf2.Key([]byte(password), []byte(salt), djangoIterations, 32, sha256.New)
	encodedHash := base64.StdEncoding.EncodeToString(hash)
	return fmt.Sprintf("pbkdf2_sha256$%d$%s$%s", djangoIterations, salt, encodedHash)
}
