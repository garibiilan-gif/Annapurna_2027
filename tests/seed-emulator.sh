#!/bin/sh
# Test users for the local emulators only (npm run emulators), then open http://localhost:8765/?emu
# owner@example.com / owner-pass-1 is the owner (same user id as in firestore.rules); dana@example.com / dana-pass-1 a trip admin.
A="http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-trek/accounts"
add() { curl -s -H "Authorization: Bearer owner" -H "Content-Type: application/json" -X POST "$A" -d "$1" >/dev/null; }
OWNER=$(sed -n 's/.*request\.auth\.uid == "\([^"]*\)".*/\1/p' firestore.rules)
add "{\"localId\":\"$OWNER\",\"email\":\"owner@example.com\",\"password\":\"owner-pass-1\",\"emailVerified\":true}"
add '{"localId":"admin1","email":"dana@example.com","password":"dana-pass-1","emailVerified":true}'
echo "Test users added to the emulator."
