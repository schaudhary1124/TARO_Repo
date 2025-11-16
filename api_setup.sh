#!/bin/bash

# --- Secure .env and .gitignore Setup Script (Google Maps + Gemini) ---

set -euo pipefail

ROOT_ENV_FILE=".env"
FRONTEND_ENV_FILE="frontend/.env"
GITIGNORE_FILE=".gitignore"

GOOGLE_KEY_NAME="VITE_GOOGLE_MAPS_KEY"  # frontend + backend (safe to expose in FE)
GEMINI_KEY_NAME="GEMINI_API_KEY"        # backend-only (DO NOT put in frontend/.env)

echo "--- Secure Environment Setup Script ---"

# 0) Helper: add or update KEY in .env files (handles macOS and Linux sed)
upsert_env_var () {
  local file="$1"
  local key="$2"
  local value="$3"

  # Create file if missing
  [ -f "$file" ] || touch "$file"

  if grep -qE "^${key}=" "$file"; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s|^${key}=.*|${key}=\"${value}\"|g" "$file"
    else
      sed -i "s|^${key}=.*|${key}=\"${value}\"|g" "$file"
    fi
    echo "🔁 Updated $key in $file"
  else
    echo "${key}=\"${value}\"" >> "$file"
    echo "➕ Added $key to $file"
  fi
}

# 1) Prompt for keys (hidden input)
read -s -p "Please enter your Google Maps API Key for ${GOOGLE_KEY_NAME}: " USER_GOOGLE_KEY
echo
read -s -p "Please enter your Gemini API Key for ${GEMINI_KEY_NAME}: " USER_GEMINI_KEY
echo

# 2) Ensure .gitignore has both .env paths
if [ -f "$GITIGNORE_FILE" ]; then
  grep -Fxq "$ROOT_ENV_FILE" "$GITIGNORE_FILE" || { echo -e "\n# Environment Variables\n$ROOT_ENV_FILE" >> "$GITIGNORE_FILE"; echo "✅ Added '$ROOT_ENV_FILE' to '$GITIGNORE_FILE'."; }
  grep -Fxq "$FRONTEND_ENV_FILE" "$GITIGNORE_FILE" || { echo "$FRONTEND_ENV_FILE" >> "$GITIGNORE_FILE"; echo "✅ Added '$FRONTEND_ENV_FILE' to '$GITIGNORE_FILE'."; }
else
  echo -e "# Environment Variables\n$ROOT_ENV_FILE\n$FRONTEND_ENV_FILE" > "$GITIGNORE_FILE"
  echo "✅ Created '$GITIGNORE_FILE' and added .env entries."
fi

# 3) Upsert keys into root .env
upsert_env_var "$ROOT_ENV_FILE" "$GOOGLE_KEY_NAME" "$USER_GOOGLE_KEY"
upsert_env_var "$ROOT_ENV_FILE" "$GEMINI_KEY_NAME" "$USER_GEMINI_KEY"

# 4) Upsert Google Maps key into frontend/.env (but NOT Gemini key)
mkdir -p frontend
upsert_env_var "$FRONTEND_ENV_FILE" "$GOOGLE_KEY_NAME" "$USER_GOOGLE_KEY"

echo "--- Setup Complete ---"
echo "🚨 Security Reminder: Never commit any .env files to Git!"
echo "🔑 Stored keys:"
echo "   • $ROOT_ENV_FILE → $GOOGLE_KEY_NAME, $GEMINI_KEY_NAME"
echo "   • $FRONTEND_ENV_FILE → $GOOGLE_KEY_NAME (frontend-safe)"
